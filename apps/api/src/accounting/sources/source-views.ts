// Pièces sources lues → vues du moteur d'écritures (ADR-0049 § 6). ADR-0049 — K5.
//
// Traduction fidèle, SANS calcul : les montants sont recopiés tels que figés par leur
// module (totaux par groupe d'une facture, montants d'un encaissement, d'une dépense…).
// Une pièce illisible rend `null` : la synchronisation l'inscrit dans « À comptabiliser »
// (`UNSUPPORTED_SOURCE`), jamais elle ne devine.

import type {
  AccountingCurrency,
  ExpenseView,
  ReceiptView,
  SalesInvoiceView,
  SettlementAllocationView,
  SupplierInvoiceView,
  SupplierPaymentView,
  TreasuryMovementView,
} from '@lalanda/engine';

import { kinshasaDayOf } from '../../sales/receipts/kinshasa-day.js';
import type { SourceDoc } from './accounting-sources.service.js';

const idOf = (d: SourceDoc): string => d._id.toHexString();
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const currencyOf = (v: unknown): AccountingCurrency | null =>
  v === 'CDF' || v === 'USD' ? v : null;
const dayOf = (v: unknown): string | null => {
  if (v instanceof Date) return kinshasaDayOf(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return kinshasaDayOf(new Date(v));
  return null;
};

type Pin = SettlementAllocationView['invoiceBookRate'];

interface Totals {
  lines?: { index: number; amount: string }[];
  groups?: { group: string; ht: string; vat: string; total: string; specificTax: string }[];
  total?: string;
}

/** Facture ou avoir de vente figé (§ 6.1) ; montants normalisés s'ils existent. */
export function salesInvoiceView(d: SourceDoc): SalesInvoiceView | null {
  const status = str(d['status']);
  const normalized = d['normalizedAmounts'] as {
    currency: 'CDF';
    calculation: Totals;
    payments: { method: string; amount: string }[];
  } | null;
  const docAmounts = d['documentAmounts'] as {
    calculation?: { ok: boolean; totals: Totals | null };
  };
  const useNormalized = status === 'normalized' && normalized !== null && normalized !== undefined;
  const totals: Totals | null = useNormalized
    ? normalized.calculation
    : docAmounts?.calculation?.ok === true
      ? (docAmounts.calculation.totals ?? null)
      : null;
  const currency = useNormalized ? 'CDF' : currencyOf(d['currency']);
  const date = dayOf(d['issuedAt'] ?? d['frozenAt']);
  if (totals === null || currency === null || date === null || typeof totals.total !== 'string') {
    return null;
  }
  const stored = (d['lines'] as { index: number; itemType: string; taxGroup: string }[]) ?? [];
  const byIndex = new Map(stored.map((l) => [l.index, l]));
  const lines: SalesInvoiceView['lines'][number][] = [];
  for (const l of totals.lines ?? []) {
    const s = byIndex.get(l.index);
    if (s === undefined) return null;
    if (s.itemType !== 'BIE' && s.itemType !== 'SER' && s.itemType !== 'TAX') return null;
    lines.push({ taxGroup: s.taxGroup, itemType: s.itemType, amount: l.amount });
  }
  const conversion = d['conversion'] as {
    from: string;
    to: string;
    rate: string;
    rateDate: string;
    rateSource: string;
  } | null;
  const from = currencyOf(conversion?.from);
  const to = currencyOf(conversion?.to);
  const customer = (d['customer'] as { customerId: string | null; name: string | null }) ?? null;
  const series = str(d['series']);
  return {
    id: idOf(d),
    number: str(d['number']),
    status: status ?? '',
    type: str(d['type']) ?? '',
    series: series === 'real' || series === 'test' || series === 'proforma' ? series : null,
    date,
    currency,
    customerId: customer?.customerId ?? `anonymous:${idOf(d)}`,
    customerName: customer?.name ?? null,
    groups: (totals.groups ?? []).map((g) => ({
      group: g.group,
      ht: g.ht,
      vat: g.vat,
      total: g.total,
      specificTax: g.specificTax,
    })),
    lines,
    total: totals.total,
    payments: (useNormalized
      ? normalized.payments
      : ((d['payments'] as { method: string; amount: string }[]) ?? [])
    ).map((p) => ({ method: p.method, amount: p.amount })),
    conversion:
      !useNormalized && conversion && from !== null && to !== null
        ? {
            from,
            to,
            rate: conversion.rate,
            reference: `${conversion.rateSource} ${conversion.rateDate}`,
          }
        : null,
  };
}

/** Encaissement (§ 6.2) ; le client est celui des factures lettrées. */
export function receiptView(
  d: SourceDoc,
  invoices: ReadonlyMap<string, { customerId: string; customerName: string | null }>,
  pinOf: (invoiceId: string) => Pin,
): ReceiptView | null {
  const currency = currencyOf(d['currency']);
  const allocations =
    (d['allocations'] as { invoiceId: string; invoiceNumber: string | null; amount: string }[]) ??
    [];
  const first = allocations[0] === undefined ? undefined : invoices.get(allocations[0].invoiceId);
  const receivedOn = str(d['receivedOn']);
  const status = str(d['status']);
  if (currency === null || receivedOn === null || first === undefined) return null;
  if (status !== 'recorded' && status !== 'cancelled') return null;
  return {
    id: idOf(d),
    number: str(d['reference']),
    status,
    revision: Number(d['revision'] ?? 1),
    receivedOn,
    amount: String(d['amount']),
    currency,
    method: String(d['method']),
    accountId: str(d['accountId']),
    customerId: first.customerId,
    customerName: first.customerName,
    allocations: allocations.map((a) => ({
      invoiceId: a.invoiceId,
      invoiceNumber: a.invoiceNumber ?? null,
      amount: a.amount,
      invoiceBookRate: pinOf(a.invoiceId),
    })),
  };
}

/**
 * Propriétaire d'une dépense (§ 6.3 ; ADR-0051 § 7.4, lot H13) : paiement fournisseur
 * (`paymentId`) ou note de frais (`reportId`, `settledByAdvanceId`). Une nature
 * inconnue est recopiée telle quelle : le moteur la met « À comptabiliser ».
 * `undefined` : propriétaire illisible → pièce illisible.
 */
function expenseOriginOf(v: unknown): ExpenseView['origin'] | undefined {
  if (v === null || v === undefined) return null;
  const o = v as Record<string, unknown>;
  const kind = str(o['kind']);
  if (kind === null) return undefined;
  if (kind === 'supplier_payment') {
    const id = str(o['paymentId']);
    return id === null ? undefined : { kind, id, settledByAdvanceId: null };
  }
  if (kind === 'expense_report') {
    const id = str(o['reportId']);
    return id === null ? undefined : { kind, id, settledByAdvanceId: str(o['settledByAdvanceId']) };
  }
  return { kind, id: '', settledByAdvanceId: null };
}

/** Dépense (§ 6.3) ; `origin` non nulle quand un paiement fournisseur ou une note de frais l'a créée. */
export function expenseView(d: SourceDoc): ExpenseView | null {
  const currency = currencyOf(d['currency']);
  const spentOn = str(d['spentOn']);
  const status = str(d['status']);
  if (currency === null || spentOn === null) return null;
  if (status !== 'recorded' && status !== 'cancelled') return null;
  const origin = expenseOriginOf(d['origin']);
  if (origin === undefined) return null;
  return {
    id: idOf(d),
    status,
    revision: Number(d['revision'] ?? 1),
    spentOn,
    amount: String(d['amount']),
    currency,
    category: String(d['category']),
    label: String(d['label'] ?? ''),
    supplierName: str(d['supplierName']),
    accountId: str(d['accountId']),
    deductibleVat: str(d['deductibleVat']),
    reference: str(d['reference']),
    origin,
  };
}

/** Facture ou avoir fournisseur (§ 6.4). */
export function supplierInvoiceView(
  d: SourceDoc,
  supplierName: string | null,
): SupplierInvoiceView | null {
  const currency = currencyOf(d['currency']);
  const invoiceDate = str(d['invoiceDate']);
  const status = str(d['status']);
  const kind = str(d['kind']);
  if (currency === null || invoiceDate === null) return null;
  if (status !== 'draft' && status !== 'validated' && status !== 'cancelled') return null;
  if (kind !== 'invoice' && kind !== 'credit_note') return null;
  return {
    id: idOf(d),
    number: str(d['internalNumber']),
    kind,
    status,
    wasValidated: d['validatedAt'] !== null && d['validatedAt'] !== undefined,
    invoiceDate,
    currency,
    supplierId: String(d['supplierId']),
    supplierName,
    total: String(d['total']),
    deductibleVat: str(d['deductibleVat']),
    costAllocations: ((d['costAllocations'] as { category: string; amount: string }[]) ?? []).map(
      (c) => ({ category: c.category, amount: c.amount }),
    ),
  };
}

/** Paiement fournisseur (§ 6.5). */
export function supplierPaymentView(
  d: SourceDoc,
  supplierName: string | null,
  invoiceNumbers: ReadonlyMap<string, string | null>,
  pinOf: (invoiceId: string) => Pin,
): SupplierPaymentView | null {
  const currency = currencyOf(d['currency']);
  const paidOn = str(d['paidOn']);
  const status = str(d['status']);
  if (currency === null || paidOn === null) return null;
  if (status !== 'recorded' && status !== 'cancelled') return null;
  return {
    id: idOf(d),
    number: str(d['number']),
    status,
    paidOn,
    amount: String(d['amount']),
    currency,
    method: String(d['method']),
    accountId: str(d['accountId']),
    supplierId: String(d['supplierId']),
    supplierName,
    allocations: ((d['allocations'] as { invoiceId: string; amount: string }[]) ?? []).map((a) => ({
      invoiceId: a.invoiceId,
      invoiceNumber: invoiceNumbers.get(a.invoiceId) ?? null,
      amount: a.amount,
      invoiceBookRate: pinOf(a.invoiceId),
    })),
  };
}

/** Mouvement de trésorerie (§ 6.6) ; devises lues des comptes de trésorerie. */
export function treasuryMovementView(
  d: SourceDoc,
  currencies: ReadonlyMap<string, AccountingCurrency>,
): TreasuryMovementView | null {
  const kind = str(d['kind']);
  const status = str(d['status']);
  const date = str(d['date']);
  if (kind !== 'transfer' && kind !== 'other_in' && kind !== 'other_out') return null;
  if ((status !== 'recorded' && status !== 'cancelled') || date === null) return null;
  const fromAccountId = str(d['fromAccountId']);
  const toAccountId = str(d['toAccountId']);
  return {
    id: idOf(d),
    kind,
    status,
    date,
    label: String(d['label'] ?? ''),
    fromAccountId,
    fromCurrency: fromAccountId === null ? null : (currencies.get(fromAccountId) ?? null),
    toAccountId,
    toCurrency: toAccountId === null ? null : (currencies.get(toAccountId) ?? null),
    amountOut: str(d['amountOut']),
    amountIn: str(d['amountIn']),
    reference: str(d['reference']),
  };
}
