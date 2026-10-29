// Fournisseur RÉEL du point d'extension `CRM_SOURCE` du brief du matin —
// ADR-0040 — C4 § 5.5, branché par `morning-brief.module.ts`.
//
// LECTURE SEULE de `crm_activities` et `crm_opportunities`, et aucun calcul ici :
// la source remet au moteur `morning-brief` les relances non faites dont le jour
// d'échéance est aujourd'hui ou passé (jour de Kinshasa), et le NOMBRE
// d'opportunités ouvertes. Le moteur décide de ce qui est « en retard » ou « du
// jour ». Aucun montant : les montants estimés restent dans le CRM.
//
// Isolation : `organizationId` vient de la session (brief) ou de la membership
// vérifiée (e-mail). Appelé seulement si le rôle détient `crm.read`.

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type { BriefCrmActivityInput, BriefCrmInput } from '@lalanda/engine';
import { kinshasaDayOf } from '@lalanda/shared/work';

import type { CrmSource } from '../../morning-brief/morning-brief.ports.js';
import {
  CrmActivity,
  CrmOpportunity,
  type CrmActivityDocument,
  type CrmOpportunityDocument,
} from '../crm.schemas.js';

/** Relances lues au plus pour un brief : au-delà, le brief le signale (`truncated`). */
export const MAX_BRIEF_CRM_ACTIVITIES = 5000;

interface Row {
  dueDay: string;
  assigneeUserId: string | null;
}

@Injectable()
export class CrmBriefSource implements CrmSource {
  constructor(
    @InjectModel(CrmActivity.name) private readonly activities: Model<CrmActivityDocument>,
    @InjectModel(CrmOpportunity.name)
    private readonly opportunities: Model<CrmOpportunityDocument>,
  ) {}

  async crmOf(organizationId: string, userId: string, now: Date): Promise<BriefCrmInput> {
    const today = kinshasaDayOf(now);
    const [rows, openOpportunityCount] = await Promise.all([
      this.activities
        .find(
          // `AAAA-MM-JJ` : l'ordre des chaînes est celui des jours ; `null` exclu.
          { organizationId, done: false, dueDay: { $ne: null, $lte: today } },
          { _id: 0, dueDay: 1, assigneeUserId: 1 },
        )
        .sort({ dueDay: 1, _id: 1 })
        .limit(MAX_BRIEF_CRM_ACTIVITIES + 1)
        .lean()
        .exec() as unknown as Promise<Row[]>,
      this.opportunities.countDocuments({ organizationId, status: 'open' }).exec(),
    ]);
    const truncated = rows.length > MAX_BRIEF_CRM_ACTIVITIES;
    const activities: BriefCrmActivityInput[] = rows
      .slice(0, MAX_BRIEF_CRM_ACTIVITIES)
      .map((r) => ({ dueDay: r.dueDay, mine: r.assigneeUserId === userId }));
    return { status: 'known', activities, openOpportunityCount, truncated };
  }
}
