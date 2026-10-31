// Contrats des bons : sortie, retour au magasin, transfert, ajustement, retour
// fournisseur (ADR-0046 § 2.4, § 5.1, O4). ADR-0046 — S3.
//
// Un bon naît `draft`, se comptabilise (`post` : mouvements écrits dans une transaction
// unique, `409 STOCK_INSUFFICIENT` au-delà du disponible sauf
// `allowNegativeManualMoves`) puis peut s'annuler (contre-mouvements, motif). Un
// ajustement exige `stock.manage` et un motif de la liste réglable.

import { z } from 'zod';

import {
  StockCalendarDay,
  StockExpectedRevision,
  StockId,
  StockPositiveQuantity,
  StockUnitCost,
  stockFr,
  stockIssue,
  stockOptionalText,
  stockRequiredText,
} from './common.js';
import {
  STOCK_LIMITS,
  STOCK_VOUCHER_KINDS,
  STOCK_VOUCHER_STATUSES,
  type StockVoucherKind,
  type StockVoucherStatus,
} from './constants.js';
import { StockCursor, StockPageLimit } from './referential.js';

const L = STOCK_LIMITS;

export const StockVoucherKindSchema = z.enum(
  STOCK_VOUCHER_KINDS,
  stockFr('Type de bon attendu : issue, issue_return, transfer, adjustment ou supplier_return.'),
);

/** Sens d'une ligne d'AJUSTEMENT (les autres bons ont un sens fixé par leur type). */
export const STOCK_ADJUSTMENT_DIRECTIONS = ['in', 'out'] as const;
export type StockAdjustmentDirection = (typeof STOCK_ADJUSTMENT_DIRECTIONS)[number];

export const StockVoucherLineInput = z
  .object({
    /** Identifiant de ligne stable (réécrit à l'enregistrement s'il manque). */
    id: z.string().trim().min(1).max(64).optional(),
    itemId: StockId,
    /** > 0, en unité de stock. */
    quantity: StockPositiveQuantity,
    /** Ajustement seulement : entrée ou sortie. */
    direction: z.enum(STOCK_ADJUSTMENT_DIRECTIONS).optional(),
    /** Ajustement en entrée seulement : coût saisi ; absent → coût moyen courant. */
    unitCost: StockUnitCost.nullable().optional(),
    note: stockOptionalText(L.lineNote).optional(),
  })
  .strict();
export type StockVoucherLineInput = z.output<typeof StockVoucherLineInput>;

const voucherFields = {
  fromLocationId: StockId.nullable().optional(),
  toLocationId: StockId.nullable().optional(),
  /** Date civile du fait, jamais future (vérifié par le service). */
  postedOn: StockCalendarDay,
  lines: z
    .array(StockVoucherLineInput, stockFr('Lignes attendues.'))
    .min(1, { message: 'Au moins une ligne.' })
    .max(L.voucherLines, { message: `${L.voucherLines} lignes au plus.` }),
  /** Bon de sortie, retour au magasin : projet consommateur. */
  workProjectId: StockId.nullable().optional(),
  /** Bénéficiaire libre. */
  recipient: stockOptionalText(L.reason).optional(),
  /** Bénéficiaire collaborateur (R4, nom seulement). */
  employeeId: StockId.nullable().optional(),
  /** Retour fournisseur : fiche et réception d'origine (informatif). */
  supplierId: StockId.nullable().optional(),
  receptionId: StockId.nullable().optional(),
  /** Ajustement : clé d'un motif des réglages, texte libre en plus. */
  reason: z
    .object({
      key: z.string().trim().min(1).max(40),
      note: stockOptionalText(L.reason).optional(),
    })
    .strict()
    .nullable()
    .optional(),
  note: stockOptionalText(L.reason).optional(),
};

type VoucherShape = {
  kind: StockVoucherKind;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  lines: StockVoucherLineInput[];
  reason?: { key: string } | null;
};

/** Règles de forme selon le type (emplacements, sens, motif). */
function refineVoucher(v: VoucherShape, ctx: z.RefinementCtx): void {
  const from = v.fromLocationId ?? null;
  const to = v.toLocationId ?? null;
  const needFrom = v.kind !== 'issue_return';
  const needTo = v.kind === 'transfer' || v.kind === 'issue_return';
  if (needFrom && from === null) {
    stockIssue(ctx, 'FIELD_REQUIRED', 'Emplacement de départ obligatoire.', ['fromLocationId']);
  }
  if (needTo && to === null) {
    stockIssue(ctx, 'FIELD_REQUIRED', 'Emplacement d’arrivée obligatoire.', ['toLocationId']);
  }
  if (!needTo && to !== null) {
    stockIssue(ctx, 'FIELD_NOT_ALLOWED', 'Pas d’emplacement d’arrivée pour ce bon.', [
      'toLocationId',
    ]);
  }
  if (v.kind === 'issue_return' && from !== null) {
    stockIssue(ctx, 'FIELD_NOT_ALLOWED', 'Pas d’emplacement de départ pour un retour.', [
      'fromLocationId',
    ]);
  }
  if (v.kind === 'transfer' && from !== null && from === to) {
    stockIssue(
      ctx,
      'STOCK_TRANSFER_SAME_LOCATION',
      'Un transfert relie deux emplacements distincts.',
      ['toLocationId'],
    );
  }
  if (v.kind === 'adjustment' && (v.reason === undefined || v.reason === null)) {
    stockIssue(ctx, 'FIELD_REQUIRED', 'Motif d’ajustement obligatoire.', ['reason']);
  }
  v.lines.forEach((line, i) => {
    if (v.kind === 'adjustment' && line.direction === undefined) {
      stockIssue(ctx, 'FIELD_REQUIRED', 'Sens de la ligne obligatoire (in ou out).', [
        'lines',
        i,
        'direction',
      ]);
    }
    if (v.kind !== 'adjustment' && line.direction !== undefined) {
      stockIssue(ctx, 'FIELD_NOT_ALLOWED', 'Le sens ne se choisit que pour un ajustement.', [
        'lines',
        i,
        'direction',
      ]);
    }
    const hasCost = line.unitCost !== undefined && line.unitCost !== null;
    if (hasCost && !(v.kind === 'adjustment' && line.direction === 'in')) {
      stockIssue(
        ctx,
        'FIELD_NOT_ALLOWED',
        'Un coût ne se saisit que sur une entrée d’ajustement.',
        ['lines', i, 'unitCost'],
      );
    }
  });
}

export const CreateStockVoucherBody = z
  .object({ kind: StockVoucherKindSchema, ...voucherFields })
  .strict()
  .superRefine(refineVoucher);
export type CreateStockVoucherBody = z.output<typeof CreateStockVoucherBody>;

/** Modification d'un brouillon : le type ne change pas ; corps complet. */
export const UpdateStockVoucherBody = z
  .object({ ...voucherFields, expectedRevision: StockExpectedRevision })
  .strict();
export type UpdateStockVoucherBody = z.output<typeof UpdateStockVoucherBody>;

/** Contrôle de forme d'un brouillon modifié, une fois son type connu (service). */
export function refineStockVoucherUpdate(
  kind: StockVoucherKind,
  body: UpdateStockVoucherBody,
): z.ZodSafeParseResult<unknown> {
  return z
    .unknown()
    .superRefine((_, ctx) => refineVoucher({ ...body, kind }, ctx))
    .safeParse(null);
}

export const CancelStockVoucherBody = z
  .object({
    reason: stockRequiredText(L.reason, 'Motif'),
    expectedRevision: StockExpectedRevision,
  })
  .strict();
export type CancelStockVoucherBody = z.output<typeof CancelStockVoucherBody>;

export const ListStockVouchersQuery = z
  .object({
    kind: StockVoucherKindSchema.optional(),
    status: z.enum(STOCK_VOUCHER_STATUSES).optional(),
    cursor: StockCursor.optional(),
    limit: StockPageLimit,
  })
  .strict();
export type ListStockVouchersQuery = z.output<typeof ListStockVouchersQuery>;

export interface StockVoucherLineView {
  id: string;
  itemId: string;
  itemName: string | null;
  unit: string | null;
  quantity: string;
  direction: StockAdjustmentDirection | null;
  /** Coût saisi d'une entrée d'ajustement ; `null` si masqué. */
  unitCost: string | null;
  note: string | null;
}

export interface StockVoucherView {
  id: string;
  number: string;
  kind: StockVoucherKind;
  status: StockVoucherStatus;
  fromLocationId: string | null;
  toLocationId: string | null;
  postedOn: string;
  lines: StockVoucherLineView[];
  workProjectId: string | null;
  recipient: string | null;
  employeeId: string | null;
  supplierId: string | null;
  receptionId: string | null;
  reason: { key: string; note: string | null } | null;
  note: string | null;
  posting: { at: string; by: string } | null;
  cancellation: { at: string; by: string; reason: string } | null;
  /** Stock négatif atteint au comptabilisé (`allowNegativeManualMoves`) : alerte. */
  wentNegative: boolean;
  valuesHidden: boolean;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface StockVoucherPage {
  items: StockVoucherView[];
  nextCursor: string | null;
}
