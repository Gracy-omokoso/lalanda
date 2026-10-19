// Vues d'un document de vente — ADR-0023 § S25e.1, § S25e.14.
//
// `documentKind` vaut `invoice` SEULEMENT pour `issued` et `normalized` : c'est
// le champ que S25g lit pour choisir l'intitulé du PDF. Tant qu'il vaut
// `proforma`, aucun numéro de la série fiscale n'est exposé et le libellé est
// « Pro forma — non valable comme facture ». Aucune opération sur un montant :
// les montants viennent tels quels du moteur.

import type { PaymentInput, PaymentMethod } from '@lalanda/engine';

import { CUSTOMER_TYPE_LABELS } from '../sales.dto.js';
import type {
  DocumentKind,
  InvoiceCreditNoteSummary,
  InvoiceLineView,
  InvoiceReadiness,
  InvoiceStatus,
  InvoiceSummary,
  InvoiceType,
  InvoiceView,
} from './invoice.contract.js';
import type { InvoiceLean } from './invoice.types.js';

export const PROFORMA_LABEL = 'Pro forma — non valable comme facture';
export const NORMALIZED_AMOUNTS_LABEL = 'Montants normalisés (CDF) — font foi';

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  FV: 'Facture de vente',
  FT: 'Facture d’acompte',
  FA: 'Facture d’avoir',
  EV: 'Facture de vente à l’exportation',
  ET: 'Facture d’acompte à l’exportation',
  EA: 'Facture d’avoir à l’exportation',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  ESPECES: 'Espèces',
  VIREMENT: 'Virement',
  CARTEBANCAIRE: 'Carte bancaire',
  MOBILEMONEY: 'Mobile money',
  CHEQUES: 'Chèques',
  CREDIT: 'Crédit',
  AUTRE: 'Autre',
};

export function documentKindOf(status: InvoiceStatus): DocumentKind {
  return status === 'issued' || status === 'normalized' ? 'invoice' : 'proforma';
}

function documentLabelOf(doc: InvoiceLean): string {
  if (documentKindOf(doc.status) === 'proforma') return PROFORMA_LABEL;
  const credit = doc.type === 'FA' || doc.type === 'EA';
  if (doc.status === 'normalized') return credit ? 'Avoir normalisé' : 'Facture normalisée';
  return credit ? 'Avoir' : 'Facture';
}

const iso = (d: Date | string | null | undefined): string | null =>
  d === null || d === undefined ? null : new Date(d).toISOString();

export interface InvoiceViewContext {
  readiness: InvoiceReadiness;
  creditNotes: readonly InvoiceCreditNoteSummary[];
  /** Origine finale seulement : quantités créditées et restantes, par ligne. */
  creditedByLine: ReadonlyMap<number, { credited: string; remaining: string }> | null;
}

function paymentViews(payments: readonly PaymentInput[]) {
  return payments.map((p) => ({
    method: p.method,
    methodLabel: PAYMENT_METHOD_LABELS[p.method],
    amount: p.amount,
  }));
}

export function invoiceView(doc: InvoiceLean, ctx: InvoiceViewContext): InvoiceView {
  const kind = documentKindOf(doc.status);
  const totals = doc.documentAmounts.calculation.totals;
  const lines: InvoiceLineView[] = doc.lines.map((l) => {
    const credited = ctx.creditedByLine?.get(l.index);
    return {
      index: l.index,
      source: l.source,
      catalogItemId: l.catalogItemId,
      originLineIndex: l.originLineIndex,
      code: l.code,
      edefCode: l.edefCode,
      name: l.name,
      unit: l.unit,
      itemType: l.itemType,
      taxGroup: l.taxGroup,
      outOfScope: l.outOfScope,
      quantity: l.quantity,
      originalPrice: l.originalPrice,
      discount: l.discount,
      unitPrice: l.unitPrice,
      priceModification: l.priceModification,
      priceOverridden: l.priceOverridden,
      specificTax: l.specificTax,
      amount: totals?.lines.find((t) => t.index === l.index)?.amount ?? null,
      ...(credited ? { credited: credited.credited, remaining: credited.remaining } : {}),
    };
  });
  const n = doc.normalization;
  const customer = doc.customer;
  return {
    id: String(doc._id),
    status: doc.status,
    documentKind: kind,
    documentLabel: documentLabelOf(doc),
    proformaRef: doc.proformaRef,
    // Aucun numéro de la série fiscale avant `issued` ou `normalized`.
    number: kind === 'invoice' ? (doc.number ?? null) : null,
    series: kind === 'invoice' ? (doc.series ?? null) : null,
    fiscalYear: kind === 'invoice' ? (doc.fiscalYear ?? null) : null,
    issuedAt: kind === 'invoice' ? iso(doc.issuedAt) : null,
    type: doc.type,
    typeLabel: INVOICE_TYPE_LABELS[doc.type],
    currency: doc.currency,
    priceMode: doc.priceMode,
    showUsdCounterValue: doc.showUsdCounterValue ?? false,
    emissionMode: doc.emissionMode ?? null,
    environment: doc.environment ?? null,
    isf: doc.isf ?? null,
    customer: {
      customerId: customer.customerId,
      type: customer.type,
      typeLabel: CUSTOMER_TYPE_LABELS[customer.type],
      name: customer.name,
      nif: customer.nif,
      exemptionReference: customer.exemptionReference,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      printContactDetails: customer.printContactDetails,
    },
    pointOfSaleId: doc.pointOfSaleId ?? null,
    lines,
    documentAmounts: {
      label: `Montants du document (${doc.currency})`,
      currency: doc.currency,
      calculation: doc.documentAmounts.calculation,
      payments: paymentViews(doc.payments),
      paymentsCheck: doc.documentAmounts.paymentsCheck,
    },
    conversion: doc.conversion ?? null,
    normalizedAmounts: doc.normalizedAmounts
      ? { label: NORMALIZED_AMOUNTS_LABEL, ...doc.normalizedAmounts }
      : null,
    calculationVersion: doc.calculationVersion ?? null,
    roundingPolicyId: doc.roundingPolicyId ?? null,
    taxRates: doc.taxRates
      ? {
          source: doc.taxRates.source,
          environment: doc.taxRates.environment,
          fetchedAt: doc.taxRates.fetchedAt,
          sha256: doc.taxRates.sha256,
        }
      : null,
    comments: {
      A: doc.comments['A'] ?? null,
      B: null,
      C: doc.comments['C'] ?? null,
      D: null,
      E: null,
      F: null,
      G: null,
      H: null,
    },
    creditNote: doc.creditNote ?? null,
    creditNotes: ctx.creditNotes,
    seller: doc.seller ?? null,
    operator: doc.operator ?? null,
    normalization: n
      ? {
          attempts: n.attempts,
          reservedNumber: n.reservedNumber,
          codeDefDgi: n.codeDefDgi,
          nim: n.nim,
          counters: n.counters,
          dgiDateTime: n.dgiDateTime,
          qrCode: n.qrCode,
          lastError: n.lastError,
          normalizedAt: iso(n.normalizedAt),
        }
      : null,
    readiness: ctx.readiness,
    revision: doc.revision,
    createdAt: iso(doc.createdAt) ?? '',
    updatedAt: iso(doc.updatedAt) ?? '',
  };
}

export function invoiceSummary(doc: InvoiceLean): InvoiceSummary {
  const kind = documentKindOf(doc.status);
  const totals = doc.documentAmounts.calculation.totals;
  return {
    id: String(doc._id),
    status: doc.status,
    documentKind: kind,
    proformaRef: doc.proformaRef,
    number: kind === 'invoice' ? (doc.number ?? null) : null,
    type: doc.type,
    currency: doc.currency,
    issuedAt: kind === 'invoice' ? iso(doc.issuedAt) : null,
    customer: { name: doc.customer.name, type: doc.customer.type },
    documentAmounts: { calculation: { totals: totals ? { total: totals.total } : null } },
    normalizedAmounts: doc.normalizedAmounts
      ? { calculation: { total: doc.normalizedAmounts.calculation.total } }
      : null,
    emissionMode: doc.emissionMode ?? null,
    revision: doc.revision,
  };
}

export function creditNoteSummary(doc: InvoiceLean): InvoiceCreditNoteSummary {
  const kind = documentKindOf(doc.status);
  return {
    id: String(doc._id),
    status: doc.status,
    documentKind: kind,
    proformaRef: doc.proformaRef,
    number: kind === 'invoice' ? (doc.number ?? null) : null,
    nature: doc.creditNote?.nature ?? 'RRR',
  };
}
