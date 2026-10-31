// Contrats des inventaires (ADR-0046 § 2.7, § 5.1). ADR-0046 — S3.
//
// `draft` → `counting` (lignes figées) → `submitted` → `validated` | `cancelled`.
// Comptage à l'aveugle par défaut : la quantité théorique et les écarts ne sont servis
// qu'aux détenteurs de `stock.manage`, et seulement une fois l'inventaire soumis.
// Validation : `stockCountDecision` (celui qui a compté ne valide pas, sauf approbateur
// unique) ; un mouvement `count_adjustment` par écart non nul.

import { z } from 'zod';

import {
  StockExpectedRevision,
  StockId,
  StockQuantity,
  StockUnitCost,
  stockFr,
  stockIssue,
  stockOptionalText,
  stockRequiredText,
} from './common.js';
import {
  STOCK_COUNT_SCOPES,
  STOCK_COUNT_STATUSES,
  STOCK_LIMITS,
  type StockCountScope,
  type StockCountStatus,
  type StockCurrency,
} from './constants.js';
import { StockCursor, StockPageLimit } from './referential.js';

const L = STOCK_LIMITS;

export const CreateStockCountBody = z
  .object({
    locationId: StockId,
    scope: z.enum(STOCK_COUNT_SCOPES, stockFr('Portée attendue : all ou items.')).default('all'),
    /** `items` : 1 à 500 articles (inventaire tournant). */
    itemIds: z.array(StockId).max(L.countItems).optional(),
    blind: z.boolean().default(true),
    /** Utilisateurs chargés du comptage (« Mes tâches »). */
    assignees: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
    note: stockOptionalText(L.reason).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.scope === 'items' && (c.itemIds === undefined || c.itemIds.length === 0)) {
      stockIssue(ctx, 'FIELD_REQUIRED', 'Choisissez au moins un article.', ['itemIds']);
    }
    if (c.scope === 'all' && c.itemIds !== undefined && c.itemIds.length > 0) {
      stockIssue(ctx, 'FIELD_NOT_ALLOWED', 'Pas de liste d’articles pour un inventaire complet.', [
        'itemIds',
      ]);
    }
  });
export type CreateStockCountBody = z.output<typeof CreateStockCountBody>;

/** Saisie (ou recomptage) d'une ligne. Le coût saisi (stock initial) exige `stock.manage`. */
export const CountStockLineBody = z
  .object({
    countedQuantity: StockQuantity,
    unitCost: StockUnitCost.nullable().optional(),
    note: stockOptionalText(L.lineNote).optional(),
  })
  .strict();
export type CountStockLineBody = z.output<typeof CountStockLineBody>;

export const StockCountRevisionBody = z
  .object({ expectedRevision: StockExpectedRevision })
  .strict();
export type StockCountRevisionBody = z.output<typeof StockCountRevisionBody>;

export const ValidateStockCountBody = z
  .object({
    comment: stockOptionalText(L.reason).optional(),
    expectedRevision: StockExpectedRevision,
  })
  .strict();
export type ValidateStockCountBody = z.output<typeof ValidateStockCountBody>;

export const CancelStockCountBody = z
  .object({
    reason: stockRequiredText(L.reason, 'Motif'),
    expectedRevision: StockExpectedRevision,
  })
  .strict();
export type CancelStockCountBody = z.output<typeof CancelStockCountBody>;

export const ListStockCountsQuery = z
  .object({
    status: z.enum(STOCK_COUNT_STATUSES).optional(),
    locationId: StockId.optional(),
    cursor: StockCursor.optional(),
    limit: StockPageLimit,
  })
  .strict();
export type ListStockCountsQuery = z.output<typeof ListStockCountsQuery>;

export interface StockCountEntryView {
  countedQuantity: string;
  countedAt: string;
  countedBy: string;
}

export interface StockCountLineView {
  id: string;
  itemId: string;
  itemCode: string | null;
  itemName: string | null;
  unit: string | null;
  countedQuantity: string | null;
  countedAt: string | null;
  countedBy: string | null;
  note: string | null;
  /** Coût saisi (stock initial) ; `null` si masqué. */
  unitCost: string | null;
  recounts: StockCountEntryView[];
  /** Théorique à l'instant du comptage (moteur) ; `null` si masqué (aveugle). */
  theoretical: string | null;
  variance: string | null;
  /** Écart valorisé ; `null` si masqué ou non valorisable. */
  valuedVariance: string | null;
  currency: StockCurrency | null;
  /** Écart positif d'un article jamais valorisé, sans coût saisi. */
  needsUnitCost: boolean;
}

export interface StockCountView {
  id: string;
  number: string;
  locationId: string;
  locationName: string | null;
  scope: StockCountScope;
  status: StockCountStatus;
  blind: boolean;
  assignees: string[];
  note: string | null;
  lines: StockCountLineView[];
  /** Totaux du moteur par devise ; `null` si masqués. */
  variances: {
    byCurrency: {
      currency: StockCurrency;
      gains: string | null;
      losses: string | null;
      net: string | null;
      unvaluedLineCount: number;
    }[];
    countedLineCount: number;
    varianceLineCount: number;
  } | null;
  /** La quantité théorique n'est pas servie à cet appelant (comptage à l'aveugle). */
  theoreticalHidden: boolean;
  valuesHidden: boolean;
  submission: { at: string; by: string } | null;
  validation: { at: string; by: string; comment: string | null; soleApprover: boolean } | null;
  cancellation: { at: string; by: string; reason: string } | null;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface StockCountPage {
  items: StockCountView[];
  nextCursor: string | null;
}
