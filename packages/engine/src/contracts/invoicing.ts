// Reste à facturer d'une commande et synthèse des acomptes (ADR-0050 § 2.2,
// § 5.1, § 5.2, § 7).
//
// - Le reste à facturer se compte en QUANTITÉS par `lineRef` ; aucun montant
//   n'est recalculé ici (les montants viennent de `compose`). Une ligne de
//   facture dont l'article ou le prix unitaire ne correspond plus à la ligne de
//   commande est signalée `UNMATCHED_LINE`, jamais devinée ni comptée.
// - Avoirs (ADR-0054, décision du 3 nov. 2026) : la quantité créditée par des
//   avoirs GELÉS sur une ligne de facture émise est déduite du facturé ; le reste
//   à facturer remonte d'autant. Un avoir en brouillon ne compte pas.
// - Acomptes : sommes PAR DEVISE, sans conversion ; aucune imputation sur la
//   facture finale (décision ouverte n° 11) ; l'écart au montant demandé est
//   signalé, jamais corrigé.

import {
  byString,
  centsOf,
  checkCurrency,
  formatCents,
  formatQuantity,
  milliOf,
} from './common.js';
import {
  CONTRACTS_VERSION,
  type ContractCurrency,
  type DepositCurrencyTotals,
  type DepositInvoiceInput,
  type DepositLine,
  type DepositSummaryResult,
  type FinalInvoiceInput,
  type LinkedInvoiceInput,
  type OrderInvoicingIssue,
  type OrderInvoicingLine,
  type OrderInvoicingResult,
  type OrderLineInput,
} from './types.js';

const positive = (value: unknown, what: string): bigint => {
  const q = milliOf(value, what);
  if (q <= 0n) throw new RangeError(`${what} : quantité strictement positive attendue`);
  return q;
};

/**
 * Reste à facturer par `lineRef` (§ 2.2) : commandé − (émis − avoirs gelés), jamais négatif,
 * et commandé − émis − brouillons (ce que propose une nouvelle préparation).
 * La quantité comptée est celle de la LIGNE DE FACTURE (figée si émise).
 */
export function orderInvoicing(
  lines: readonly OrderLineInput[],
  linkedInvoices: readonly LinkedInvoiceInput[],
): OrderInvoicingResult {
  const order = new Map<string, { line: OrderLineInput; ordered: bigint; price: bigint }>();
  for (const line of lines) {
    if (typeof line.lineRef !== 'string' || line.lineRef === '') {
      throw new RangeError('Ligne de commande : `lineRef` requis');
    }
    if (order.has(line.lineRef)) throw new RangeError(`Ligne ${line.lineRef} en double`);
    order.set(line.lineRef, {
      line,
      ordered: positive(line.quantity, `Ligne ${line.lineRef} : quantité`),
      price: centsOf(line.unitPrice, `Ligne ${line.lineRef} : prix unitaire`),
    });
  }

  const issued = new Map<string, bigint>();
  const credited = new Map<string, bigint>();
  const drafts = new Map<string, bigint>();
  const issues: OrderInvoicingIssue[] = [];
  const seenInvoices = new Set<string>();

  for (const invoice of linkedInvoices) {
    if (seenInvoices.has(invoice.invoiceId)) {
      throw new RangeError(`Facture ${invoice.invoiceId} en double`);
    }
    seenInvoices.add(invoice.invoiceId);
    const target = invoice.state === 'issued' ? issued : drafts;
    const invoiceLines = new Map(invoice.lines.map((l) => [l.index, l]));
    const mapped = new Set<number>();
    for (const entry of invoice.lineMap) {
      const issue = (code: OrderInvoicingIssue['code']): void => {
        issues.push({
          code,
          invoiceId: invoice.invoiceId,
          lineRef: entry.lineRef,
          invoiceLineIndex: entry.invoiceLineIndex,
        });
      };
      if (mapped.has(entry.invoiceLineIndex)) {
        issue('DUPLICATE_MAPPING');
        continue;
      }
      mapped.add(entry.invoiceLineIndex);
      const ordered = order.get(entry.lineRef);
      if (ordered === undefined) {
        issue('UNKNOWN_LINE_REF');
        continue;
      }
      const invoiceLine = invoiceLines.get(entry.invoiceLineIndex);
      if (invoiceLine === undefined) {
        issue('MISSING_INVOICE_LINE');
        continue;
      }
      const what = `Facture ${invoice.invoiceId}, ligne ${entry.invoiceLineIndex}`;
      const price = centsOf(invoiceLine.unitPrice, `${what} : prix unitaire`);
      const quantity = positive(invoiceLine.quantity, `${what} : quantité`);
      if (
        (invoiceLine.catalogItemId ?? null) !== (ordered.line.catalogItemId ?? null) ||
        price !== ordered.price
      ) {
        issue('UNMATCHED_LINE');
        continue;
      }
      let counted = quantity;
      if (invoice.state === 'issued' && invoiceLine.credited !== undefined) {
        const c = milliOf(invoiceLine.credited, `${what} : quantité créditée`);
        if (c < 0n) throw new RangeError(`${what} : quantité créditée négative`);
        const deducted = c > quantity ? quantity : c;
        counted = quantity - deducted;
        if (deducted > 0n) {
          credited.set(entry.lineRef, (credited.get(entry.lineRef) ?? 0n) + deducted);
        }
      }
      target.set(entry.lineRef, (target.get(entry.lineRef) ?? 0n) + counted);
    }
  }

  let anyIssued = false;
  let allInvoiced = order.size > 0;
  const result: OrderInvoicingLine[] = [...order.values()].map(({ line, ordered }) => {
    const done = issued.get(line.lineRef) ?? 0n;
    const draft = drafts.get(line.lineRef) ?? 0n;
    const remaining = ordered > done ? ordered - done : 0n;
    const toPrepare = remaining > draft ? remaining - draft : 0n;
    const over = done > ordered ? done - ordered : 0n;
    if (done > 0n) anyIssued = true;
    if (remaining > 0n) allInvoiced = false;
    if (over > 0n) {
      issues.push({
        code: 'OVER_INVOICED',
        invoiceId: null,
        lineRef: line.lineRef,
        invoiceLineIndex: null,
      });
    }
    return {
      lineRef: line.lineRef,
      ordered: formatQuantity(ordered),
      invoiced: formatQuantity(done),
      credited: formatQuantity(credited.get(line.lineRef) ?? 0n),
      inDraft: formatQuantity(draft),
      remainingToInvoice: formatQuantity(remaining),
      remainingToPrepare: formatQuantity(toPrepare),
      overInvoiced: formatQuantity(over),
    };
  });

  const status = allInvoiced ? 'invoiced' : anyIssued ? 'partially_invoiced' : 'not_invoiced';
  return {
    version: CONTRACTS_VERSION,
    status,
    closeSuggested: status === 'invoiced',
    lines: result,
    issues,
  };
}

/**
 * Acomptes d'un engagement (§ 5.2) : facturés, en brouillon, encaissés, par
 * devise. `DEPOSIT_NOT_RESOLVED` tant qu'un acompte ÉMIS coexiste avec une
 * facture finale sans avoir été marqué « traité ». Rien n'est imputé.
 */
export function depositSummary(
  deposits: readonly DepositInvoiceInput[],
  finals: readonly FinalInvoiceInput[],
  resolved: readonly string[],
): DepositSummaryResult {
  const resolvedSet = new Set(resolved);
  const seen = new Set<string>();
  const totals = new Map<
    ContractCurrency,
    { requested: bigint; invoiced: bigint; inDraft: bigint; paid: bigint }
  >();

  const lines: DepositLine[] = deposits.map((d) => {
    if (seen.has(d.invoiceId)) throw new RangeError(`Acompte ${d.invoiceId} en double`);
    seen.add(d.invoiceId);
    const what = `Acompte ${d.invoiceId}`;
    const currency = checkCurrency(d.currency, what);
    if (d.state !== 'draft' && d.state !== 'issued') {
      throw new RangeError(`${what} : état inconnu ${JSON.stringify(d.state)}`);
    }
    const total = centsOf(d.total, `${what} : total`);
    const paid = centsOf(d.paid, `${what} : encaissé`);
    const requested =
      d.requestedAmount === null ? null : centsOf(d.requestedAmount, `${what} : montant demandé`);
    const sums = totals.get(currency) ?? { requested: 0n, invoiced: 0n, inDraft: 0n, paid: 0n };
    sums.requested += requested ?? 0n;
    if (d.state === 'issued') {
      sums.invoiced += total;
      sums.paid += paid;
    } else {
      sums.inDraft += total;
    }
    totals.set(currency, sums);
    return {
      invoiceId: d.invoiceId,
      currency,
      state: d.state,
      total: formatCents(total),
      paid: formatCents(paid),
      requestedAmount: requested === null ? null : formatCents(requested),
      gapToRequested: requested === null ? null : formatCents(total - requested),
      resolved: resolvedSet.has(d.invoiceId),
    };
  });

  const byCurrency: DepositCurrencyTotals[] = [...totals.entries()]
    .sort(([a], [b]) => byString(a, b))
    .map(([currency, s]) => ({
      currency,
      requested: formatCents(s.requested),
      invoiced: formatCents(s.invoiced),
      inDraft: formatCents(s.inDraft),
      paid: formatCents(s.paid),
    }));

  const unresolved =
    finals.length === 0
      ? []
      : lines
          .filter((l) => l.state === 'issued' && !l.resolved)
          .map((l) => l.invoiceId)
          .sort(byString);

  return {
    version: CONTRACTS_VERSION,
    deposits: lines,
    byCurrency,
    unresolved,
    issues:
      unresolved.length === 0 ? [] : [{ code: 'DEPOSIT_NOT_RESOLVED', invoiceIds: unresolved }],
  };
}
