// Outils communs du module des équipements (ADR-0046 § 3, § 5). ADR-0046 — S5.
//
// Erreurs au format des contrôleurs d'achats (`{ code, message, details? }`), 404 pour
// toute ressource d'une autre organisation. Conversion des documents vers les entrées
// du moteur `@lalanda/engine` (assets) : le service ne calcule rien lui-même.

import type {
  AssetCoverageInput,
  AssetInput,
  AssetMaintenanceInput,
  AssetAssignmentInput,
} from '@lalanda/engine';
import { NotFoundException } from '@nestjs/common';
import type { ClientSession, Connection } from 'mongoose';

import { kinshasaDayOf } from '../sales/receipts/kinshasa-day.js';
import type {
  AssetAssignmentLean,
  AssetCoverageLean,
  AssetLean,
  AssetMaintenanceLean,
} from './assets.schemas.js';

export function assetNotFound(): never {
  throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Équipement introuvable.' });
}

export function maintenanceNotFound(): never {
  throw new NotFoundException({
    code: 'ASSET_MAINTENANCE_NOT_FOUND',
    message: 'Intervention introuvable.',
  });
}

export function coverageNotFound(): never {
  throw new NotFoundException({
    code: 'ASSET_COVERAGE_NOT_FOUND',
    message: 'Garantie, assurance ou contrat introuvable.',
  });
}

/** Jour civil de Kinshasa (ADR-0027). */
export function assetsToday(now: Date = new Date()): string {
  return kinshasaDayOf(now);
}

/** Exécute `fn` dans une transaction (motif des achats et des RH). */
export async function inAssetsTransaction<T>(
  connection: Connection,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession();
  try {
    let out!: T;
    await session.withTransaction(async () => {
      out = await fn(session);
    });
    return out;
  } finally {
    await session.endSession();
  }
}

// ── Entrées du moteur ───────────────────────────────────────────────────────

export function engineAssetOf(a: AssetLean): AssetInput {
  return {
    id: String(a._id),
    categoryId: a.categoryId,
    status: a.status,
    acquisition: {
      on: a.acquisition.on,
      cost: a.acquisition.cost,
      currency: a.acquisition.currency,
    },
    managementDepreciation: a.managementDepreciation
      ? {
          years: a.managementDepreciation.years,
          residualValue: a.managementDepreciation.residualValue,
          startOn: a.managementDepreciation.startOn,
        }
      : null,
    disposal: a.disposal ? { on: a.disposal.on, kind: a.disposal.kind } : null,
    currentAssignment: a.currentAssignment
      ? { assignee: a.currentAssignment.assignee, from: a.currentAssignment.from }
      : null,
  };
}

export function engineMaintenanceOf(m: AssetMaintenanceLean): AssetMaintenanceInput {
  return {
    id: String(m._id),
    assetId: m.assetId,
    kind: m.kind,
    status: m.status,
    plannedOn: m.plannedOn,
    doneOn: m.doneOn,
    cost: m.cost,
    currency: m.currency,
    recurrence: m.recurrence,
  };
}

export function engineCoverageOf(c: AssetCoverageLean): AssetCoverageInput {
  return {
    id: String(c._id),
    assetId: c.assetId,
    kind: c.kind,
    startOn: c.startOn,
    endOn: c.endOn,
    reminderDays: c.reminderDays,
    cost: c.cost,
    currency: c.currency,
  };
}

export function engineAssignmentOf(a: AssetAssignmentLean): AssetAssignmentInput {
  return {
    id: String(a._id),
    assetId: a.assetId,
    assignee: a.assignee,
    from: a.from,
    to: a.to,
  };
}

/** Borne du moteur pour un délai de rappel (`ASSET_REMINDER_DAYS_BOUNDS.max`). */
export const ENGINE_REMINDER_DAYS_MAX = 120;
