// Fournisseur réel du port `ASSETS_AGENDA_SOURCE` de « Mes tâches » — ADR-0046 § 6.7.
// ADR-0046 — S7.
//
// LECTURE SEULE, organisation de la session. Les maintenances retenues sont celles que
// le MOTEUR des équipements déclare dues ou en retard (`assetDeadlines`, délai des
// réglages) ; l'appelant en est responsable s'il gère les équipements (`assets.manage`
// effectif) ou si l'équipement lui est affecté (comme membre, ou comme collaborateur
// dont la fiche RH porte son compte). Appelé seulement avec `assets.read`. Ni coût, ni
// prestataire, ni note : un titre, une date, un lien.

import { assetsAgendaHref, assetsAgendaId, type AssetsMyTaskItem } from '@lalanda/shared/assets';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import type {
  AssetsAgendaActor,
  AssetsAgendaPage,
  AssetsAgendaReader,
} from '../../work/my-tasks.ports.js';
import { assetsToday } from '../assets-common.js';
import { AssetsService } from '../registry/assets.service.js';

@Injectable()
export class AssetsAgendaSource implements AssetsAgendaReader {
  constructor(
    @Inject(AssetsService) private readonly assets: AssetsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async agendaOf(
    organizationId: string,
    actor: AssetsAgendaActor,
    limit: number,
    now: Date,
  ): Promise<AssetsAgendaPage> {
    const { result, assets } = await this.assets.deadlinesOf(organizationId, assetsToday(now));
    const due = result.deadlines.filter(
      (d) => (d.kind === 'maintenance_overdue' || d.kind === 'maintenance_due_soon') && d.refId,
    );
    if (due.length === 0) return { items: [], truncated: false };

    let mine: (assetId: string) => boolean = () => true;
    if (!actor.holdsManage) {
      const employees = await this.connection
        .collection('hr_employees')
        .find({ organizationId, userId: actor.userId }, { projection: { _id: 1 } })
        .toArray();
      const employeeIds = new Set(employees.map((e) => String(e['_id'])));
      mine = (assetId) => {
        const a = assets.get(assetId)?.currentAssignment?.assignee;
        if (!a) return false;
        if (a.kind === 'member') return a.userId === actor.userId;
        if (a.kind === 'employee') return employeeIds.has(a.employeeId);
        return false;
      };
    }
    const kept = due.filter((d) => mine(d.assetId));
    const items: AssetsMyTaskItem[] = kept.slice(0, limit).map((d) => {
      const asset = assets.get(d.assetId);
      const maintenanceId = d.refId as string;
      return {
        source: 'assets',
        kind: 'maintenance',
        id: assetsAgendaId(maintenanceId),
        assetId: d.assetId,
        maintenanceId,
        title: asset ? `${asset.number} ${asset.name}` : 'Équipement',
        dueDate: d.date,
        priority: 'none',
        rank: `${d.date}:${maintenanceId}`,
        done: false,
        kindLabel: 'Maintenance',
        href: assetsAgendaHref(d.assetId),
      };
    });
    return { items, truncated: kept.length > limit };
  }
}
