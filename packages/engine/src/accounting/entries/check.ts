// Contrôle d'une écriture (ADR-0049 § 2.6 Invariants, § 12 `checkEntry`).
//
// Équilibre en monnaie de tenue ET dans chaque devise de pièce ; un seul côté
// par ligne ; montants positifs ; comptes du plan ; période ouverte (fournie en
// entrée). Tous les problèmes sont rendus, pas le premier.

import {
  ACCOUNTING_VERSION,
  type AccountingCurrency,
  type EntryCheck,
  type EntryIssue,
  type EntryIssueCode,
  type ProposedEntry,
} from '../types.js';
import { centsOrNull, formatCents, isAccountingCurrency, isDay } from './money.js';

export interface CheckEntryOptions {
  /** Numéros du plan de l'organisation ; absent = non contrôlé. */
  chartAccounts?: readonly string[];
  /** Compte d'attente désigné (admis même hors `chartAccounts`). */
  suspenseAccount?: string;
  /** Mois ouverts `AAAA-MM` ; absent = non contrôlé. */
  openPeriods?: readonly string[];
}

export function checkEntry(entry: ProposedEntry, options: CheckEntryOptions = {}): EntryCheck {
  const issues: EntryIssue[] = [];
  const push = (code: EntryIssueCode, lineIndex: number | null, message: string): void => {
    issues.push({ code, lineIndex, message });
  };
  const awaiting = entry.status === 'awaiting_rate';

  if (entry.lines.length < 2)
    push('ENTRY_NO_LINES', null, 'Une écriture compte au moins deux lignes.');
  if (!isDay(entry.date))
    push('ENTRY_DATE_INVALID', null, `Date illisible : ${JSON.stringify(entry.date)}`);
  if (!isAccountingCurrency(entry.bookCurrency)) {
    push('ENTRY_BOOK_CURRENCY_INVALID', null, 'Monnaie de tenue inconnue.');
  }
  if (options.openPeriods !== undefined && isDay(entry.date)) {
    if (!options.openPeriods.includes(entry.date.slice(0, 7))) {
      push(
        'ACCOUNTING_PERIOD_CLOSED',
        null,
        `La période ${entry.date.slice(0, 7)} n’est pas ouverte.`,
      );
    }
  }

  const chart = options.chartAccounts === undefined ? null : new Set(options.chartAccounts);
  let bookDebit = 0n;
  let bookCredit = 0n;
  const perCurrency = new Map<AccountingCurrency, { debit: bigint; credit: bigint }>();

  entry.lines.forEach((line, i) => {
    if (line.side !== 'debit' && line.side !== 'credit') {
      push('LINE_SIDE_INVALID', i, 'Côté inconnu.');
      return;
    }
    if (line.accountNumber === '') push('LINE_ACCOUNT_MISSING', i, 'Compte absent.');
    else if (
      chart !== null &&
      !chart.has(line.accountNumber) &&
      line.accountNumber !== options.suspenseAccount
    ) {
      push('ACCOUNT_NOT_IN_CHART', i, `Compte hors plan : ${line.accountNumber}`);
    }
    if (
      line.suspenseReason !== null &&
      options.suspenseAccount !== undefined &&
      line.accountNumber !== options.suspenseAccount
    ) {
      push('SUSPENSE_FLAG_MISMATCH', i, 'Ligne en attente hors du compte d’attente.');
    }
    if (!isAccountingCurrency(line.currency)) {
      push('LINE_CURRENCY_INVALID', i, 'Devise inconnue.');
      return;
    }
    const amount = centsOrNull(line.amount);
    const amountOk = amount !== null && (line.exchangeDifference ? amount === 0n : amount > 0n);
    if (!amountOk) push('LINE_AMOUNT_INVALID', i, `Montant de pièce invalide : ${line.amount}`);
    else {
      const totals = perCurrency.get(line.currency) ?? { debit: 0n, credit: 0n };
      if (line.side === 'debit') totals.debit += amount;
      else totals.credit += amount;
      perCurrency.set(line.currency, totals);
    }

    if (awaiting) {
      if (line.bookAmount !== null || line.debit !== null || line.credit !== null) {
        push(
          'ENTRY_STATUS_MISMATCH',
          i,
          'Écriture en attente de taux portant des montants de tenue.',
        );
      }
      return;
    }
    const book = line.bookAmount === null ? null : centsOrNull(line.bookAmount);
    const sameCurrency = line.currency === entry.bookCurrency && !line.exchangeDifference;
    // Une ligne convertie peut valoir 0,00 en monnaie de tenue (centimes trop
    // petits) ; une ligne dans la monnaie de tenue, ou un écart de change, jamais.
    const bookOk =
      book !== null && (sameCurrency || line.exchangeDifference ? book > 0n : book >= 0n);
    if (!bookOk) {
      push('LINE_BOOK_AMOUNT_INVALID', i, `Montant de tenue invalide : ${String(line.bookAmount)}`);
      return;
    }
    const zero = '0.00';
    const expectedDebit = line.side === 'debit' ? line.bookAmount : zero;
    const expectedCredit = line.side === 'credit' ? line.bookAmount : zero;
    if (line.debit !== expectedDebit || line.credit !== expectedCredit) {
      push(
        'LINE_DEBIT_CREDIT_MISMATCH',
        i,
        'Débit et crédit ne reflètent pas le côté de la ligne.',
      );
    }
    if (sameCurrency && (book !== amount || line.rateSource !== 'same_currency')) {
      push('LINE_SAME_CURRENCY_RATE', i, 'Ligne dans la monnaie de tenue : taux 1 exigé.');
    }
    if (line.side === 'debit') bookDebit += book;
    else bookCredit += book;
  });

  if (!awaiting && bookDebit !== bookCredit) {
    push(
      'ENTRY_UNBALANCED',
      null,
      `Débits ${formatCents(bookDebit)} ≠ crédits ${formatCents(bookCredit)} en monnaie de tenue.`,
    );
  }
  const currencyTotals = [...perCurrency.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, t]) => {
      if (t.debit !== t.credit) {
        push(
          'ENTRY_UNBALANCED_IN_CURRENCY',
          null,
          `Débits ${formatCents(t.debit)} ≠ crédits ${formatCents(t.credit)} en ${currency}.`,
        );
      }
      return { currency, debit: formatCents(t.debit), credit: formatCents(t.credit) };
    });
  if (entry.suspense !== entry.lines.some((l) => l.suspenseReason !== null)) {
    push('SUSPENSE_FLAG_MISMATCH', null, 'Indicateur d’attente de l’écriture discordant.');
  }

  return {
    version: ACCOUNTING_VERSION,
    ok: issues.length === 0,
    issues,
    bookTotals: awaiting
      ? null
      : { debit: formatCents(bookDebit), credit: formatCents(bookCredit) },
    currencyTotals,
  };
}
