// Fournisseur RÉEL du port `CRM_AGENDA_SOURCE` de « Mes tâches » — ADR-0040 —
// C4 § 5.2 (O3, « une seule liste »).
//
// LECTURE SEULE de `crm_activities`, `crm_opportunities` (titre), `crm_contacts`
// (nom) et `crm_accounts` (nom ; collection du lot C1, lue si elle existe). Rien
// n'est copié dans `work_tasks` : chaque relance reste une activité CRM, cochée
// par la route du CRM.
//
// Entre dans la liste (§ 5.1) : activité de l'organisation, assignée à
// l'appelant, non faite, avec un jour d'échéance (`dueDay`), dont le compte n'est
// pas fusionné. Isolation : `organizationId` vient de la session, chaque lecture
// le porte.

import {
  crmAgendaHref,
  crmAgendaId,
  type CrmAgendaActivityKind,
  type CrmMyTaskItem,
} from '@lalanda/shared/crm';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import type { CrmAgendaPage, CrmAgendaReader } from '../../work/my-tasks.ports.js';
import { ACTIVITY_KIND_LABELS, type ActivityKind } from '../crm-model.js';
import {
  CrmActivity,
  CrmContact,
  CrmOpportunity,
  type CrmActivityDocument,
  type CrmContactDocument,
  type CrmOpportunityDocument,
} from '../crm.schemas.js';

interface ActivityRow {
  _id: Types.ObjectId;
  kind: ActivityKind;
  subject: string;
  notes: string | null;
  dueAt: Date;
  dueDay: string;
  opportunityId: string | null;
  contactId: string | null;
  customerId: string | null;
  accountId?: string | null;
  assigneeUserId: string;
  revision: number;
}

function objectIds(ids: Iterable<string | null | undefined>): Types.ObjectId[] {
  const out = new Set<string>();
  for (const id of ids) if (id && Types.ObjectId.isValid(id) && id.length === 24) out.add(id);
  return [...out].map((id) => new Types.ObjectId(id));
}

@Injectable()
export class CrmAgendaSource implements CrmAgendaReader {
  constructor(
    @InjectModel(CrmActivity.name) private readonly activities: Model<CrmActivityDocument>,
    @InjectModel(CrmOpportunity.name)
    private readonly opportunities: Model<CrmOpportunityDocument>,
    @InjectModel(CrmContact.name) private readonly contacts: Model<CrmContactDocument>,
  ) {}

  async agendaOf(organizationId: string, userId: string, limit: number): Promise<CrmAgendaPage> {
    const rows = (await this.activities
      .find(
        { organizationId, assigneeUserId: userId, done: false, dueDay: { $ne: null } },
        {
          kind: 1,
          subject: 1,
          notes: 1,
          dueAt: 1,
          dueDay: 1,
          opportunityId: 1,
          contactId: 1,
          customerId: 1,
          accountId: 1,
          assigneeUserId: 1,
          revision: 1,
        },
      )
      .sort({ dueDay: 1, dueAt: 1, _id: 1 })
      .limit(limit + 1)
      .lean()
      .exec()) as unknown as ActivityRow[];
    const truncated = rows.length > limit;
    const kept = rows.slice(0, limit).filter((r) => r.dueAt);

    const [opportunities, contacts, accounts] = await Promise.all([
      this.opportunities
        .find(
          { organizationId, _id: { $in: objectIds(kept.map((r) => r.opportunityId)) } },
          { title: 1 },
        )
        .lean()
        .exec(),
      this.contacts
        .find(
          { organizationId, _id: { $in: objectIds(kept.map((r) => r.contactId)) } },
          { name: 1 },
        )
        .lean()
        .exec(),
      this.accountsOf(
        organizationId,
        kept.map((r) => r.accountId),
      ),
    ]);
    const titles = new Map(opportunities.map((o) => [String(o._id), o.title]));
    const names = new Map(contacts.map((c) => [String(c._id), c.name]));

    const items: CrmMyTaskItem[] = [];
    for (const r of kept) {
      const accountId = r.accountId ?? null;
      const account = accountId ? accounts.get(accountId) : undefined;
      // Compte fusionné (§ 5.1) : ses activités ont été reportées sur la cible.
      if (account?.merged) continue;
      const activityId = String(r._id);
      items.push({
        source: 'crm',
        id: crmAgendaId(activityId),
        activityId,
        kind: r.kind as CrmAgendaActivityKind,
        kindLabel: ACTIVITY_KIND_LABELS[r.kind],
        subject: r.subject,
        notes: r.notes ?? null,
        dueDate: r.dueDay,
        dueAt: new Date(r.dueAt).toISOString(),
        priority: 'none',
        rank: new Date(r.dueAt).toISOString(),
        done: false,
        accountId,
        accountName: account?.name ?? null,
        opportunityId: r.opportunityId ?? null,
        opportunityTitle: r.opportunityId ? (titles.get(r.opportunityId) ?? null) : null,
        contactId: r.contactId ?? null,
        contactName: r.contactId ? (names.get(r.contactId) ?? null) : null,
        customerId: r.customerId ?? null,
        assigneeUserId: r.assigneeUserId,
        revision: r.revision,
        href: crmAgendaHref({
          activityId,
          opportunityId: r.opportunityId ?? null,
          accountId,
          contactId: r.contactId ?? null,
        }),
      });
    }
    return { items, truncated };
  }

  /** Noms des comptes (collection du lot C1, lue sans son schéma ; vide si absente). */
  private async accountsOf(
    organizationId: string,
    ids: readonly (string | null | undefined)[],
  ): Promise<Map<string, { name: string; merged: boolean }>> {
    const wanted = objectIds(ids);
    const out = new Map<string, { name: string; merged: boolean }>();
    if (wanted.length === 0) return out;
    const docs = await this.activities.db
      .collection('crm_accounts')
      .find({ organizationId, _id: { $in: wanted } }, { projection: { name: 1, mergedInto: 1 } })
      .toArray();
    for (const d of docs) {
      out.set(String(d['_id']), {
        name: typeof d['name'] === 'string' ? d['name'] : '',
        merged: d['mergedInto'] !== null && d['mergedInto'] !== undefined,
      });
    }
    return out;
  }
}
