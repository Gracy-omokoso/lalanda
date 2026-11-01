// À-nouveaux de l'exercice suivant (ADR-0049 § 4, § 12 `computeOpeningEntries`).
//
// - Les comptes de bilan (nature `asset`, `liability`, `equity`, `mixed` dans le
//   pack) sont reportés EXACTEMENT : même solde en monnaie de tenue, même
//   solde en devise de la pièce, par compte, auxiliaire et devise.
// - Les comptes de gestion (`expense`, `income`) ne sont pas reportés : leur
//   solde net forme le résultat, porté au compte de résultat désigné par le
//   pack ou, à défaut, au compte d'attente (traitement à confirmer, E7).
// - `off_balance` n'est pas reporté (signalé). Un compte que le pack ne
//   rattache pas est reporté, et signalé : rien ne disparaît en silence.
// - Option : tiers détaillés par pièce ouverte (lignes non lettrées regroupées
//   par `documentRef`), pour que le lettrage continue l'exercice suivant.

import {
  byString,
  chartLookup,
  checkCurrency,
  checkDay,
  formatCents,
  postedLines,
  type ParsedLine,
} from '../ledger/money.js';
import {
  ACCOUNTING_REPORTING_VERSION,
  type ReportingAccountNature,
  type ReportingChart,
  type ReportingConfirmation,
  type ReportingCurrency,
  type ReportingDay,
  type ReportingEntry,
} from '../ledger/types.js';
import { TO_CONFIRM_NOTE } from '../statements/wording.js';

/** Ligne d'à-nouveau proposée. */
export interface OpeningLine {
  accountNumber: string;
  auxiliaryAccountNumber: string | null;
  label: string;
  /** Monnaie de tenue ; un seul côté non nul. */
  debit: string | null;
  credit: string | null;
  currency: ReportingCurrency;
  /** Solde signé en devise de la pièce (positif au débit), reporté tel quel. */
  amount: string;
  documentRef: string | null;
  confirmation: ReportingConfirmation;
  suspenseReason: string | null;
}

export type OpeningWarningCode =
  | 'UNCLASSIFIED_ACCOUNT_CARRIED'
  | 'OFF_BALANCE_NOT_CARRIED'
  | 'DOCUMENT_BALANCE_WITHOUT_BOOK_BALANCE'
  | 'DOCUMENT_SIGN_DIFFERS'
  | 'SOURCE_UNBALANCED';

export interface OpeningWarning {
  code: OpeningWarningCode;
  accountNumber: string | null;
  auxiliaryAccountNumber: string | null;
  currency: ReportingCurrency | null;
  bookBalance: string | null;
  documentBalance: string | null;
}

export interface OpeningEntriesInput {
  entries: readonly ReportingEntry[];
  bookCurrency: ReportingCurrency;
  /** Dernier jour de l'exercice clos (inclus). */
  fiscalYearEnd: ReportingDay;
  /** Date des à-nouveaux : premier jour de l'exercice suivant. */
  openingDate: ReportingDay;
  /** Code du journal d'à-nouveaux (réglage de l'organisation). */
  journalCode: string;
  chart: ReportingChart;
  /** Compte de résultat désigné par le pack ; `null` → compte d'attente. */
  resultAccountNumber: string | null;
  suspenseAccountNumber: string;
  /** Détailler les tiers par pièce ouverte (E7). Défaut : non. */
  detailThirdPartiesByDocument?: boolean;
}

export interface OpeningEntries {
  version: string;
  /** Proposition : jamais validée par le moteur. */
  proposal: true;
  journalCode: string;
  date: ReportingDay;
  label: string;
  lines: OpeningLine[];
  totals: { debit: string; credit: string };
  balanced: boolean;
  result: {
    /** Crédit − débit des comptes de gestion : positif = bénéfice. */
    amount: string;
    accountNumber: string;
    treatment: 'result_account' | 'suspense';
    note: string;
  };
  notCarried: { accountNumber: string; nature: ReportingAccountNature; balance: string }[];
  warnings: OpeningWarning[];
}

const CARRIED: ReadonlySet<ReportingAccountNature> = new Set(['asset', 'liability', 'equity', 'mixed']);

interface Bucket {
  account: string;
  aux: string | null;
  currency: ReportingCurrency;
  documentRef: string | null;
  book: bigint;
  doc: bigint;
  label: string;
}

export function computeOpeningEntries(input: OpeningEntriesInput): OpeningEntries {
  checkCurrency(input.bookCurrency, 'Monnaie de tenue');
  checkDay(input.fiscalYearEnd, "Fin d'exercice");
  checkDay(input.openingDate, 'Date des à-nouveaux');
  if (input.openingDate <= input.fiscalYearEnd) {
    throw new RangeError("Les à-nouveaux sont datés après la fin de l'exercice");
  }
  if (input.suspenseAccountNumber === '') throw new RangeError("Compte d'attente absent");
  const lookup = chartLookup(input.chart);
  const detail = input.detailThirdPartiesByDocument ?? false;
  const lines = postedLines(input.entries).filter((l) => l.entry.date <= input.fiscalYearEnd);
  const warnings: OpeningWarning[] = [];

  let sourceTotal = 0n;
  for (const l of lines) sourceTotal += l.book;
  if (sourceTotal !== 0n) {
    warnings.push({
      code: 'SOURCE_UNBALANCED',
      accountNumber: null,
      auxiliaryAccountNumber: null,
      currency: null,
      bookBalance: formatCents(sourceTotal),
      documentBalance: null,
    });
  }

  const buckets = new Map<string, Bucket>();
  const management = new Map<string, { nature: ReportingAccountNature; balance: bigint }>();
  const notCarried = new Map<string, { nature: ReportingAccountNature; balance: bigint }>();
  const unclassified = new Set<string>();
  let result = 0n; // débit − crédit des comptes de gestion

  const add = (l: ParsedLine, documentRef: string | null): void => {
    const aux = l.line.auxiliaryAccountNumber ?? null;
    const key = [l.line.accountNumber, aux ?? '', l.currency, documentRef ?? ''].join('\u0000');
    const b = buckets.get(key) ?? {
      account: l.line.accountNumber,
      aux,
      currency: l.currency,
      documentRef,
      book: 0n,
      doc: 0n,
      label: '',
    };
    b.book += l.book;
    b.doc += l.doc;
    buckets.set(key, b);
  };

  for (const l of lines) {
    const m = lookup(l.line.accountNumber);
    const nature = m.packAccount?.nature ?? null;
    if (nature === 'expense' || nature === 'income') {
      result += l.book;
      const g = management.get(l.line.accountNumber) ?? { nature, balance: 0n };
      g.balance += l.book;
      management.set(l.line.accountNumber, g);
      continue;
    }
    if (nature === 'off_balance') {
      const g = notCarried.get(l.line.accountNumber) ?? { nature, balance: 0n };
      g.balance += l.book;
      notCarried.set(l.line.accountNumber, g);
      continue;
    }
    if (nature === null) unclassified.add(l.line.accountNumber);
    else if (!CARRIED.has(nature)) continue;
    const docRef =
      detail && l.line.auxiliaryAccountNumber && !l.line.letteringCode
        ? (l.line.documentRef ?? null)
        : null;
    add(l, docRef || null);
  }

  for (const n of [...unclassified].sort(byString)) {
    warnings.push({
      code: 'UNCLASSIFIED_ACCOUNT_CARRIED',
      accountNumber: n,
      auxiliaryAccountNumber: null,
      currency: null,
      bookBalance: null,
      documentBalance: null,
    });
  }
  for (const [n, g] of [...notCarried.entries()].sort(([a], [b]) => byString(a, b))) {
    if (g.balance === 0n) continue;
    warnings.push({
      code: 'OFF_BALANCE_NOT_CARRIED',
      accountNumber: n,
      auxiliaryAccountNumber: null,
      currency: null,
      bookBalance: formatCents(g.balance),
      documentBalance: null,
    });
  }

  const out: OpeningLine[] = [];
  const sortedBuckets = [...buckets.entries()].sort(([a], [b]) => byString(a, b)).map(([, b]) => b);
  for (const b of sortedBuckets) {
    if (b.book === 0n) {
      if (b.doc !== 0n) {
        warnings.push({
          code: 'DOCUMENT_BALANCE_WITHOUT_BOOK_BALANCE',
          accountNumber: b.account,
          auxiliaryAccountNumber: b.aux,
          currency: b.currency,
          bookBalance: formatCents(0n),
          documentBalance: formatCents(b.doc),
        });
      }
      continue;
    }
    if (b.doc !== 0n && b.doc > 0n !== b.book > 0n) {
      warnings.push({
        code: 'DOCUMENT_SIGN_DIFFERS',
        accountNumber: b.account,
        auxiliaryAccountNumber: b.aux,
        currency: b.currency,
        bookBalance: formatCents(b.book),
        documentBalance: formatCents(b.doc),
      });
    }
    out.push({
      accountNumber: b.account,
      auxiliaryAccountNumber: b.aux,
      label: b.documentRef === null ? 'À-nouveau' : `À-nouveau — pièce ${b.documentRef}`,
      debit: b.book > 0n ? formatCents(b.book) : null,
      credit: b.book < 0n ? formatCents(-b.book) : null,
      currency: b.currency,
      amount: formatCents(b.doc),
      documentRef: b.documentRef,
      confirmation: lookup(b.account).confirmation,
      suspenseReason: null,
    });
  }

  const treatment = input.resultAccountNumber === null ? 'suspense' : 'result_account';
  const resultAccount = input.resultAccountNumber ?? input.suspenseAccountNumber;
  if (result !== 0n) {
    out.push({
      accountNumber: resultAccount,
      auxiliaryAccountNumber: null,
      label: "Résultat de l'exercice à affecter",
      debit: result > 0n ? formatCents(result) : null,
      credit: result < 0n ? formatCents(-result) : null,
      currency: input.bookCurrency,
      amount: formatCents(result),
      documentRef: null,
      confirmation: 'to_confirm',
      suspenseReason: treatment === 'suspense' ? 'RESULT_TREATMENT_TO_CONFIRM' : null,
    });
  }

  let debit = 0n;
  let credit = 0n;
  for (const l of out) {
    if (l.debit !== null) debit += BigInt(l.debit.replace('.', ''));
    if (l.credit !== null) credit += BigInt(l.credit.replace('.', ''));
  }

  return {
    version: ACCOUNTING_REPORTING_VERSION,
    proposal: true,
    journalCode: input.journalCode,
    date: input.openingDate,
    label: `À-nouveaux au ${input.openingDate}`,
    lines: out,
    totals: { debit: formatCents(debit), credit: formatCents(credit) },
    balanced: debit === credit,
    result: {
      amount: formatCents(-result),
      accountNumber: resultAccount,
      treatment,
      note: TO_CONFIRM_NOTE,
    },
    notCarried: [...notCarried.entries(), ...management.entries()]
      .sort(([a], [b]) => byString(a, b))
      .map(([accountNumber, g]) => ({ accountNumber, nature: g.nature, balance: formatCents(g.balance) })),
    warnings,
  };
}
