// Dépenses (§ 6.3) et factures fournisseurs (§ 6.4) → écritures.
//
// TVA DÉCLARÉE : jamais calculée, NON récupérée par défaut — elle reste dans la
// charge. Elle n'est séparée que si l'organisation est assujettie ET qu'une
// règle validée `…vat_declared` existe (décision ouverte n° 7).

import { resolveRule } from '../rules/resolve.js';
import type {
  ExpenseView,
  PostingContext,
  PostingNote,
  PostingResult,
  SupplierInvoiceView,
} from '../types.js';
import {
  applyRate,
  draftLine,
  generationOf,
  rateInput,
  result,
  treasuryAccountOf,
} from './build.js';
import { allocate, centsOrNull, sumOf } from './money.js';
import type { DraftLine } from './rate.js';
import { expenseKey, supplierInvoiceKey } from './source-keys.js';

/** Part de TVA déclarée à séparer (0 si non séparée) et constats. */
function declaredVat(
  ctx: PostingContext,
  key: string,
  declared: string | null,
  total: bigint,
): { vat: bigint; notes: PostingNote[] } | null {
  if (declared === null) return { vat: 0n, notes: [] };
  const vat = centsOrNull(declared);
  if (vat === null) return null;
  if (vat === 0n) return { vat: 0n, notes: [] };
  if (vat >= total) return { vat: 0n, notes: ['VAT_DECLARED_IGNORED'] };
  if (resolveRule(ctx.ruleSet, key).status !== 'rule') return { vat: 0n, notes: [] };
  if (!ctx.vatRegistered) return { vat: 0n, notes: ['VAT_RULE_IGNORED_NOT_REGISTERED'] };
  return { vat, notes: [] };
}

/** Écriture d'une dépense directe (révision courante) ; annulée → aucune. */
export function entriesForExpense(view: ExpenseView, ctx: PostingContext): PostingResult {
  const source = { kind: 'treasury_expense' as const, id: view.id };
  // Créée par un paiement fournisseur : déjà comptée par ce paiement (§ 6.3).
  if (view.origin !== null) return result(source, { skipped: 'CREATED_BY_SUPPLIER_PAYMENT' });
  if (view.spentOn < ctx.cutoverDate) return result(source, { skipped: 'BEFORE_CUTOVER' });
  if (view.status === 'cancelled') return result(source, { cancelled: true });

  const amount = centsOrNull(view.amount);
  if (amount === null) return result(source, { pending: ['UNSUPPORTED_SOURCE'] });
  if (amount === 0n) return result(source, { skipped: 'ZERO_AMOUNT' });
  const vat = declaredVat(ctx, 'expense.vat_declared', view.deductibleVat, amount);
  if (vat === null) return result(source, { pending: ['UNSUPPORTED_SOURCE'] });

  const treasuryAccount = treasuryAccountOf(ctx, view.accountId);
  const label = `Dépense — ${view.label}${view.supplierName ? ` (${view.supplierName})` : ''}`;
  const common = { currency: view.currency, label } as const;
  const lines: DraftLine[] = [
    draftLine(ctx, {
      ...common,
      key: `expense.${view.category}`,
      side: 'debit',
      cents: amount - vat.vat,
    }),
  ];
  if (vat.vat > 0n) {
    lines.push(
      draftLine(ctx, { ...common, key: 'expense.vat_declared', side: 'debit', cents: vat.vat }),
    );
  }
  lines.push(
    draftLine(ctx, {
      ...common,
      key: 'expense.payment',
      side: 'credit',
      cents: amount,
      tokens: { treasuryAccount },
    }),
  );

  const entry = applyRate(
    {
      sourceKey: expenseKey(view.id, view.revision),
      journal:
        view.accountId === null
          ? { kind: 'misc', treasuryAccountId: null }
          : { kind: 'treasury', treasuryAccountId: view.accountId },
      date: view.spentOn,
      label,
      source: {
        kind: 'treasury_expense',
        id: view.id,
        event: `r${view.revision}`,
        number: view.reference,
        date: view.spentOn,
        partyName: view.supplierName,
      },
      lines,
      reversalOf: null,
      reversalReason: null,
      generation: generationOf(ctx),
    },
    rateInput(ctx),
  );
  return result(source, {
    entries: [entry],
    pending: treasuryAccount === null ? ['NO_TREASURY_ACCOUNT'] : [],
    notes: vat.notes,
  });
}

/** Écriture d'une facture ou d'un avoir fournisseur validé ; annulé après validation → aucune. */
export function entriesForSupplierInvoice(
  view: SupplierInvoiceView,
  ctx: PostingContext,
): PostingResult {
  const source = { kind: 'supplier_invoice' as const, id: view.id };
  if (view.status === 'draft' || (view.status === 'cancelled' && !view.wasValidated)) {
    return result(source, { skipped: 'NOT_VALIDATED' });
  }
  if (view.invoiceDate < ctx.cutoverDate) return result(source, { skipped: 'BEFORE_CUTOVER' });
  if (view.status === 'cancelled') return result(source, { cancelled: true });

  const unsupported = (): PostingResult => result(source, { pending: ['UNSUPPORTED_SOURCE'] });
  const total = centsOrNull(view.total);
  const allocations = view.costAllocations.map((a) => centsOrNull(a.amount));
  if (total === null || allocations.some((a) => a === null)) return unsupported();
  const amounts = allocations.map((a) => a ?? 0n);
  if (sumOf(amounts) !== total) return unsupported();
  if (total === 0n) return result(source, { skipped: 'ZERO_AMOUNT' });

  const prefix = view.kind === 'credit_note' ? 'purchase.credit_note' : 'purchase.invoice';
  const chargeSide = view.kind === 'credit_note' ? 'credit' : 'debit';
  const payableSide = view.kind === 'credit_note' ? 'debit' : 'credit';
  const vat = declaredVat(ctx, `${prefix}.vat_declared`, view.deductibleVat, total);
  if (vat === null) return unsupported();
  // La TVA séparée vient en diminution des imputations, au prorata (§ 6.4).
  const charges = vat.vat > 0n ? allocate(total - vat.vat, amounts) : amounts;

  const label = `${view.kind === 'credit_note' ? 'Avoir' : 'Facture'} fournisseur ${view.number ?? view.id}${
    view.supplierName ? ` — ${view.supplierName}` : ''
  }`;
  const common = { currency: view.currency, label } as const;
  const lines: DraftLine[] = [];
  view.costAllocations.forEach((a, i) => {
    const cents = charges[i] ?? 0n;
    if (cents > 0n) {
      lines.push(
        draftLine(ctx, { ...common, key: `${prefix}.${a.category}`, side: chargeSide, cents }),
      );
    }
  });
  if (vat.vat > 0n) {
    lines.push(
      draftLine(ctx, {
        ...common,
        key: `${prefix}.vat_declared`,
        side: chargeSide,
        cents: vat.vat,
      }),
    );
  }
  lines.push(
    draftLine(ctx, {
      ...common,
      key: `${prefix}.payable`,
      side: payableSide,
      cents: total,
      tokens: { party: ctx.supplierAccounts[view.supplierId] ?? null },
      matchRef: `supplier_invoice:${view.id}`,
    }),
  );

  const entry = applyRate(
    {
      sourceKey: supplierInvoiceKey(view.id),
      journal: { kind: 'purchases', treasuryAccountId: null },
      date: view.invoiceDate,
      label,
      source: {
        kind: 'supplier_invoice',
        id: view.id,
        event: 'validate',
        number: view.number,
        date: view.invoiceDate,
        partyName: view.supplierName,
      },
      lines,
      reversalOf: null,
      reversalReason: null,
      generation: generationOf(ctx),
    },
    rateInput(ctx),
  );
  return result(source, { entries: [entry], notes: vat.notes });
}
