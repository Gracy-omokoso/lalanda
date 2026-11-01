// Grand livre, balance générale, balances auxiliaires (ADR-0049 § 6.11).
//
// - Seules les écritures `posted` entrent dans les livres ; `draft` et
//   `awaiting_rate` sont comptées à part, jamais additionnées.
// - Les soldes sont en monnaie de tenue (débit − crédit) ; le grand livre et les
//   auxiliaires rendent AUSSI les totaux par devise de la pièce, sans conversion.
// - L'agrégation par classe vient du plan (pack) : aucun numéro n'est supposé ;
//   un compte non rattaché reste dans le groupe « non classé », marqué.

import {
  byString,
  chartLookup,
  checkCurrency,
  checkDay,
  compareLines,
  currencyTotals,
  excludedCounts,
  formatCents,
  postedLines,
  type ParsedLine,
} from './money.js';
import {
  ACCOUNTING_REPORTING_VERSION,
  type LineRef,
  type ReportingChart,
  type ReportingConfirmation,
  type ReportingCurrency,
  type ReportingDay,
  type ReportingEntry,
} from './types.js';

// ─── Période ─────────────────────────────────────────────────────────────────

export interface ReportingPeriodInput {
  entries: readonly ReportingEntry[];
  bookCurrency: ReportingCurrency;
  /** Premier jour de la période (inclus). Les lignes antérieures forment le solde d'ouverture. */
  from: ReportingDay;
  /** Dernier jour de la période (inclus). Les lignes postérieures sont ignorées. */
  to: ReportingDay;
  /**
   * Journaux d'à-nouveaux (code, par exemple celui du journal de kind `opening`) :
   * leurs lignes DANS la période sont comptées en ouverture, pas en mouvement.
   */
  openingJournalCodes?: readonly string[];
  chart?: ReportingChart | null;
}

interface PeriodSplit {
  opening: ParsedLine[];
  movements: ParsedLine[];
  after: number;
}

function splitPeriod(input: ReportingPeriodInput): PeriodSplit {
  checkCurrency(input.bookCurrency, 'Monnaie de tenue');
  checkDay(input.from, 'Début de période');
  checkDay(input.to, 'Fin de période');
  if (input.from > input.to) throw new RangeError('Période inversée');
  const openingJournals = new Set(input.openingJournalCodes ?? []);
  const opening: ParsedLine[] = [];
  const movements: ParsedLine[] = [];
  let after = 0;
  for (const l of postedLines(input.entries)) {
    if (l.entry.date > input.to) {
      after += 1;
      continue;
    }
    if (l.entry.date < input.from || openingJournals.has(l.entry.journalCode)) opening.push(l);
    else movements.push(l);
  }
  opening.sort(compareLines);
  movements.sort(compareLines);
  return { opening, movements, after };
}

/** Solde signé → colonnes débit / crédit (une seule non nulle). */
function sides(balance: bigint): { debit: string; credit: string } {
  return {
    debit: formatCents(balance > 0n ? balance : 0n),
    credit: formatCents(balance < 0n ? -balance : 0n),
  };
}

// ─── Grand livre ─────────────────────────────────────────────────────────────

export interface LedgerLineOut {
  ref: LineRef;
  entryId: string;
  journalCode: string;
  fiscalYear: number | null;
  number: number | null;
  date: ReportingDay;
  label: string;
  auxiliaryAccountNumber: string | null;
  debit: string;
  credit: string;
  /** Solde progressif en monnaie de tenue (débit − crédit). */
  balance: string;
  currency: ReportingCurrency;
  /** Montant signé en devise de la pièce (positif au débit). */
  amount: string;
  letteringCode: string | null;
  sourceKind: string | null;
  sourceId: string | null;
  sourceNumber: string | null;
}

export interface LedgerAccount {
  /** Compte général, ou compte auxiliaire si `level = 'auxiliary'`. */
  accountNumber: string;
  /** Compte général de rattachement (égal à `accountNumber` au niveau général). */
  generalAccountNumber: string;
  classNumber: string | null;
  confirmation: ReportingConfirmation;
  openingBalance: string;
  totalDebit: string;
  totalCredit: string;
  closingBalance: string;
  lines: LedgerLineOut[];
  /** Mouvements de la période par devise de la pièce — jamais additionnés entre devises. */
  byCurrency: { currency: ReportingCurrency; debit: string; credit: string; balance: string }[];
}

export interface Ledger {
  version: string;
  bookCurrency: ReportingCurrency;
  from: ReportingDay;
  to: ReportingDay;
  level: 'general' | 'auxiliary';
  accounts: LedgerAccount[];
  excluded: { draft: number; awaitingRate: number; afterPeriod: number };
}

export interface LedgerInput extends ReportingPeriodInput {
  /** `general` (défaut) : par compte général ; `auxiliary` : par compte auxiliaire seulement. */
  level?: 'general' | 'auxiliary';
  /** Restreint aux comptes dont le numéro commence par l'un de ces préfixes. */
  accountPrefixes?: readonly string[];
}

export function computeLedger(input: LedgerInput): Ledger {
  const level = input.level ?? 'general';
  const { opening, movements, after } = splitPeriod(input);
  const lookup = chartLookup(input.chart);
  const prefixes = input.accountPrefixes ?? null;
  const keyOf = (l: ParsedLine): string | null => {
    const key = level === 'general' ? l.line.accountNumber : l.line.auxiliaryAccountNumber;
    if (key === null || key === undefined) return null;
    if (prefixes !== null && !prefixes.some((p) => l.line.accountNumber.startsWith(p))) return null;
    return key;
  };

  interface Acc {
    general: string;
    opening: bigint;
    debit: bigint;
    credit: bigint;
    lines: ParsedLine[];
    byCurrency: Map<ReportingCurrency, { debit: bigint; credit: bigint }>;
  }
  const accounts = new Map<string, Acc>();
  const accOf = (key: string, l: ParsedLine): Acc => {
    let a = accounts.get(key);
    if (a === undefined) {
      a = {
        general: l.line.accountNumber,
        opening: 0n,
        debit: 0n,
        credit: 0n,
        lines: [],
        byCurrency: new Map(),
      };
      accounts.set(key, a);
    }
    return a;
  };
  for (const l of opening) {
    const key = keyOf(l);
    if (key !== null) accOf(key, l).opening += l.book;
  }
  for (const l of movements) {
    const key = keyOf(l);
    if (key === null) continue;
    const a = accOf(key, l);
    a.debit += l.debit;
    a.credit += l.credit;
    a.lines.push(l);
    const c = a.byCurrency.get(l.currency) ?? { debit: 0n, credit: 0n };
    if (l.doc > 0n) c.debit += l.doc;
    else c.credit -= l.doc;
    a.byCurrency.set(l.currency, c);
  }

  const out: LedgerAccount[] = [...accounts.entries()]
    .sort(([a], [b]) => byString(a, b))
    .map(([key, a]) => {
      let running = a.opening;
      const match = lookup(a.general);
      return {
        accountNumber: key,
        generalAccountNumber: a.general,
        classNumber: match.classNumber,
        confirmation: match.confirmation,
        openingBalance: formatCents(a.opening),
        totalDebit: formatCents(a.debit),
        totalCredit: formatCents(a.credit),
        closingBalance: formatCents(a.opening + a.debit - a.credit),
        lines: a.lines.map((l) => {
          running += l.book;
          return {
            ref: l.ref,
            entryId: l.entry.id,
            journalCode: l.entry.journalCode,
            fiscalYear: l.entry.fiscalYear,
            number: l.entry.number,
            date: l.entry.date,
            label: l.line.label,
            auxiliaryAccountNumber: l.line.auxiliaryAccountNumber ?? null,
            debit: formatCents(l.debit),
            credit: formatCents(l.credit),
            balance: formatCents(running),
            currency: l.currency,
            amount: formatCents(l.doc),
            letteringCode: l.line.letteringCode ?? null,
            sourceKind: l.entry.source?.kind ?? null,
            sourceId: l.entry.source?.id ?? null,
            sourceNumber: l.entry.source?.number ?? null,
          };
        }),
        byCurrency: currencyTotals(a.byCurrency),
      };
    });

  return {
    version: ACCOUNTING_REPORTING_VERSION,
    bookCurrency: input.bookCurrency,
    from: input.from,
    to: input.to,
    level,
    accounts: out,
    excluded: { ...excludedCounts(input.entries), afterPeriod: after },
  };
}

// ─── Balance générale ────────────────────────────────────────────────────────

export interface TrialBalanceRow {
  accountNumber: string;
  label: string | null;
  classNumber: string | null;
  confirmation: ReportingConfirmation;
  openingDebit: string;
  openingCredit: string;
  periodDebit: string;
  periodCredit: string;
  closingDebit: string;
  closingCredit: string;
  /** Solde de clôture signé (débit − crédit). */
  closingBalance: string;
}

export interface TrialBalanceTotals {
  openingDebit: string;
  openingCredit: string;
  periodDebit: string;
  periodCredit: string;
  closingDebit: string;
  closingCredit: string;
}

export interface TrialBalanceClass {
  /** `null` : comptes non rattachés au plan — à classer. */
  classNumber: string | null;
  classLabel: string | null;
  confirmation: ReportingConfirmation;
  accountCount: number;
  totals: TrialBalanceTotals;
}

export interface TrialBalance {
  version: string;
  bookCurrency: ReportingCurrency;
  from: ReportingDay;
  to: ReportingDay;
  rows: TrialBalanceRow[];
  classes: TrialBalanceClass[];
  totals: TrialBalanceTotals;
  /** Contrôle : totaux débit = totaux crédit (ouverture, période, clôture), aucune écriture déséquilibrée. */
  balanced: boolean;
  /** Écritures `posted` dont les débits ne valent pas les crédits en monnaie de tenue. */
  unbalancedEntries: { entryId: string; difference: string }[];
  excluded: { draft: number; awaitingRate: number; afterPeriod: number };
}

interface RowAcc {
  opening: bigint;
  debit: bigint;
  credit: bigint;
}

function totalsOf(rows: readonly RowAcc[]): TrialBalanceTotals {
  let od = 0n;
  let oc = 0n;
  let pd = 0n;
  let pc = 0n;
  let cd = 0n;
  let cc = 0n;
  for (const r of rows) {
    const closing = r.opening + r.debit - r.credit;
    if (r.opening > 0n) od += r.opening;
    else oc -= r.opening;
    pd += r.debit;
    pc += r.credit;
    if (closing > 0n) cd += closing;
    else cc -= closing;
  }
  return {
    openingDebit: formatCents(od),
    openingCredit: formatCents(oc),
    periodDebit: formatCents(pd),
    periodCredit: formatCents(pc),
    closingDebit: formatCents(cd),
    closingCredit: formatCents(cc),
  };
}

export function computeTrialBalance(input: ReportingPeriodInput): TrialBalance {
  const { opening, movements, after } = splitPeriod(input);
  const lookup = chartLookup(input.chart);

  const unbalanced: { entryId: string; difference: string }[] = [];
  const perEntry = new Map<string, bigint>();
  for (const l of [...opening, ...movements]) {
    perEntry.set(l.entry.id, (perEntry.get(l.entry.id) ?? 0n) + l.book);
  }
  for (const [entryId, diff] of [...perEntry.entries()].sort(([a], [b]) => byString(a, b))) {
    if (diff !== 0n) unbalanced.push({ entryId, difference: formatCents(diff) });
  }

  const rows = new Map<string, RowAcc>();
  const rowOf = (n: string): RowAcc => {
    let r = rows.get(n);
    if (r === undefined) {
      r = { opening: 0n, debit: 0n, credit: 0n };
      rows.set(n, r);
    }
    return r;
  };
  for (const l of opening) rowOf(l.line.accountNumber).opening += l.book;
  for (const l of movements) {
    const r = rowOf(l.line.accountNumber);
    r.debit += l.debit;
    r.credit += l.credit;
  }

  const sorted = [...rows.entries()].sort(([a], [b]) => byString(a, b));
  const outRows: TrialBalanceRow[] = sorted.map(([n, r]) => {
    const m = lookup(n);
    const o = sides(r.opening);
    const closing = r.opening + r.debit - r.credit;
    const c = sides(closing);
    return {
      accountNumber: n,
      label: m.packAccount?.number === n ? m.packAccount.label : null,
      classNumber: m.classNumber,
      confirmation: m.confirmation,
      openingDebit: o.debit,
      openingCredit: o.credit,
      periodDebit: formatCents(r.debit),
      periodCredit: formatCents(r.credit),
      closingDebit: c.debit,
      closingCredit: c.credit,
      closingBalance: formatCents(closing),
    };
  });

  const byClass = new Map<string, { m: ReturnType<typeof lookup>; rows: RowAcc[] }>();
  for (const [n, r] of sorted) {
    const m = lookup(n);
    const key = m.classNumber ?? '';
    const g = byClass.get(key) ?? { m, rows: [] };
    if (m.confirmation === 'to_confirm') g.m = m;
    g.rows.push(r);
    byClass.set(key, g);
  }
  const classes: TrialBalanceClass[] = [...byClass.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : byString(a, b)))
    .map(([key, g]) => ({
      classNumber: key === '' ? null : key,
      classLabel: g.m.classLabel,
      confirmation: key === '' ? 'to_confirm' : g.m.confirmation,
      accountCount: g.rows.length,
      totals: totalsOf(g.rows),
    }));

  const totals = totalsOf([...rows.values()]);
  const balanced =
    unbalanced.length === 0 &&
    totals.openingDebit === totals.openingCredit &&
    totals.periodDebit === totals.periodCredit &&
    totals.closingDebit === totals.closingCredit;

  return {
    version: ACCOUNTING_REPORTING_VERSION,
    bookCurrency: input.bookCurrency,
    from: input.from,
    to: input.to,
    rows: outRows,
    classes,
    totals,
    balanced,
    unbalancedEntries: unbalanced,
    excluded: { ...excludedCounts(input.entries), afterPeriod: after },
  };
}

// ─── Balances auxiliaires ────────────────────────────────────────────────────

export interface AuxiliaryBalanceRow {
  auxiliaryAccountNumber: string;
  collectiveAccountNumber: string;
  partyName: string | null;
  openingBalance: string;
  periodDebit: string;
  periodCredit: string;
  closingBalance: string;
  /** Solde à la fin de période par devise de la pièce, ouverture comprise. */
  byCurrency: { currency: ReportingCurrency; balance: string }[];
  unletteredLineCount: number;
}

export interface AuxiliaryBalanceGroup {
  collectiveAccountNumber: string;
  auxiliaryKind: 'customer' | 'supplier' | null;
  rows: AuxiliaryBalanceRow[];
  /** Somme des auxiliaires (monnaie de tenue). */
  closingBalance: string;
  /** Solde du collectif porté SANS auxiliaire : écart de centralisation signalé, jamais réparti. */
  withoutAuxiliaryBalance: string;
}

export interface AuxiliaryBalances {
  version: string;
  bookCurrency: ReportingCurrency;
  from: ReportingDay;
  to: ReportingDay;
  groups: AuxiliaryBalanceGroup[];
  /** Un même compte auxiliaire porté sous plusieurs collectifs (anomalie de saisie). */
  conflicts: { auxiliaryAccountNumber: string; collectiveAccountNumbers: string[] }[];
}

export function computeAuxiliaryBalances(input: ReportingPeriodInput): AuxiliaryBalances {
  const { opening, movements } = splitPeriod(input);
  const lookup = chartLookup(input.chart);

  interface Aux {
    collective: string;
    partyName: string | null;
    opening: bigint;
    debit: bigint;
    credit: bigint;
    docs: Map<ReportingCurrency, bigint>;
    unlettered: number;
  }
  const auxes = new Map<string, Aux>();
  const collectives = new Map<string, Set<string>>();
  const withoutAux = new Map<string, bigint>();
  const auxCollectives = new Set<string>();

  const all = [
    ...opening.map((l) => ({ l, inPeriod: false })),
    ...movements.map((l) => ({ l, inPeriod: true })),
  ];
  for (const { l } of all) {
    if (l.line.auxiliaryAccountNumber) auxCollectives.add(l.line.accountNumber);
  }
  for (const { l, inPeriod } of all) {
    const auxNo = l.line.auxiliaryAccountNumber ?? null;
    const coll = l.line.accountNumber;
    if (auxNo === null) {
      if (auxCollectives.has(coll)) withoutAux.set(coll, (withoutAux.get(coll) ?? 0n) + l.book);
      continue;
    }
    const key = `${coll}\u0000${auxNo}`;
    const set = collectives.get(auxNo) ?? new Set<string>();
    set.add(coll);
    collectives.set(auxNo, set);
    let a = auxes.get(key);
    if (a === undefined) {
      a = {
        collective: coll,
        partyName: null,
        opening: 0n,
        debit: 0n,
        credit: 0n,
        docs: new Map(),
        unlettered: 0,
      };
      auxes.set(key, a);
    }
    if (a.partyName === null && l.entry.source?.partyName) a.partyName = l.entry.source.partyName;
    if (inPeriod) {
      a.debit += l.debit;
      a.credit += l.credit;
    } else a.opening += l.book;
    a.docs.set(l.currency, (a.docs.get(l.currency) ?? 0n) + l.doc);
    if (!l.line.letteringCode) a.unlettered += 1;
  }

  const groups = new Map<string, AuxiliaryBalanceRow[]>();
  const groupTotals = new Map<string, bigint>();
  for (const [key, a] of [...auxes.entries()].sort(([x], [y]) => byString(x, y))) {
    const auxNo = key.split('\u0000')[1] ?? '';
    const closing = a.opening + a.debit - a.credit;
    const rows = groups.get(a.collective) ?? [];
    rows.push({
      auxiliaryAccountNumber: auxNo,
      collectiveAccountNumber: a.collective,
      partyName: a.partyName,
      openingBalance: formatCents(a.opening),
      periodDebit: formatCents(a.debit),
      periodCredit: formatCents(a.credit),
      closingBalance: formatCents(closing),
      byCurrency: [...a.docs.entries()]
        .sort(([x], [y]) => byString(x, y))
        .map(([currency, v]) => ({ currency, balance: formatCents(v) })),
      unletteredLineCount: a.unlettered,
    });
    groups.set(a.collective, rows);
    groupTotals.set(a.collective, (groupTotals.get(a.collective) ?? 0n) + closing);
  }

  return {
    version: ACCOUNTING_REPORTING_VERSION,
    bookCurrency: input.bookCurrency,
    from: input.from,
    to: input.to,
    groups: [...groups.entries()]
      .sort(([a], [b]) => byString(a, b))
      .map(([coll, rows]) => ({
        collectiveAccountNumber: coll,
        auxiliaryKind: lookup(coll).packAccount?.auxiliaryKind ?? null,
        rows,
        closingBalance: formatCents(groupTotals.get(coll) ?? 0n),
        withoutAuxiliaryBalance: formatCents(withoutAux.get(coll) ?? 0n),
      })),
    conflicts: [...collectives.entries()]
      .filter(([, set]) => set.size > 1)
      .sort(([a], [b]) => byString(a, b))
      .map(([auxiliaryAccountNumber, set]) => ({
        auxiliaryAccountNumber,
        collectiveAccountNumbers: [...set].sort(byString),
      })),
  };
}
