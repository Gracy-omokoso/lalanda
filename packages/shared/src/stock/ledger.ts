// Contrats du grand livre : niveaux, mouvements, correction de coût, valorisation,
// réapprovisionnement, rapports (ADR-0046 § 2.3, § 2.5, § 5.1, § 7.1). ADR-0046 — S3.
//
// Les nombres viennent du moteur `@lalanda/engine` (`stock`) ; l'API ne fait que les
// servir. Sans `purchase.read` ni `treasury.read`, chaque champ de valeur vaut `null`
// et `valuesHidden` est `true` (§ 5).

import { z } from 'zod';

import {
  StockCalendarDay,
  StockExpectedRevision,
  StockId,
  StockUnitCost,
  stockRequiredText,
} from './common.js';
import {
  STOCK_LIMITS,
  type StockCostStatus,
  type StockCurrency,
  type StockMovementKind,
  type StockMovementSourceKind,
} from './constants.js';
import { StockCursor, StockPageLimit } from './referential.js';

// ── Niveaux (§ 2.5) ─────────────────────────────────────────────────────────

export const ListStockLevelsQuery = z
  .object({
    locationId: StockId.optional(),
    itemId: StockId.optional(),
    /** `reorder` : seulement les articles sous leur seuil. */
    below: z.enum(['reorder']).optional(),
  })
  .strict();
export type ListStockLevelsQuery = z.output<typeof ListStockLevelsQuery>;

export interface StockLevelView {
  itemId: string;
  itemCode: string | null;
  itemName: string;
  unit: string;
  locationId: string;
  locationName: string | null;
  /** Trois décimales, signée (un stock constaté peut être négatif, O4). */
  quantity: string;
  lastMovementAt: string | null;
}

/** Suggestion du moteur (`replenishmentSuggestions`), enrichie des noms. */
export interface StockReorderAlertView {
  itemId: string;
  itemCode: string | null;
  itemName: string;
  unit: string;
  /** `null` : seuil global (tous emplacements). */
  locationId: string | null;
  locationName: string | null;
  available: string;
  minQuantity: string;
  targetQuantity: string | null;
  /** Commandé non reçu (lu des achats par le lot S4 ; `0` sans lui). */
  onOrder: string;
  suggestedQuantity: string;
  preferredSupplierId: string | null;
}

export interface StockLevelsResponse {
  version: string;
  levels: StockLevelView[];
  /** Articles sous le seuil (§ 6.8 : la tuile de l'Accueil en lit le nombre). */
  belowReorder: StockReorderAlertView[];
}

export interface StockLevelDriftView {
  code: 'STOCK_LEVEL_DRIFT';
  itemId: string;
  locationId: string;
  cached: string;
  ledger: string;
  difference: string;
}

/** `POST /stock/levels/rebuild` : écarts constatés (moteur) puis rétablis. */
export interface StockLevelsRebuildReport {
  version: string;
  ok: boolean;
  drifts: StockLevelDriftView[];
  rebuilt: number;
}

// ── Mouvements (§ 2.3) ──────────────────────────────────────────────────────

export const ListStockMovementsQuery = z
  .object({
    locationId: StockId.optional(),
    from: StockCalendarDay.optional(),
    to: StockCalendarDay.optional(),
    cursor: StockCursor.optional(),
    limit: StockPageLimit,
  })
  .strict();
export type ListStockMovementsQuery = z.output<typeof ListStockMovementsQuery>;

export type StockMovementSourceView =
  | { kind: 'reception'; receptionId: string; orderLineId: string }
  | { kind: 'invoice'; invoiceId: string; lineIndex: number }
  | { kind: 'voucher'; voucherId: string; lineId: string }
  | { kind: 'count'; countId: string; lineId: string }
  | { kind: 'pending'; pendingLineId: string };

export interface StockMovementView {
  id: string;
  itemId: string;
  locationId: string;
  kind: StockMovementKind;
  /** Signée : entrées > 0, sorties < 0. */
  quantity: string;
  occurredOn: string;
  costStatus: StockCostStatus;
  /** Coût unitaire saisi d'une entrée valorisée ; `null` si masqué ou sans objet. */
  unitCost: string | null;
  /** Valeur d'une entrée ou coût d'une sortie (rejeu du moteur) ; `null` si masqué. */
  value: string | null;
  source: StockMovementSourceView & { kind: StockMovementSourceKind };
  sourceKey: string;
  workProjectId: string | null;
  transferId: string | null;
  reason: { key: string; note: string | null } | null;
  reversalOf: string | null;
  recordedAt: string;
  createdBy: string;
  revision: number;
}

export interface StockMovementPage {
  items: StockMovementView[];
  nextCursor: string | null;
  valuesHidden: boolean;
}

/**
 * `PUT /stock/movements/:id/cost` — seule correction permise d'un mouvement (§ 2.3.1) :
 * le coût unitaire d'une ENTRÉE, dans la devise de l'article (aucun taux).
 */
export const UpdateStockMovementCostBody = z
  .object({
    unitCost: StockUnitCost,
    reason: stockRequiredText(STOCK_LIMITS.reason, 'Motif'),
    expectedRevision: StockExpectedRevision,
  })
  .strict();
export type UpdateStockMovementCostBody = z.output<typeof UpdateStockMovementCostBody>;

// ── Valorisation, réapprovisionnement, rapports (§ 5.1, § 7.1) ──────────────

export const StockValuationQuery = z
  .object({ on: StockCalendarDay.optional(), locationId: StockId.optional() })
  .strict();
export type StockValuationQuery = z.output<typeof StockValuationQuery>;

export interface StockValuationResponse {
  version: string;
  until: string | null;
  locationId: string | null;
  items: {
    itemId: string;
    itemName: string;
    currency: StockCurrency;
    quantity: string;
    value: string;
    averageUnitCost: string | null;
    complete: boolean;
  }[];
  /** Σ par devise ; jamais de total toutes devises. */
  byCurrency: { currency: StockCurrency; value: string; itemCount: number; complete: boolean }[];
}

export interface StockReplenishmentResponse {
  version: string;
  suggestions: StockReorderAlertView[];
}

export const StockReportsQuery = z
  .object({ from: StockCalendarDay, to: StockCalendarDay })
  .strict()
  .refine((q) => q.from <= q.to, {
    message: 'La période commence après sa fin.',
    params: { code: 'INVALID_PERIOD' },
    path: ['to'],
  });
export type StockReportsQuery = z.output<typeof StockReportsQuery>;

export interface StockKindTotalView {
  kind: StockMovementKind;
  quantity: string;
  value: string | null;
  count: number;
  unvaluedCount: number;
}

/** Rapport du moteur (`stockReport`), valeurs masquées si `valuesHidden`. */
export interface StockReportResponse {
  version: string;
  period: { from: string; to: string };
  items: {
    itemId: string;
    itemName: string;
    currency: StockCurrency;
    openingQuantity: string;
    openingValue: string | null;
    entries: StockKindTotalView[];
    exits: StockKindTotalView[];
    transfersQuantity: string;
    closingQuantity: string;
    closingValue: string | null;
    complete: boolean;
  }[];
  byCurrency: {
    currency: StockCurrency;
    openingValue: string | null;
    entriesValue: string | null;
    exitsCost: string | null;
    costOfSales: string | null;
    consumption: string | null;
    closingValue: string | null;
    complete: boolean;
  }[];
  byProject: {
    workProjectId: string;
    currency: StockCurrency;
    consumedValue: string | null;
    issueCount: number;
    unvaluedCount: number;
  }[];
  valuesHidden: boolean;
}
