// Contrats des branchements achats et ventes, et du grand livre de tous les articles
// (ADR-0046 § 5.1, § 6.1, § 6.2). ADR-0046 — S4.
//
// `POST /stock/sync` lance à la demande les rattrapages `stock.purchase-sync` et
// `stock.sales-sync` de l'organisation active ; la réponse ne porte que des NOMBRES.
// `GET /stock/movements` : grand livre de tous les articles, filtrable et paginé ; les
// valeurs (coût unitaire, valeur) suivent la règle du § 5 (`valuesHidden`).

import { z } from 'zod';

import { StockCalendarDay, StockId, StockMovementKindSchema } from './common.js';
import type { StockCurrency } from './constants.js';
import type { StockMovementView } from './ledger.js';
import { StockCursor, StockPageLimit } from './referential.js';

// ── Rattrapages (§ 6.1, § 6.2) ──────────────────────────────────────────────

/** Bilan d'un rattrapage, pour une organisation. */
export interface StockSyncSourceReport {
  /** Pièces relues (réceptions, factures finales). */
  read: number;
  /** Mouvements écrits ; une pièce rejouée n'écrit rien (`sourceKey`). */
  written: number;
  /** Lignes « À traiter » ouvertes par ce passage. */
  pending: number;
}

export interface StockSyncResponse {
  version: string;
  purchases: StockSyncSourceReport;
  sales: StockSyncSourceReport;
}

// ── Grand livre de tous les articles (compléments S8) ───────────────────────

export const ListStockLedgerQuery = z
  .object({
    itemId: StockId.optional(),
    locationId: StockId.optional(),
    kind: StockMovementKindSchema.optional(),
    workProjectId: StockId.optional(),
    from: StockCalendarDay.optional(),
    to: StockCalendarDay.optional(),
    cursor: StockCursor.optional(),
    limit: StockPageLimit,
  })
  .strict();
export type ListStockLedgerQuery = z.output<typeof ListStockLedgerQuery>;

/** Mouvement du grand livre, avec ce qu'il faut pour l'afficher sans autre appel. */
export interface StockLedgerEntryView extends StockMovementView {
  itemCode: string | null;
  itemName: string;
  unit: string;
  costCurrency: StockCurrency;
  locationName: string | null;
}

export interface StockLedgerPage {
  items: StockLedgerEntryView[];
  nextCursor: string | null;
  valuesHidden: boolean;
}
