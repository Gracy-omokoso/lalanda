// Contrats de la file « À traiter » (ADR-0046 § 2.6, § 5.1). ADR-0046 — S3.
//
// Une ligne à traiter est ouverte par un BRANCHEMENT (lot S4 : réception d'achat dont
// l'article ou l'unité est inconnu, entrée en devise différente, avoir de vente, coût
// différent de la facture) avec une PROPOSITION de mouvement ; S3 la résout (`stock.move`,
// sauf coût : `stock.manage`) ou la classe. Elle ne disparaît jamais : `resolved` ou
// `dismissed` (qui, quand, motif).

import { z } from 'zod';

import {
  StockConversionFactor,
  StockExpectedRevision,
  StockId,
  StockPositiveQuantity,
  StockUnitCost,
  stockOptionalText,
  stockRequiredText,
} from './common.js';
import {
  STOCK_LIMITS,
  STOCK_PENDING_REASONS,
  STOCK_PENDING_STATUSES,
  type StockCurrency,
  type StockMovementKind,
  type StockPendingReason,
  type StockPendingStatus,
} from './constants.js';
import type { StockMovementSourceView } from './ledger.js';
import { StockCursor, StockPageLimit } from './referential.js';

/**
 * Proposition portée par une ligne à traiter : de quoi écrire le mouvement juste une
 * fois le manque comblé. Posée par le branchement (S4), jamais par l'utilisateur.
 */
export interface StockPendingProposal {
  /** Type du mouvement à écrire à la résolution. */
  movementKind: StockMovementKind;
  /** Clé d'idempotence du mouvement à écrire (`reception:<id>:<ligne>:in`…). */
  movementSourceKey: string;
  /** Origine du mouvement (réception, facture…). */
  source: StockMovementSourceView;
  /** Article reconnu, ou `null` (`unknown_item`). */
  itemId: string | null;
  /** Référence brute de la ligne d'origine (`itemRef` d'une commande). */
  itemRef: string | null;
  /** Libellé de la ligne d'origine (affichage). */
  label: string | null;
  /** Quantité POSITIVE dans `unit` (unité de la ligne d'origine). */
  quantity: string;
  unit: string;
  occurredOn: string;
  /** Emplacement ; `null` : emplacement par défaut de l'article. */
  locationId: string | null;
  /** Prix HT de la ligne d'origine, remise et devise : coût d'entrée (moteur). */
  unitPrice: string | null;
  discountPercent: string | null;
  currency: StockCurrency | null;
  workProjectId: string | null;
  /** Commande d'origine (mémorise le rattachement `itemRef` → article, § 2.6). */
  orderId: string | null;
  /** Mouvement existant visé (`pending_cost`, `cost_differs`). */
  movementId: string | null;
  /** Plafond de la quantité confirmée (`sale_return_proposed` : quantité créditée). */
  maxQuantity: string | null;
  /** Prix facturé ramené à l'unité de stock (`cost_differs`, informatif). */
  invoicedUnitCost: string | null;
}

/** Entrée du port d'ouverture (S4) : la clé `sourceKey` rend l'ouverture idempotente. */
export interface OpenStockPendingLineInput {
  reason: StockPendingReason;
  sourceKey: string;
  proposal: StockPendingProposal;
}

export const ListStockPendingQuery = z
  .object({
    /** Défaut : `open`. */
    status: z.enum(STOCK_PENDING_STATUSES).optional(),
    reason: z.enum(STOCK_PENDING_REASONS).optional(),
    cursor: StockCursor.optional(),
    limit: StockPageLimit,
  })
  .strict();
export type ListStockPendingQuery = z.output<typeof ListStockPendingQuery>;

/**
 * Résolution, selon le motif :
 * - `unknown_item` : `itemId` (+ `factor` ou `quantity` si l'unité est inconnue de
 *   l'article) ;
 * - `unknown_unit` : `factor` (ajouté aux conversions de l'article) ou `quantity` en
 *   unité de stock ;
 * - `pending_cost`, `cost_differs` : `unitCost` dans la devise de l'article
 *   (`stock.manage`) ;
 * - `sale_return_proposed` : `quantity` physiquement revenue (≤ créditée) et
 *   `locationId`.
 */
export const ResolveStockPendingBody = z
  .object({
    itemId: StockId.optional(),
    factor: StockConversionFactor.optional(),
    quantity: StockPositiveQuantity.optional(),
    unitCost: StockUnitCost.optional(),
    locationId: StockId.optional(),
    note: stockOptionalText(STOCK_LIMITS.reason).optional(),
    expectedRevision: StockExpectedRevision,
  })
  .strict();
export type ResolveStockPendingBody = z.output<typeof ResolveStockPendingBody>;

export const DismissStockPendingBody = z
  .object({
    reason: stockRequiredText(STOCK_LIMITS.reason, 'Motif'),
    expectedRevision: StockExpectedRevision,
  })
  .strict();
export type DismissStockPendingBody = z.output<typeof DismissStockPendingBody>;

export interface StockPendingLineView {
  id: string;
  reason: StockPendingReason;
  status: StockPendingStatus;
  sourceKey: string;
  proposal: StockPendingProposal;
  /** Mouvement écrit à la résolution (ou corrigé). */
  movementId: string | null;
  closure: { at: string; by: string; note: string | null } | null;
  valuesHidden: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface StockPendingPage {
  items: StockPendingLineView[];
  nextCursor: string | null;
}
