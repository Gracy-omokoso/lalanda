// Rattachement RUN → BUILD partagé — ADR-0031 § 3 et ADR-0034 § 5, amendements
// du 26 oct. 2026 (décision ouverte n° 10 d'ADR-0034, tranchée : réglage commun).
//
// Les deux ponts vers le réalisé (ventes et dépenses) écrivent dans le MÊME
// projet, avec le MÊME mois civil d'ouverture de l'exercice 1 : deux valeurs
// différentes rangeraient une vente et une dépense du même mois civil dans deux
// mois d'exercice différents, et le réalisé deviendrait incohérent. Ce réglage
// vit donc une seule fois, dans le document de l'organisation
// `run_actuals_bridges` (`projectId`, `exerciseStart`) ; chaque pont garde son
// interrupteur et sa cible propres (ventes : `enabled`, `revenueLineId` dans ce
// même document ; dépenses : `treasury_settings.bridge.enabled` et `.mapping`).
//
// Règle de modification : on ne change pas le rattachement sous un pont ACTIF
// qui n'est pas celui qu'on règle (`409 RUN_LINK_IN_USE`) — il faut d'abord le
// désactiver, sinon ses valeurs déjà reportées changeraient de projet ou de mois
// d'exercice sans que personne ne l'ait décidé.

import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import {
  RunActualsBridge,
  type RunActualsBridgeDocument,
} from '../run-bridge/run-actuals-bridge.schema.js';

/** Rattachement commun : projet relié et mois civil qui ouvre l'exercice 1. */
export interface RunLink {
  projectId: string | null;
  exerciseStart: string | null;
}

/** Rattachement et état du pont des ventes, lus d'un seul document. */
export interface RunLinkState extends RunLink {
  salesEnabled: boolean;
  salesRevenueLineId: string | null;
}

export function sameRunLink(a: RunLink, b: RunLink): boolean {
  return a.projectId === b.projectId && a.exerciseStart === b.exerciseStart;
}

/** Refus d'un changement de rattachement sous l'autre pont actif. */
export function runLinkInUse(otherBridge: 'sales' | 'expenses'): never {
  throw new ConflictException({
    code: 'RUN_LINK_IN_USE',
    message:
      otherBridge === 'sales'
        ? 'Le pont des ventes est actif sur ce projet et ce début d’exercice : désactivez-le avant de changer le rattachement commun.'
        : 'Le report des dépenses est actif sur ce projet et ce début d’exercice : désactivez-le avant de changer le rattachement commun.',
    details: { otherBridge },
  });
}

@Injectable()
export class RunLinkService {
  constructor(
    @InjectModel(RunActualsBridge.name) private readonly bridges: Model<RunActualsBridgeDocument>,
  ) {}

  async state(organizationId: string): Promise<RunLinkState> {
    const doc = await this.bridges.findOne({ organizationId }).lean().exec();
    return {
      projectId: doc?.projectId ?? null,
      exerciseStart: doc?.exerciseStart ?? null,
      salesEnabled: doc?.enabled ?? false,
      salesRevenueLineId: doc?.revenueLineId ?? null,
    };
  }

  /**
   * Écrit le rattachement depuis le report des DÉPENSES. Refusé si le pont des
   * ventes est actif et que le rattachement change. Le document est créé, pont
   * des ventes désactivé, s'il n'existait pas.
   */
  async setFromExpenses(organizationId: string, link: RunLink, userId: string): Promise<void> {
    const current = await this.state(organizationId);
    if (sameRunLink(current, link)) return;
    if (current.salesEnabled) runLinkInUse('sales');
    const res = await this.bridges
      .updateOne(
        // Condition sur l'interrupteur des ventes : s'il vient d'être activé, rien
        // n'est écrit et le refus est rendu.
        { organizationId, enabled: { $ne: true } },
        {
          $set: { projectId: link.projectId, exerciseStart: link.exerciseStart, updatedBy: userId },
          $setOnInsert: { enabled: false, revenueLineId: null, lastSync: null, _schemaVersion: 1 },
        },
        { upsert: true },
      )
      .exec()
      .catch((err: unknown) => {
        // E11000 : le document existe avec `enabled: true` (le filtre ne l'a pas vu).
        if ((err as { code?: number }).code === 11000) runLinkInUse('sales');
        throw err;
      });
    if (res.matchedCount === 0 && res.upsertedCount === 0) runLinkInUse('sales');
  }
}
