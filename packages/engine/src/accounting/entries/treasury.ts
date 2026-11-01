// Mouvements de trésorerie (§ 6.6) et de stock (§ 6.7) → écritures.
//
// Virement : deux écritures, une par compte (`:out`, `:in`), contrepartie
// `transfer.internal`. Entre devises, le taux est OBSERVÉ : la jambe dans une
// autre devise que la monnaie de tenue prend exactement le montant de l'autre
// jambe ; aucun écart n'est créé. `other_in` / `other_out` : nature inconnue,
// contrepartie TOUJOURS au compte d'attente.

import type {
  AccountingCurrency,
  EntrySide,
  PendingReason,
  PostingContext,
  PostingResult,
  ProposedEntry,
  StockMovementView,
  TreasuryMovementView,
} from '../types.js';
import {
  applyRate,
  draftLine,
  generationOf,
  rateInput,
  result,
  treasuryAccountOf,
} from './build.js';
import { centsOrNull } from './money.js';
import { stockMovementKey, treasuryMovementKey } from './source-keys.js';

interface Leg {
  event: 'out' | 'in' | 'record';
  accountId: string;
  currency: AccountingCurrency;
  cents: bigint;
  treasurySide: EntrySide;
  treasuryKey: string;
  counterpartKey: string;
  observedBookTotal: string | null;
}

/** Écritures d'un mouvement de trésorerie ; annulé → aucune (contre-passation). */
export function entriesForTreasuryMovement(
  view: TreasuryMovementView,
  ctx: PostingContext,
): PostingResult {
  const source = { kind: 'treasury_movement' as const, id: view.id };
  if (view.date < ctx.cutoverDate) return result(source, { skipped: 'BEFORE_CUTOVER' });
  if (view.status === 'cancelled') return result(source, { cancelled: true });
  const unsupported = (): PostingResult => result(source, { pending: ['UNSUPPORTED_SOURCE'] });

  const out = view.amountOut === null ? null : centsOrNull(view.amountOut);
  const inn = view.amountIn === null ? null : centsOrNull(view.amountIn);
  const legs: Leg[] = [];
  if (view.kind === 'transfer') {
    if (
      view.fromAccountId === null ||
      view.toAccountId === null ||
      view.fromCurrency === null ||
      view.toCurrency === null ||
      out === null ||
      inn === null ||
      out === 0n ||
      inn === 0n
    ) {
      return unsupported();
    }
    if (view.fromCurrency === view.toCurrency && out !== inn) return unsupported();
    const cross = view.fromCurrency !== view.toCurrency;
    legs.push(
      {
        event: 'out',
        accountId: view.fromAccountId,
        currency: view.fromCurrency,
        cents: out,
        treasurySide: 'credit',
        treasuryKey: 'transfer.treasury',
        counterpartKey: 'transfer.internal',
        observedBookTotal: cross && view.toCurrency === ctx.bookCurrency ? view.amountIn : null,
      },
      {
        event: 'in',
        accountId: view.toAccountId,
        currency: view.toCurrency,
        cents: inn,
        treasurySide: 'debit',
        treasuryKey: 'transfer.treasury',
        counterpartKey: 'transfer.internal',
        observedBookTotal: cross && view.fromCurrency === ctx.bookCurrency ? view.amountOut : null,
      },
    );
  } else if (view.kind === 'other_in') {
    if (view.toAccountId === null || view.toCurrency === null || inn === null || inn === 0n)
      return unsupported();
    legs.push({
      event: 'record',
      accountId: view.toAccountId,
      currency: view.toCurrency,
      cents: inn,
      treasurySide: 'debit',
      treasuryKey: 'other_in.treasury',
      counterpartKey: 'other_in.counterpart',
      observedBookTotal: null,
    });
  } else if (view.kind === 'other_out') {
    if (view.fromAccountId === null || view.fromCurrency === null || out === null || out === 0n)
      return unsupported();
    legs.push({
      event: 'record',
      accountId: view.fromAccountId,
      currency: view.fromCurrency,
      cents: out,
      treasurySide: 'credit',
      treasuryKey: 'other_out.treasury',
      counterpartKey: 'other_out.counterpart',
      observedBookTotal: null,
    });
  } else {
    return unsupported();
  }

  const pending: PendingReason[] = [];
  const generation = generationOf(ctx);
  const label = `${view.kind === 'transfer' ? 'Virement interne' : 'Mouvement de trésorerie'} — ${view.label}`;
  const entries: ProposedEntry[] = legs.map((leg) => {
    const treasuryAccount = treasuryAccountOf(ctx, leg.accountId);
    if (treasuryAccount === null) pending.push('NO_TREASURY_ACCOUNT');
    const common = { currency: leg.currency, label, cents: leg.cents } as const;
    return applyRate(
      {
        sourceKey: treasuryMovementKey(view.id, leg.event),
        journal: { kind: 'treasury', treasuryAccountId: leg.accountId },
        date: view.date,
        label,
        source: {
          kind: 'treasury_movement',
          id: view.id,
          event: leg.event,
          number: view.reference,
          date: view.date,
          partyName: null,
        },
        lines: [
          draftLine(ctx, {
            ...common,
            key: leg.treasuryKey,
            side: leg.treasurySide,
            tokens: { treasuryAccount },
          }),
          draftLine(ctx, {
            ...common,
            key: leg.counterpartKey,
            side: leg.treasurySide === 'debit' ? 'credit' : 'debit',
          }),
        ],
        reversalOf: null,
        reversalReason: null,
        generation,
      },
      rateInput(ctx, { observedBookTotal: leg.observedBookTotal }),
    );
  });
  return result(source, { entries, pending });
}

/** Écriture d'un mouvement de stock valorisé — seulement en inventaire permanent (§ 6.7). */
export function entriesForStockMovement(
  view: StockMovementView,
  ctx: PostingContext,
): PostingResult {
  const source = { kind: 'stock_movement' as const, id: view.id };
  if (ctx.stockPosting !== 'perpetual') return result(source, { skipped: 'STOCK_POSTING_OFF' });
  if (view.occurredOn < ctx.cutoverDate) return result(source, { skipped: 'BEFORE_CUTOVER' });
  if (view.kind === 'transfer_out' || view.kind === 'transfer_in')
    return result(source, { skipped: 'NO_VALUE' });
  if (view.costStatus === 'pending_cost')
    return result(source, { pending: ['STOCK_COST_PENDING'] });
  if (view.value === null) return result(source, { pending: ['STOCK_COST_PENDING'] });
  const value = centsOrNull(view.value);
  if (value === null) return result(source, { pending: ['UNSUPPORTED_SOURCE'] });
  if (value === 0n) return result(source, { skipped: 'NO_VALUE' });

  const key = `stock.${view.kind}`;
  const label = `Stock — ${view.label ?? view.kind}`;
  const common = { currency: view.currency, label, cents: value, key } as const;
  const entry = applyRate(
    {
      sourceKey: stockMovementKey(view.id),
      journal: { kind: 'misc', treasuryAccountId: null },
      date: view.occurredOn,
      label,
      source: {
        kind: 'stock_movement',
        id: view.id,
        event: '',
        number: null,
        date: view.occurredOn,
        partyName: null,
      },
      lines: [
        draftLine(ctx, { ...common, side: 'debit' }),
        draftLine(ctx, { ...common, side: 'credit' }),
      ],
      reversalOf: null,
      reversalReason: null,
      generation: generationOf(ctx),
    },
    rateInput(ctx),
  );
  return result(source, { entries: [entry] });
}
