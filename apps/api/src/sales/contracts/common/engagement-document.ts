// Document de vente d'un engagement (commande client, contrat) — ADR-0050 § 2.2, § 2.3.
// ADR-0050 — V2.
//
// Client, devise, mode de prix et lignes ont EXACTEMENT les formes du devis et du
// brouillon de facture (ADR-0035 § 1) : ils sont validés par LE MÊME schéma
// (`CreateInvoiceSchema`, type `FV`) et composés par LE MÊME code
// (`InvoiceDraftsService.compose` → moteur `computeInvoiceTotals`). Seules les lignes
// « catalogue » et « libre » sont admises. Le client est OBLIGATOIRE (décision ouverte
// n° 20 : un prospect est d'abord converti en client).
//
// Chaque ligne reçoit un `lineRef` stable, clé du reste à facturer (§ 2.7 `lineMap`).

import type { OrderLineInput } from '@lalanda/engine';
import { z } from 'zod';

import { CreateInvoiceSchema, type InvoiceDraftInput } from '../../invoices/invoices.dto.js';
import type { ComposedDraft } from '../../invoices/invoice-drafts.service.js';
import type {
  StoredCustomer,
  StoredDocumentAmounts,
  StoredLine,
} from '../../invoices/invoice.types.js';

/** Ligne stockée d'un engagement : la ligne du brouillon de facture + sa clé stable. */
export type EngagementLine = StoredLine & { lineRef: string };

/** Champs du document de vente d'un engagement, composés par le code des factures. */
export interface EngagementDocument {
  currency: 'CDF' | 'USD';
  priceMode: 'ttc' | 'ht';
  customer: StoredCustomer;
  lines: EngagementLine[];
  documentAmounts: StoredDocumentAmounts;
}

/** Champs bruts du document dans un corps de requête (validés ci-dessous). */
export const ENGAGEMENT_DOCUMENT_FIELDS = {
  currency: z.unknown().optional(),
  priceMode: z.unknown().optional(),
  customer: z.unknown().optional(),
  lines: z.unknown().optional(),
} as const;

const EMPTY_DRAFT: InvoiceDraftInput = {
  type: 'FV',
  currency: 'CDF',
  priceMode: 'ttc',
  customer: { customerId: null, walkInName: null },
  pointOfSaleId: null,
  lines: [],
  payments: [],
  comments: { A: null, C: null },
  creditNote: null,
  showUsdCounterValue: false,
};

/**
 * Valide le document d'un engagement par le schéma du brouillon de facture et rend
 * l'entrée de `compose`. Problèmes ajoutés au contexte de l'appelant (`400`).
 */
export function parseEngagementDocument(
  raw: Record<string, unknown>,
  ctx: z.RefinementCtx,
): InvoiceDraftInput {
  const customer = raw['customer'];
  if (
    customer === undefined ||
    customer === null ||
    typeof customer !== 'object' ||
    (customer as { customerId?: unknown }).customerId === null ||
    (customer as { customerId?: unknown }).customerId === undefined
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['customer', 'customerId'],
      message: 'Un client est exigé : convertissez d’abord le prospect en client.',
      params: { code: 'CUSTOMER_REQUIRED' },
    });
  }
  if (Array.isArray(raw['lines'])) {
    (raw['lines'] as unknown[]).forEach((l, i) => {
      if (l !== null && typeof l === 'object' && (l as { source?: unknown }).source === 'origin') {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', i, 'source'],
          message: 'Une commande porte des lignes du catalogue ou des lignes libres.',
          params: { code: 'LINE_SOURCE_INVALID' },
        });
      }
    });
  }
  const parsed = CreateInvoiceSchema.safeParse({
    type: 'FV',
    currency: raw['currency'],
    priceMode: raw['priceMode'],
    customer: raw['customer'],
    lines: raw['lines'],
  });
  if (!parsed.success) {
    for (const i of parsed.error.issues) ctx.addIssue({ ...i } as z.core.$ZodRawIssue);
    return EMPTY_DRAFT;
  }
  return parsed.data;
}

/** `L1`, `L2`… : clé stable de la ligne d'index `index` (0-based) d'un document figé. */
export function lineRefOf(position: number): string {
  return `L${position + 1}`;
}

/** Composition du code des factures → document de l'engagement (clés de ligne posées). */
export function engagementDocumentOf(composed: ComposedDraft): EngagementDocument {
  return {
    currency: composed.currency,
    priceMode: composed.priceMode,
    customer: composed.customer,
    lines: composed.lines.map((l, i) => ({ ...l, lineRef: lineRefOf(i) })),
    documentAmounts: {
      currency: composed.documentAmounts.currency,
      calculation: composed.documentAmounts.calculation,
      paymentsCheck: null,
    },
  };
}

/** Lignes de l'engagement pour le moteur (`orderInvoicing`) : prix FIGÉS, quantités. */
export function engineOrderLines(lines: readonly EngagementLine[]): OrderLineInput[] {
  return lines.map((l) => ({
    lineRef: l.lineRef,
    catalogItemId: l.catalogItemId ?? null,
    unitPrice: l.unitPrice,
    quantity: l.quantity,
  }));
}

/** Ligne stockée sans sa clé (forme du brouillon de facture). */
export function storedLineOf(line: EngagementLine): StoredLine {
  const { lineRef: _lineRef, ...rest } = line;
  return rest;
}
