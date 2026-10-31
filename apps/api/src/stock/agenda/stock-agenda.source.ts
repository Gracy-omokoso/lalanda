// Fournisseur réel du port `STOCK_AGENDA_SOURCE` de « Mes tâches » — ADR-0046 § 6.7.
// ADR-0046 — S7.
//
// LECTURE SEULE (`stock_counts`, `stock_locations`, `stock_pending_lines`), organisation
// de la session : rien n'est copié dans `work_tasks`. Trois natures d'éléments, chacune
// derrière le droit EFFECTIF qui permet d'agir (passé par `WorkTasksService.myTasks`) :
//   - inventaires `counting` dont l'appelant est compteur (`stock.count`) ;
//   - inventaires `submitted` qu'il peut valider (`stock.manage`), séparation des tâches
//     jugée par `stockCountDecision` (celui qui a compté ne valide pas, sauf approbateur
//     unique) : un compteur ne voit donc pas l'inventaire « à valider » ;
//   - lignes « À traiter » ouvertes, regroupées en UN élément (`stock.move`).
// Aucune valeur, aucun coût, aucune quantité théorique (comptage à l'aveugle).

import {
  STOCK_AGENDA_KIND_LABELS,
  stockAgendaHref,
  stockAgendaId,
  type StockMyTaskItem,
} from '@lalanda/shared/stock';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';

import { AuthzService } from '../../authz/authz.service.js';
import { stockCountDecision } from '../../authz/permissions.js';
import type {
  StockAgendaActor,
  StockAgendaPage,
  StockAgendaReader,
} from '../../work/my-tasks.ports.js';
import { stockToday } from '../stock.common.js';
import type { StockCountLean } from '../stock.schemas.js';

/** Utilisateurs qui ont saisi une quantité (recomptages compris) — motif de S3. */
export function countersOf(d: Pick<StockCountLean, 'lines'>): string[] {
  return [
    ...new Set(
      (d.lines ?? []).flatMap((l) => [
        ...(l.countedBy ? [l.countedBy] : []),
        ...(l.recounts ?? []).map((r) => r.countedBy),
      ]),
    ),
  ];
}

const dayOf = (at: Date | string | null | undefined): string =>
  stockToday(at ? new Date(at) : new Date());

@Injectable()
export class StockAgendaSource implements StockAgendaReader {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  async agendaOf(
    organizationId: string,
    actor: StockAgendaActor,
    limit: number,
  ): Promise<StockAgendaPage> {
    const or: Record<string, unknown>[] = [];
    if (actor.holdsCount) or.push({ status: 'counting', assignees: actor.userId });
    if (actor.holdsManage) or.push({ status: 'submitted' });
    const [counts, pending] = await Promise.all([
      or.length === 0
        ? Promise.resolve([] as StockCountLean[])
        : (this.connection
            .collection('stock_counts')
            .find(
              { organizationId, $or: or },
              {
                projection: {
                  number: 1,
                  locationId: 1,
                  status: 1,
                  assignees: 1,
                  'lines.countedBy': 1,
                  'lines.recounts.countedBy': 1,
                  submission: 1,
                  createdAt: 1,
                },
              },
            )
            .sort({ createdAt: 1, _id: 1 })
            .limit(limit + 1)
            .toArray() as unknown as Promise<StockCountLean[]>),
      actor.holdsMove ? this.pendingOf(organizationId) : Promise.resolve(null),
    ]);

    const submitted = counts.filter((c) => c.status === 'submitted');
    const approvers =
      submitted.length > 0 ? await this.authz.countApprovers(organizationId, 'stock.manage') : 0;
    const locationIds = [...new Set(counts.map((c) => c.locationId))].filter((id) =>
      Types.ObjectId.isValid(id),
    );
    const names = new Map<string, string>();
    if (locationIds.length > 0) {
      for (const l of await this.connection
        .collection('stock_locations')
        .find(
          { organizationId, _id: { $in: locationIds.map((id) => new Types.ObjectId(id)) } },
          { projection: { name: 1 } },
        )
        .toArray()) {
        names.set(String(l['_id']), String(l['name']));
      }
    }

    const items: StockMyTaskItem[] = [];
    for (const c of counts.slice(0, limit)) {
      const countId = String(c._id);
      const where = names.get(c.locationId);
      const label = `Inventaire ${c.number}${where ? ` — ${where}` : ''}`;
      if (c.status === 'counting') {
        items.push({
          source: 'stock',
          kind: 'count_to_count',
          id: stockAgendaId('count_to_count', countId),
          title: label,
          dueDate: dayOf(c.createdAt),
          priority: 'none',
          rank: new Date(c.createdAt).toISOString(),
          done: false,
          kindLabel: STOCK_AGENDA_KIND_LABELS.count_to_count,
          href: stockAgendaHref('count_to_count', countId),
        });
        continue;
      }
      const decision = stockCountDecision({
        validatorUserId: actor.userId,
        counterUserIds: countersOf(c),
        approverCountInOrg: approvers,
      });
      if (!decision.ok) continue;
      const at = c.submission?.at ?? c.createdAt;
      items.push({
        source: 'stock',
        kind: 'count_to_validate',
        id: stockAgendaId('count_to_validate', countId),
        title: label,
        dueDate: dayOf(at),
        priority: 'none',
        rank: new Date(at).toISOString(),
        done: false,
        kindLabel: STOCK_AGENDA_KIND_LABELS.count_to_validate,
        href: stockAgendaHref('count_to_validate', countId),
      });
    }
    if (pending !== null && pending.count > 0) {
      items.push({
        source: 'stock',
        kind: 'pending_lines',
        id: stockAgendaId('pending_lines'),
        title:
          pending.count > 1
            ? `${pending.count} lignes « À traiter » dans le magasin`
            : '1 ligne « À traiter » dans le magasin',
        dueDate: dayOf(pending.oldest),
        priority: 'none',
        rank: new Date(pending.oldest).toISOString(),
        done: false,
        kindLabel: STOCK_AGENDA_KIND_LABELS.pending_lines,
        href: stockAgendaHref('pending_lines'),
      });
    }
    return { items, truncated: counts.length > limit };
  }

  private async pendingOf(organizationId: string): Promise<{ count: number; oldest: Date } | null> {
    const filter = { organizationId, status: 'open' };
    const [count, first] = await Promise.all([
      this.connection.collection('stock_pending_lines').countDocuments(filter),
      this.connection
        .collection('stock_pending_lines')
        .find(filter, { projection: { createdAt: 1 } })
        .sort({ createdAt: 1 })
        .limit(1)
        .toArray(),
    ]);
    if (count === 0 || first.length === 0) return null;
    return { count, oldest: new Date(first[0]!['createdAt'] as Date) };
  }
}
