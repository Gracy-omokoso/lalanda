// Factures et avoirs de vente → écritures (ADR-0049 § 6.1).
//
// Lu : série réelle, statut `issued` ou `normalized`, types FV FT EV ET (factures,
// dont acomptes) et FA EA (avoirs). Montants : totaux FIGÉS par groupe — le
// moteur ne recalcule ni base ni TVA. Les groupes H, I, J, L, N et les taxes
// spécifiques vont sur `…nonrevenue.<groupe>`, jamais d'office sur un produit.

import {
  ACCOUNTING_NON_REVENUE_TAX_GROUPS,
  type SalesDocumentPrefix,
} from '../rules/operation-keys.js';
import type {
  EntrySide,
  PendingReason,
  PostingContext,
  PostingNote,
  PostingResult,
  ProposedEntry,
  SalesInvoiceView,
} from '../types.js';
import { applyRate, draftLine, generationOf, rateInput, result } from './build.js';
import { allocate, centsOrNull, sumOf } from './money.js';
import type { DraftLine } from './rate.js';
import { salesInvoiceKey } from './source-keys.js';

const FINAL_STATUSES = ['issued', 'normalized'];

function prefixOf(type: string): SalesDocumentPrefix | null {
  if (type === 'FV' || type === 'EV') return 'sale.invoice';
  if (type === 'FT' || type === 'ET') return 'sale.deposit';
  if (type === 'FA' || type === 'EA') return 'sale.credit_note';
  return null;
}

const opposite = (side: EntrySide): EntrySide => (side === 'debit' ? 'credit' : 'debit');

/** Écritures d'une facture ou d'un avoir de vente figé. */
export function entriesForSalesInvoice(view: SalesInvoiceView, ctx: PostingContext): PostingResult {
  const source = { kind: 'sales_invoice' as const, id: view.id };
  if (view.date < ctx.cutoverDate) return result(source, { skipped: 'BEFORE_CUTOVER' });
  if (view.series === 'test') return result(source, { skipped: 'TEST_SERIES' });
  if (view.series !== 'real' || !FINAL_STATUSES.includes(view.status)) {
    return result(source, { skipped: 'NOT_FINAL' });
  }
  const prefix = prefixOf(view.type);
  const unsupported = (): PostingResult => result(source, { pending: ['UNSUPPORTED_SOURCE'] });
  if (prefix === null) return unsupported();

  const total = centsOrNull(view.total);
  if (total === null) return unsupported();
  if (total === 0n) return result(source, { skipped: 'ZERO_AMOUNT' });

  // Côté « client » : débit pour une facture, crédit pour un avoir.
  const partySide: EntrySide = prefix === 'sale.credit_note' ? 'credit' : 'debit';
  const otherSide = opposite(partySide);
  const party = ctx.customerAccounts[view.customerId] ?? null;
  const matchRef = `sales_invoice:${view.id}`;
  const label = `${prefix === 'sale.credit_note' ? 'Avoir' : 'Facture'} ${view.number ?? view.id}${
    view.customerName ? ` — ${view.customerName}` : ''
  }`;
  const common = { currency: view.currency, label } as const;

  const lines: DraftLine[] = [
    draftLine(ctx, {
      ...common,
      key: `${prefix}.receivable`,
      side: partySide,
      cents: total,
      tokens: { party },
      matchRef,
    }),
  ];

  let credited = 0n;
  const groups = [...view.groups].sort((a, b) =>
    a.group < b.group ? -1 : a.group > b.group ? 1 : 0,
  );
  for (const g of groups) {
    const ht = centsOrNull(g.ht);
    const vat = centsOrNull(g.vat);
    const groupTotal = centsOrNull(g.total);
    const specific = centsOrNull(g.specificTax);
    if (ht === null || vat === null || groupTotal === null || specific === null)
      return unsupported();
    if (ht + vat !== groupTotal || specific > ht) return unsupported();
    credited += groupTotal;
    const add = (key: string, cents: bigint): void => {
      if (cents > 0n) lines.push(draftLine(ctx, { ...common, key, side: otherSide, cents }));
    };
    if ((ACCOUNTING_NON_REVENUE_TAX_GROUPS as readonly string[]).includes(g.group)) {
      add(`${prefix}.nonrevenue.${g.group}`, groupTotal);
      continue;
    }
    const base = ht - specific;
    if (base > 0n) {
      const groupLines = view.lines.filter((l) => l.taxGroup === g.group);
      const weights = (['BIE', 'SER'] as const).map((t) =>
        sumOf(groupLines.filter((l) => l.itemType === t).map((l) => centsOrNull(l.amount) ?? -1n)),
      );
      if (groupLines.some((l) => l.itemType === 'TAX' || centsOrNull(l.amount) === null))
        return unsupported();
      if (sumOf(weights) <= 0n) return unsupported();
      const [goods = 0n, services = 0n] = allocate(base, weights);
      add(`${prefix}.revenue.BIE.${g.group}`, goods);
      add(`${prefix}.revenue.SER.${g.group}`, services);
    }
    add(`${prefix}.nonrevenue.${g.group}`, specific);
    add(`${prefix}.vat.${g.group}`, vat);
  }
  if (credited !== total) return unsupported();

  const generation = generationOf(ctx);
  const documentRate = view.conversion;
  const entries: ProposedEntry[] = [
    applyRate(
      {
        sourceKey: salesInvoiceKey(view.id, 'issue'),
        journal: { kind: 'sales', treasuryAccountId: null },
        date: view.date,
        label,
        source: {
          kind: 'sales_invoice',
          id: view.id,
          event: 'issue',
          number: view.number,
          date: view.date,
          partyName: view.customerName,
        },
        lines,
        reversalOf: null,
        reversalReason: null,
        generation,
      },
      rateInput(ctx, { documentRate }),
    ),
  ];

  // Paiements déclarés à l'émission (part non `CREDIT`), § 6.1.
  const pending: PendingReason[] = [];
  const notes: PostingNote[] = [];
  const paid = new Map<string, bigint>();
  for (const p of view.payments) {
    const cents = centsOrNull(p.amount);
    if (cents === null) return unsupported();
    if (p.method === 'CREDIT' || cents === 0n) continue;
    paid.set(p.method, (paid.get(p.method) ?? 0n) + cents);
  }
  const paidTotal = sumOf([...paid.values()]);
  if (paidTotal > total) return unsupported();
  if (paidTotal > 0n) {
    const paidLabel = `Réglé à l’émission — ${label}`;
    const paidLines: DraftLine[] = [...paid.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([method, cents]) =>
        draftLine(ctx, {
          currency: view.currency,
          label: paidLabel,
          key: `sale.payment_at_issue.${method}`,
          side: partySide,
          cents,
        }),
      );
    paidLines.push(
      draftLine(ctx, {
        currency: view.currency,
        label: paidLabel,
        key: 'sale.payment_at_issue.receivable',
        side: otherSide,
        cents: paidTotal,
        tokens: { party },
        matchRef,
      }),
    );
    entries.push(
      applyRate(
        {
          sourceKey: salesInvoiceKey(view.id, 'paid_at_issue'),
          journal: { kind: 'sales', treasuryAccountId: null },
          date: view.date,
          label: paidLabel,
          source: {
            kind: 'sales_invoice',
            id: view.id,
            event: 'paid_at_issue',
            number: view.number,
            date: view.date,
            partyName: view.customerName,
          },
          lines: paidLines,
          reversalOf: null,
          reversalReason: null,
          generation,
        },
        rateInput(ctx, { documentRate }),
      ),
    );
    notes.push('PAYMENTS_AT_ISSUE_NOT_IN_TREASURY');
  }
  return result(source, { entries, pending, notes });
}
