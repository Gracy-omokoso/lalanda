// Lecture des factures de vente FINALES par le module des stocks (ADR-0046 § 6.2,
// O3). ADR-0046 — S4.
//
// LECTURE SEULE (`ReadOnlyCollection`) de `sales_invoices` : aucun fichier des ventes
// n'est importé ni modifié, aucun champ n'est écrit (ni le document, ni son journal,
// ni ses compteurs, ni sa normalisation DGI). Seules les factures `issued` ou
// `normalized` sont lues : jamais un brouillon, une facture `pending_normalization` ou
// `normalization_failed`. Les acomptes (`FT`, `ET`) ne sont pas lus.

import type { ObjectId } from 'mongodb';
import type { Connection } from 'mongoose';

import { ReadOnlyCollection } from '../links/stock-links.common.js';

/** Factures et avoirs finaux qui font bouger le stock (§ 6.2) ; acomptes exclus. */
export const STOCK_SALE_TYPES = ['FV', 'EV'] as const;
export const STOCK_CREDIT_NOTE_TYPES = ['FA', 'EA'] as const;
export const STOCK_FINAL_INVOICE_STATUSES = ['issued', 'normalized'] as const;

export interface InvoiceLineRead {
  index: number;
  catalogItemId: string | null;
  name: string;
  unit: string | null;
  quantity: string;
  itemType: string;
}

export interface InvoiceRead {
  _id: ObjectId;
  organizationId: string;
  status: string;
  type: string;
  number: string | null;
  pointOfSaleId: string | null;
  issuedAt: Date | null;
  lines: InvoiceLineRead[];
  normalization: { normalizedAt: Date | null } | null;
}

/** Champs relus : les champs figés dont la sortie a besoin, rien d'autre. */
const PROJECTION = {
  organizationId: 1,
  status: 1,
  type: 1,
  number: 1,
  pointOfSaleId: 1,
  issuedAt: 1,
  lines: 1,
  'normalization.normalizedAt': 1,
} as const;

export class SalesInvoicesReader {
  private readonly invoices: ReadOnlyCollection<InvoiceRead>;

  constructor(connection: Connection) {
    this.invoices = new ReadOnlyCollection<InvoiceRead>(connection, 'sales_invoices');
  }

  /**
   * Factures et avoirs finaux de l'organisation, émis après l'activation des stocks,
   * émis OU normalisés depuis `since` (le recouvrement est absorbé par l'idempotence).
   */
  finalSince(organizationId: string, activatedAt: Date, since: Date): Promise<InvoiceRead[]> {
    return this.invoices.find(
      {
        organizationId,
        type: { $in: [...STOCK_SALE_TYPES, ...STOCK_CREDIT_NOTE_TYPES] },
        status: { $in: [...STOCK_FINAL_INVOICE_STATUSES] },
        issuedAt: { $gte: activatedAt },
        $or: [{ issuedAt: { $gte: since } }, { 'normalization.normalizedAt': { $gte: since } }],
      },
      { projection: PROJECTION, sort: { issuedAt: 1, _id: 1 } },
    );
  }
}
