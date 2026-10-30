// ─────────────────────────────────────────────────────────────────────────────
// Rapprochement commande, réception, facture (ADR-0044 § 5, § 7)
//
// Mode déduit, contrôle chiffré, décision humaine :
// - facture sans commande (ou avoir) : `none` → `not_applicable` ;
// - ligne visant une ligne de commande non « à réceptionner » : deux voies
//   (prix unitaire net facturé ≤ commandé × (1 + tolérance) ; quantité facturée
//   CUMULÉE ≤ commandée) ;
// - ligne visant une ligne « à réceptionner » : trois voies (les contrôles à
//   deux voies ET quantité facturée cumulée ≤ quantité reçue, réceptions non
//   annulées). Le mode de la facture est le plus exigeant de ses lignes.
// - Cumul : factures VALIDÉES de type `invoice`, hors la facture contrôlée.
// - `TOTAL_ABOVE_ORDER` : total TTC cumulé des factures validées qui visent au
//   moins une commande de la facture, comparé à Σ des totaux approuvés des
//   commandes qu'elles visent, plus la tolérance absolue de la devise.
// - Un prix ou une quantité INFÉRIEURS ne bloquent pas (facture partielle) ;
//   ils sont rendus en information (`PRICE_BELOW_ORDER`, `QUANTITY_BELOW_ORDER`),
//   comme `TAXES_DIFFER_FROM_ORDER` et `RECEIVED_OVER_ORDERED`.
// - Quantités sans tolérance : seules celles du § 2.2 (prix %, montant absolu)
//   existent.
// ─────────────────────────────────────────────────────────────────────────────

import { invoicedByOrderLine } from './orders.js';
import {
  byString,
  centsOf,
  checkCurrency,
  discountOf,
  formatCents,
  formatNetPrice,
  formatQuantity,
  netUnitPriceMicro,
  positiveMilliOf,
  scaledOf,
  sumOf,
} from './money.js';
import {
  BLOCKING_VARIANCE_CODES,
  PURCHASES_VERSION,
  type CostAllocationInput,
  type CostAllocationsCheck,
  type DeclaredTaxInput,
  type InvoiceMatching,
  type InvoiceTotalCheck,
  type MatchInvoiceInput,
  type MatchLine,
  type MatchOrderInput,
  type MatchReceptionInput,
  type MatchTolerances,
  type MatchVariance,
  type MatchVarianceCode,
  type PurchaseOrderLineInput,
} from './types.js';

export interface MatchInvoiceArgs {
  /** Toutes les commandes visées par la facture ET par les factures validées qui les partagent. */
  orders: readonly MatchOrderInput[];
  /** Réceptions des commandes visées (les annulées sont ignorées). */
  receptions: readonly MatchReceptionInput[];
  /** Autres factures du fournisseur ; seules les validées de type `invoice` comptent. */
  invoices: readonly MatchInvoiceInput[];
  invoice: MatchInvoiceInput;
  tolerances: MatchTolerances;
}

/** Tolérance de prix en centièmes de point (0 à 1 000 = 10 %). */
function priceToleranceOf(value: unknown): bigint {
  const t = scaledOf(value, 2);
  if (t === null || t > 1_000n) {
    throw new RangeError(`Tolérance de prix : 0 à 10 %, reçu ${JSON.stringify(value)}`);
  }
  return t;
}

const isBlocking = (code: MatchVarianceCode): boolean => BLOCKING_VARIANCE_CODES.includes(code);

function variance(
  code: MatchVarianceCode,
  where: { orderId: string | null; orderLineId: string | null; invoiceLineIndex: number | null },
  unit: MatchVariance['unit'],
  expected: bigint,
  actual: bigint,
  format: (v: bigint) => string,
): MatchVariance {
  return {
    code,
    blocking: isBlocking(code),
    ...where,
    unit,
    expected: format(expected),
    actual: format(actual),
    difference: format(actual - expected),
  };
}

const taxesCents = (taxes: readonly DeclaredTaxInput[], what: string): bigint =>
  sumOf(taxes.map((t, i) => centsOf(t.amount, `${what} : taxe ${i + 1}`)));

export function matchInvoice(args: MatchInvoiceArgs): InvoiceMatching {
  const { invoice } = args;
  const currency = checkCurrency(invoice.currency, 'Facture');
  if (invoice.kind === 'credit_note' || invoice.orderIds.length === 0) {
    return {
      version: PURCHASES_VERSION,
      mode: 'none',
      status: 'not_applicable',
      variances: [],
      lines: [],
    };
  }
  if (invoice.lines.length === 0) {
    throw new RangeError('Une facture liée à une commande porte au moins une ligne.');
  }
  const priceTolerance = priceToleranceOf(args.tolerances.pricePercent);
  const amountToleranceRaw = args.tolerances.amountAbsolute[currency];
  const amountTolerance =
    amountToleranceRaw === undefined ? 0n : centsOf(amountToleranceRaw, 'Tolérance de montant');

  // Commandes connues et lignes de commande de la facture.
  const ordersById = new Map<string, MatchOrderInput>();
  for (const order of args.orders) ordersById.set(order.id, order);
  const lineIndex = new Map<string, { order: MatchOrderInput; line: PurchaseOrderLineInput }>();
  for (const orderId of invoice.orderIds) {
    const order = ordersById.get(orderId);
    if (order === undefined) throw new RangeError(`Commande ${orderId} absente des entrées`);
    if (checkCurrency(order.currency, `Commande ${orderId}`) !== currency) {
      throw new RangeError(`Commande ${orderId} : devise différente de la facture`);
    }
    for (const line of order.lines) lineIndex.set(line.id, { order, line });
  }

  const variances: MatchVariance[] = [];
  const now = new Map<string, bigint>();
  const firstLineIndex = new Map<string, number>();
  let threeWay = false;

  invoice.lines.forEach((invLine, index) => {
    const what = `Facture, ligne ${index + 1}`;
    const qty = positiveMilliOf(invLine.quantity, `${what} : quantité`);
    const invNet = netUnitPriceMicro(
      centsOf(invLine.unitPrice, `${what} : prix unitaire`),
      discountOf(invLine.discountPercent, `${what} : remise`),
    );
    if (invLine.orderLineId === null) {
      variances.push(
        variance(
          'LINE_NOT_ON_ORDER',
          { orderId: null, orderLineId: null, invoiceLineIndex: index },
          'quantity',
          0n,
          qty,
          formatQuantity,
        ),
      );
      return;
    }
    const found = lineIndex.get(invLine.orderLineId);
    if (found === undefined) {
      throw new RangeError(
        `${what} : ligne de commande ${invLine.orderLineId} hors des commandes liées`,
      );
    }
    const { order, line } = found;
    if (line.receivable) threeWay = true;
    now.set(line.id, (now.get(line.id) ?? 0n) + qty);
    if (!firstLineIndex.has(line.id)) firstLineIndex.set(line.id, index);

    const ordNet = netUnitPriceMicro(
      centsOf(line.unitPrice, `Ligne ${line.id} : prix unitaire`),
      discountOf(line.discountPercent, `Ligne ${line.id} : remise`),
    );
    const where = { orderId: order.id, orderLineId: line.id, invoiceLineIndex: index };
    if (invNet * 10_000n > ordNet * (10_000n + priceTolerance)) {
      variances.push(
        variance('PRICE_ABOVE_ORDER', where, 'unit_price', ordNet, invNet, formatNetPrice),
      );
    } else if (invNet < ordNet) {
      variances.push(
        variance('PRICE_BELOW_ORDER', where, 'unit_price', ordNet, invNet, formatNetPrice),
      );
    }
  });

  // Quantités cumulées, par ligne de commande visée (ordre de première apparition).
  const before = invoicedByOrderLine(args.invoices, invoice.id);
  const receivedByLine = new Map<string, bigint>();
  args.receptions.forEach((reception, r) => {
    if (reception.status === 'cancelled') return;
    if (!invoice.orderIds.includes(reception.orderId)) return;
    reception.lines.forEach((l, i) => {
      const q = positiveMilliOf(l.quantity, `Réception ${r + 1}, ligne ${i + 1}`);
      receivedByLine.set(l.orderLineId, (receivedByLine.get(l.orderLineId) ?? 0n) + q);
    });
  });

  const lines: MatchLine[] = [];
  for (const [orderLineId, qtyNow] of now) {
    const { order, line } = lineIndex.get(orderLineId) as {
      order: MatchOrderInput;
      line: PurchaseOrderLineInput;
    };
    const ordered = positiveMilliOf(line.quantity, `Ligne ${line.id} : quantité`);
    const prior = before.get(orderLineId) ?? 0n;
    const cumulative = prior + qtyNow;
    const received = receivedByLine.get(orderLineId) ?? 0n;
    const where = { orderId: order.id, orderLineId, invoiceLineIndex: null };
    if (cumulative > ordered) {
      variances.push(
        variance('QUANTITY_ABOVE_ORDER', where, 'quantity', ordered, cumulative, formatQuantity),
      );
    } else if (cumulative < ordered) {
      variances.push(
        variance('QUANTITY_BELOW_ORDER', where, 'quantity', ordered, cumulative, formatQuantity),
      );
    }
    if (line.receivable && cumulative > received) {
      variances.push(
        variance(
          'QUANTITY_ABOVE_RECEIVED',
          where,
          'quantity',
          received,
          cumulative,
          formatQuantity,
        ),
      );
    }
    if (received > ordered) {
      variances.push(
        variance('RECEIVED_OVER_ORDERED', where, 'quantity', ordered, received, formatQuantity),
      );
    }
    lines.push({
      orderId: order.id,
      orderLineId,
      mode: line.receivable ? 'three_way' : 'two_way',
      ordered: formatQuantity(ordered),
      received: line.receivable ? formatQuantity(received) : null,
      invoicedBefore: formatQuantity(prior),
      invoicedNow: formatQuantity(qtyNow),
      invoicedCumulative: formatQuantity(cumulative),
    });
  }

  // Total cumulé contre total approuvé.
  const shared = args.invoices.filter(
    (other) =>
      other.id !== invoice.id &&
      other.status === 'validated' &&
      other.kind === 'invoice' &&
      other.orderIds.some((id) => invoice.orderIds.includes(id)),
  );
  const orderSet = new Set<string>(invoice.orderIds);
  for (const other of shared) for (const id of other.orderIds) orderSet.add(id);
  let approved = 0n;
  for (const id of [...orderSet].sort(byString)) {
    const order = ordersById.get(id);
    if (order === undefined) throw new RangeError(`Commande ${id} absente des entrées`);
    approved += centsOf(order.approvedTotal, `Commande ${id} : total approuvé`);
  }
  const invoicedTotal =
    centsOf(invoice.total, 'Facture : total') +
    sumOf(shared.map((o) => centsOf(o.total, `Facture ${o.id} : total`)));
  const global = { orderId: null, orderLineId: null, invoiceLineIndex: null };
  if (invoicedTotal > approved + amountTolerance) {
    variances.push(
      variance('TOTAL_ABOVE_ORDER', global, 'amount', approved, invoicedTotal, formatCents),
    );
  }
  const orderTaxes = sumOf(
    invoice.orderIds.map((id) =>
      taxesCents((ordersById.get(id) as MatchOrderInput).declaredTaxes, `Commande ${id}`),
    ),
  );
  const invoiceTaxes = taxesCents(invoice.taxes, 'Facture');
  if (orderTaxes !== invoiceTaxes) {
    variances.push(
      variance('TAXES_DIFFER_FROM_ORDER', global, 'amount', orderTaxes, invoiceTaxes, formatCents),
    );
  }

  return {
    version: PURCHASES_VERSION,
    mode: threeWay ? 'three_way' : 'two_way',
    status: variances.some((v) => v.blocking) ? 'variance' : 'matched',
    variances,
    lines,
  };
}

/** Total saisi = sous-total + Σ taxes, au centime (`SUPPLIER_INVOICE_TOTAL_MISMATCH`). */
export function checkInvoiceTotal(
  subtotal: string,
  taxes: readonly DeclaredTaxInput[],
  total: string,
): InvoiceTotalCheck {
  const expected = centsOf(subtotal, 'Sous-total') + taxesCents(taxes, 'Facture');
  const actual = centsOf(total, 'Total');
  const ok = expected === actual;
  return {
    version: PURCHASES_VERSION,
    ok,
    code: ok ? null : 'SUPPLIER_INVOICE_TOTAL_MISMATCH',
    expected: formatCents(expected),
    actual: formatCents(actual),
    difference: formatCents(actual - expected),
  };
}

/** Σ des imputations de coût = total (`SUPPLIER_INVOICE_ALLOCATION_MISMATCH`). */
export function checkCostAllocations(
  total: string,
  allocations: readonly CostAllocationInput[],
): CostAllocationsCheck {
  const expected = centsOf(total, 'Total');
  const allocated = sumOf(allocations.map((a, i) => centsOf(a.amount, `Imputation ${i + 1}`)));
  const ok = allocations.length > 0 && allocated === expected;
  return {
    version: PURCHASES_VERSION,
    ok,
    code: ok ? null : 'SUPPLIER_INVOICE_ALLOCATION_MISMATCH',
    allocated: formatCents(allocated),
    total: formatCents(expected),
    difference: formatCents(allocated - expected),
  };
}
