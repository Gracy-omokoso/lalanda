// Encaissements (§ 6.2) et paiements fournisseurs (§ 6.5) → écritures.
//
// Une ligne de tiers par facture imputée, reliée à la facture (`matchRef`) pour
// le lettrage automatique. Si la facture a été passée à un autre taux que
// l'encaissement, la ligne de tiers garde le taux de la facture et l'écart va
// sur `exchange.difference` (compte d'attente par défaut, § 5).

import type {
  AuxiliaryAccount,
  EntrySide,
  PendingReason,
  PostingContext,
  PostingResult,
  ReceiptView,
  SettlementAllocationView,
  SupplierPaymentView,
} from '../types.js';
import {
  applyRate,
  draftLine,
  generationOf,
  rateInput,
  result,
  treasuryAccountOf,
} from './build.js';
import { centsOrNull, sumOf } from './money.js';
import type { DraftLine } from './rate.js';
import { receiptKey, supplierPaymentKey } from './source-keys.js';

interface Settlement {
  kind: 'sales_receipt' | 'supplier_payment';
  id: string;
  number: string | null;
  date: string;
  amount: string;
  currency: ReceiptView['currency'];
  method: string;
  accountId: string | null;
  party: AuxiliaryAccount | null;
  partyName: string | null;
  allocations: readonly SettlementAllocationView[];
  sourceKey: string;
  event: string;
  /** Côté de la trésorerie : débit pour un encaissement, crédit pour un paiement. */
  treasurySide: EntrySide;
  keys: { treasury: string; party: string; unallocated: string };
  matchKind: 'sales_invoice' | 'supplier_invoice';
  label: string;
}

function settle(s: Settlement, ctx: PostingContext): PostingResult {
  const source = { kind: s.kind, id: s.id };
  const amount = centsOrNull(s.amount);
  const allocations = s.allocations.map((a) => centsOrNull(a.amount));
  if (amount === null || allocations.some((a) => a === null || a <= 0n)) {
    return result(source, { pending: ['UNSUPPORTED_SOURCE'] });
  }
  const allocated = sumOf(allocations.map((a) => a ?? 0n));
  if (allocated > amount) return result(source, { pending: ['UNSUPPORTED_SOURCE'] });
  if (amount === 0n) return result(source, { skipped: 'ZERO_AMOUNT' });

  const pending: PendingReason[] = [];
  const treasuryAccount = treasuryAccountOf(ctx, s.accountId);
  if (treasuryAccount === null) pending.push('NO_TREASURY_ACCOUNT');
  const partySide: EntrySide = s.treasurySide === 'debit' ? 'credit' : 'debit';
  const common = { currency: s.currency, label: s.label } as const;

  const lines: DraftLine[] = [
    draftLine(ctx, {
      ...common,
      key: s.keys.treasury,
      side: s.treasurySide,
      cents: amount,
      tokens: { treasuryAccount },
    }),
  ];
  s.allocations.forEach((a, i) => {
    const pin = a.invoiceBookRate;
    lines.push(
      draftLine(ctx, {
        ...common,
        label: `${s.label} — ${a.invoiceNumber ?? a.invoiceId}`,
        key: s.keys.party,
        side: partySide,
        cents: allocations[i] ?? 0n,
        tokens: { party: s.party },
        matchRef: `${s.matchKind}:${a.invoiceId}`,
        pinnedRate: pin !== null && pin.rateSource !== 'same_currency' ? pin : null,
      }),
    );
  });
  if (amount > allocated) {
    lines.push(
      draftLine(ctx, {
        ...common,
        key: s.keys.unallocated,
        side: partySide,
        cents: amount - allocated,
        tokens: { party: s.party },
      }),
    );
  }

  const entry = applyRate(
    {
      sourceKey: s.sourceKey,
      journal:
        s.accountId === null
          ? { kind: 'misc', treasuryAccountId: null }
          : { kind: 'treasury', treasuryAccountId: s.accountId },
      date: s.date,
      label: s.label,
      source: {
        kind: s.kind,
        id: s.id,
        event: s.event,
        number: s.number,
        date: s.date,
        partyName: s.partyName,
      },
      lines,
      reversalOf: null,
      reversalReason: null,
      generation: generationOf(ctx),
    },
    rateInput(ctx),
  );
  return result(source, { entries: [entry], pending });
}

/** Écriture d'un encaissement (révision courante) ; annulé → aucune (contre-passation). */
export function entriesForReceipt(view: ReceiptView, ctx: PostingContext): PostingResult {
  const source = { kind: 'sales_receipt' as const, id: view.id };
  if (view.receivedOn < ctx.cutoverDate) return result(source, { skipped: 'BEFORE_CUTOVER' });
  if (view.status === 'cancelled') return result(source, { cancelled: true });
  return settle(
    {
      kind: 'sales_receipt',
      id: view.id,
      number: view.number,
      date: view.receivedOn,
      amount: view.amount,
      currency: view.currency,
      method: view.method,
      accountId: view.accountId,
      party: ctx.customerAccounts[view.customerId] ?? null,
      partyName: view.customerName,
      allocations: view.allocations,
      sourceKey: receiptKey(view.id, view.revision),
      event: `r${view.revision}`,
      treasurySide: 'debit',
      keys: {
        treasury: `receipt.${view.method}`,
        party: 'receipt.receivable',
        unallocated: 'receipt.unallocated',
      },
      matchKind: 'sales_invoice',
      label: `Encaissement ${view.number ?? view.id}${view.customerName ? ` — ${view.customerName}` : ''}`,
    },
    ctx,
  );
}

/** Écriture d'un paiement fournisseur ; annulé → aucune (contre-passation). */
export function entriesForSupplierPayment(
  view: SupplierPaymentView,
  ctx: PostingContext,
): PostingResult {
  const source = { kind: 'supplier_payment' as const, id: view.id };
  if (view.paidOn < ctx.cutoverDate) return result(source, { skipped: 'BEFORE_CUTOVER' });
  if (view.status === 'cancelled') return result(source, { cancelled: true });
  return settle(
    {
      kind: 'supplier_payment',
      id: view.id,
      number: view.number,
      date: view.paidOn,
      amount: view.amount,
      currency: view.currency,
      method: view.method,
      accountId: view.accountId,
      party: ctx.supplierAccounts[view.supplierId] ?? null,
      partyName: view.supplierName,
      allocations: view.allocations,
      sourceKey: supplierPaymentKey(view.id),
      event: 'record',
      treasurySide: 'credit',
      keys: {
        treasury: `purchase.payment.${view.method}`,
        party: 'purchase.payment.payable',
        unallocated: 'purchase.payment.unallocated',
      },
      matchKind: 'supplier_invoice',
      label: `Paiement fournisseur ${view.number ?? view.id}${view.supplierName ? ` — ${view.supplierName}` : ''}`,
    },
    ctx,
  );
}
