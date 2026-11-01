// Monnaie de tenue (ADR-0049 § 5) — `applyRate`.
//
// Ordre des taux : même devise (1) → taux DE LA PIÈCE (conversion figée) →
// taux OBSERVÉ (deux montants d'un virement entre devises) → taux SAISI pour la
// date exacte de la pièce. Sans taux : `awaiting_rate`. Jamais de taux de la
// veille, de moyenne, de taux inverse ni de taux d'un autre document.
//
// Équilibre garanti : chaque côté reçoit le même total en monnaie de tenue,
// réparti entre ses lignes au plus grand reste. Un écart ne naît que de lignes
// « épinglées » au taux d'une autre pièce (encaissement d'une facture en
// devise) : il va sur `exchange.difference`, compte d'attente par défaut.

import { resolveAccount } from '../rules/resolve.js';
import {
  ACCOUNTING_VERSION,
  type AccountingAmount,
  type AccountingCurrency,
  type AccountingRate,
  type EnteredRate,
  type EntryGeneration,
  type EntryLine,
  type EntrySide,
  type EntrySource,
  type JournalRef,
  type MappingRuleSet,
  type ProposedEntry,
  type RateSource,
  type SuspenseReason,
} from '../types.js';
import {
  RATE_SCALE,
  allocate,
  centsOf,
  convert,
  divHalfUp,
  formatCents,
  formatRate,
  rateOrNull,
  sumOf,
} from './money.js';

/** Ligne avant conversion en monnaie de tenue. */
export interface DraftLine {
  operationKey: string;
  side: EntrySide;
  accountNumber: string;
  auxiliaryAccountNumber: string | null;
  label: string;
  currency: AccountingCurrency;
  /** Strictement positif. */
  amount: AccountingAmount;
  matchRef: string | null;
  suspenseReason: SuspenseReason | null;
  /** Taux imposé par une autre pièce (facture encaissée) ; l'écart va au change. */
  pinnedRate?: { rate: AccountingRate; rateSource: RateSource; rateRef: string | null } | null;
}

/** Écriture avant conversion : toutes ses lignes sont dans la devise de la pièce. */
export interface DraftEntry {
  sourceKey: string;
  journal: JournalRef;
  date: string;
  label: string;
  source: EntrySource;
  lines: DraftLine[];
  reversalOf: string | null;
  reversalReason: string | null;
  generation: EntryGeneration;
}

export interface ApplyRateInput {
  bookCurrency: AccountingCurrency;
  /** Conversion figée de la pièce : 1 `from` = `rate` `to`. */
  documentRate?: {
    from: AccountingCurrency;
    to: AccountingCurrency;
    rate: AccountingRate;
    reference: string | null;
  } | null;
  /**
   * Montant en monnaie de tenue CONSTATÉ par la pièce (autre jambe d'un virement
   * entre devises) : chaque côté de l'écriture vaut exactement ce montant.
   */
  observedBookTotal?: AccountingAmount | null;
  enteredRates: readonly EnteredRate[];
  /** Pour la ligne d'écart de change éventuelle. */
  ruleSet: MappingRuleSet | null;
  suspenseAccount: string;
}

type Choice =
  | { kind: 'rate'; rate: bigint; source: RateSource; ref: string | null }
  | { kind: 'observed'; total: bigint }
  | { kind: 'none' };

function chooseRate(
  draft: DraftEntry,
  currency: AccountingCurrency,
  input: ApplyRateInput,
): Choice {
  if (input.observedBookTotal !== undefined && input.observedBookTotal !== null) {
    return { kind: 'observed', total: centsOf(input.observedBookTotal, 'Montant observé') };
  }
  const doc = input.documentRate ?? null;
  if (doc !== null && doc.from === currency && doc.to === input.bookCurrency) {
    const rate = rateOrNull(doc.rate);
    if (rate === null)
      throw new RangeError(`Taux de la pièce illisible : ${JSON.stringify(doc.rate)}`);
    return { kind: 'rate', rate, source: 'document', ref: doc.reference };
  }
  const entered = input.enteredRates.find(
    (r) => r.date === draft.date && r.from === currency && r.to === input.bookCurrency,
  );
  if (entered !== undefined) {
    const rate = rateOrNull(entered.rate);
    if (rate === null)
      throw new RangeError(`Taux saisi illisible : ${JSON.stringify(entered.rate)}`);
    return { kind: 'rate', rate, source: 'entered', ref: entered.ref ?? null };
  }
  return { kind: 'none' };
}

function line(
  d: DraftLine,
  book: bigint | null,
  rate: AccountingRate | null,
  rateSource: RateSource | null,
  rateRef: string | null,
): EntryLine {
  const amount = formatCents(centsOf(d.amount, d.operationKey));
  const bookAmount = book === null ? null : formatCents(book);
  return {
    operationKey: d.operationKey,
    side: d.side,
    accountNumber: d.accountNumber,
    auxiliaryAccountNumber: d.auxiliaryAccountNumber,
    label: d.label,
    currency: d.currency,
    amount,
    bookAmount,
    debit: bookAmount === null ? null : d.side === 'debit' ? bookAmount : '0.00',
    credit: bookAmount === null ? null : d.side === 'credit' ? bookAmount : '0.00',
    rate,
    rateSource,
    rateRef,
    letteringCode: null,
    matchRef: d.matchRef,
    suspenseReason: d.suspenseReason,
    exchangeDifference: false,
  };
}

function entryOf(
  draft: DraftEntry,
  bookCurrency: AccountingCurrency,
  lines: EntryLine[],
  awaiting: boolean,
): ProposedEntry {
  return {
    sourceKey: draft.sourceKey,
    status: awaiting ? 'awaiting_rate' : 'ready',
    journal: draft.journal,
    date: draft.date,
    bookCurrency,
    label: draft.label,
    source: draft.source,
    lines,
    reversalOf: draft.reversalOf,
    reversalReason: draft.reversalReason,
    generation: { ...draft.generation, engineVersion: ACCOUNTING_VERSION },
    suspense: lines.some((l) => l.suspenseReason !== null),
  };
}

/**
 * Montants en monnaie de tenue d'une écriture (§ 5). Toutes les lignes sont
 * dans la même devise de pièce ; sans taux applicable, l'écriture est rendue
 * `awaiting_rate` (montants de tenue `null`), jamais convertie au hasard.
 */
export function applyRate(draft: DraftEntry, input: ApplyRateInput): ProposedEntry {
  const first = draft.lines[0];
  if (first === undefined) throw new RangeError(`Écriture sans ligne : ${draft.sourceKey}`);
  const currency = first.currency;
  if (draft.lines.some((l) => l.currency !== currency)) {
    throw new RangeError(`Écriture multidevise avant conversion : ${draft.sourceKey}`);
  }
  const amounts = draft.lines.map((l) => centsOf(l.amount, l.operationKey));
  if (amounts.some((a) => a <= 0n))
    throw new RangeError(`Montant nul ou négatif : ${draft.sourceKey}`);

  if (currency === input.bookCurrency) {
    const lines = draft.lines.map((d, i) => line(d, amounts[i] ?? 0n, '1', 'same_currency', null));
    return entryOf(draft, input.bookCurrency, lines, false);
  }

  const choice = chooseRate(draft, currency, input);
  if (choice.kind === 'none') {
    return entryOf(
      draft,
      input.bookCurrency,
      draft.lines.map((d) => line(d, null, null, null, null)),
      true,
    );
  }

  const books: bigint[] = amounts.map(() => 0n);
  const pinned = draft.lines.map((d) => (d.pinnedRate ? rateOrNull(d.pinnedRate.rate) : null));
  if (choice.kind === 'observed' && pinned.some((p) => p !== null)) {
    throw new RangeError(`Taux observé et taux épinglé incompatibles : ${draft.sourceKey}`);
  }
  for (const side of ['debit', 'credit'] as const) {
    const indexes = draft.lines
      .map((d, i) => (d.side === side && pinned[i] === null ? i : -1))
      .filter((i) => i >= 0);
    if (indexes.length === 0) continue;
    const sideAmounts = indexes.map((i) => amounts[i] ?? 0n);
    const total =
      choice.kind === 'observed' ? choice.total : convert(sumOf(sideAmounts), choice.rate);
    allocate(total, sideAmounts).forEach((share, k) => {
      books[indexes[k] ?? 0] = share;
    });
  }
  pinned.forEach((rate, i) => {
    if (rate !== null) books[i] = convert(amounts[i] ?? 0n, rate);
  });

  const displayRate =
    choice.kind === 'rate'
      ? formatRate(choice.rate)
      : formatRate(
          divHalfUp(
            choice.total * RATE_SCALE,
            sumOf(amounts.filter((_, i) => draft.lines[i]?.side === 'debit')),
          ),
        );
  const source: RateSource = choice.kind === 'rate' ? choice.source : 'observed';
  const ref = choice.kind === 'rate' ? choice.ref : null;
  const lines = draft.lines.map((d, i) => {
    const pin = d.pinnedRate ?? null;
    return pin !== null && pinned[i] !== null
      ? line(d, books[i] ?? 0n, formatRate(pinned[i] ?? 0n), pin.rateSource, pin.rateRef)
      : line(d, books[i] ?? 0n, displayRate, source, ref);
  });

  const debit = sumOf(books.filter((_, i) => draft.lines[i]?.side === 'debit'));
  const credit = sumOf(books.filter((_, i) => draft.lines[i]?.side === 'credit'));
  const gap = debit - credit;
  if (gap !== 0n) {
    if (!pinned.some((p) => p !== null)) {
      throw new RangeError(`Écart de conversion inattendu : ${draft.sourceKey}`);
    }
    const side: EntrySide = gap > 0n ? 'credit' : 'debit';
    const account = resolveAccount(
      input.ruleSet,
      'exchange.difference',
      side,
      {},
      input.suspenseAccount,
    );
    const abs = formatCents(gap > 0n ? gap : -gap);
    lines.push({
      operationKey: 'exchange.difference',
      side,
      accountNumber: account.accountNumber,
      auxiliaryAccountNumber: account.auxiliaryAccountNumber,
      label: `Écart de change à qualifier — ${draft.label}`,
      currency,
      amount: '0.00',
      bookAmount: abs,
      debit: side === 'debit' ? abs : '0.00',
      credit: side === 'credit' ? abs : '0.00',
      rate: null,
      rateSource: null,
      rateRef: null,
      letteringCode: null,
      matchRef: null,
      suspenseReason: account.suspenseReason === null ? null : 'EXCHANGE_DIFFERENCE',
      exchangeDifference: true,
    });
  }
  return entryOf(draft, input.bookCurrency, lines, false);
}
