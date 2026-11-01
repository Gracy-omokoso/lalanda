// Arithmétique exacte de la restitution comptable (ADR-0049 § 12) — fichier
// INTERNE au lot K3. Centimes en `bigint`, aucun flottant, aucune conversion.

import {
  REPORTING_CURRENCIES,
  type LineRef,
  type ReportingChart,
  type ReportingCurrency,
  type ReportingEntry,
  type ReportingLine,
} from './types.js';

const UNSIGNED = /^(\d{1,15})(?:\.(\d{1,2}))?$/;
const SIGNED = /^(-?)(\d{1,15})(?:\.(\d{1,2}))?$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;

/** Décimal positif ou nul (deux décimales au plus) → centimes ; lève sinon. */
export function centsOf(value: unknown, what: string): bigint {
  if (typeof value !== 'string') throw new RangeError(`${what} : montant décimal attendu`);
  const m = UNSIGNED.exec(value);
  if (m === null) {
    throw new RangeError(`${what} : montant illisible ${JSON.stringify(value)}`);
  }
  return BigInt(m[1] ?? '0') * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
}

/** Décimal signé (deux décimales au plus) → centimes ; lève sinon. */
export function signedCentsOf(value: unknown, what: string): bigint {
  if (typeof value !== 'string') throw new RangeError(`${what} : montant décimal attendu`);
  const m = SIGNED.exec(value);
  if (m === null) {
    throw new RangeError(`${what} : montant illisible ${JSON.stringify(value)}`);
  }
  const abs = BigInt(m[2] ?? '0') * 100n + BigInt((m[3] ?? '').padEnd(2, '0') || '0');
  return m[1] === '-' ? -abs : abs;
}

/** Centimes → « 12.05 », « -3.00 », « 0.00 ». */
export function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const integer = (abs / 100n).toString();
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${integer}.${fraction}`;
}

export const absOf = (v: bigint): bigint => (v < 0n ? -v : v);

export function checkCurrency(value: unknown, what: string): ReportingCurrency {
  if (typeof value !== 'string' || !(REPORTING_CURRENCIES as readonly string[]).includes(value)) {
    throw new RangeError(`${what} : devise inconnue ${JSON.stringify(value)}`);
  }
  return value as ReportingCurrency;
}

export function checkDay(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new RangeError(`${what} : date attendue`);
  const m = DAY.exec(value);
  if (m === null) throw new RangeError(`${what} : date illisible ${JSON.stringify(value)}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (mo < 1 || mo > 12 || d < 1 || d > days) {
    throw new RangeError(`${what} : date inexistante ${value}`);
  }
  return value;
}

export function checkMonth(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new RangeError(`${what} : mois attendu`);
  const m = MONTH.exec(value);
  if (m === null || Number(m[2]) < 1 || Number(m[2]) > 12) {
    throw new RangeError(`${what} : mois illisible ${JSON.stringify(value)}`);
  }
  return value;
}

/** Comparateur de chaînes stable (ordre des points de code). */
export const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const lineRefOf = (entryId: string, index: number): LineRef => `${entryId}#${index}`;

/** Ligne lue et vérifiée : débit − crédit signé en monnaie de tenue, montant signé en devise. */
export interface ParsedLine {
  ref: LineRef;
  entry: ReportingEntry;
  index: number;
  line: ReportingLine;
  /** Débit − crédit, monnaie de tenue. */
  book: bigint;
  debit: bigint;
  credit: bigint;
  currency: ReportingCurrency;
  /** Montant signé en devise de la pièce (positif au débit). */
  doc: bigint;
}

/** Lit une ligne : un seul côté, strictement positif ; montant en devise > 0. */
export function parseLine(entry: ReportingEntry, index: number): ParsedLine {
  const line = entry.lines[index];
  const where = `Écriture ${entry.id}, ligne ${index + 1}`;
  if (line === undefined) throw new RangeError(`${where} : ligne absente`);
  if (typeof line.accountNumber !== 'string' || line.accountNumber === '') {
    throw new RangeError(`${where} : compte absent`);
  }
  const hasDebit = line.debit !== null && line.debit !== undefined;
  const hasCredit = line.credit !== null && line.credit !== undefined;
  if (hasDebit === hasCredit) {
    throw new RangeError(`${where} : une ligne porte soit un débit, soit un crédit`);
  }
  const debit = hasDebit ? centsOf(line.debit, `${where}, débit`) : 0n;
  const credit = hasCredit ? centsOf(line.credit, `${where}, crédit`) : 0n;
  if (debit + credit <= 0n) throw new RangeError(`${where} : montant strictement positif attendu`);
  const currency = checkCurrency(line.currency, `${where}, devise`);
  const amount = centsOf(line.amount, `${where}, montant en devise`);
  if (amount <= 0n) throw new RangeError(`${where} : montant en devise strictement positif attendu`);
  return {
    ref: lineRefOf(entry.id, index),
    entry,
    index,
    line,
    book: debit - credit,
    debit,
    credit,
    currency,
    doc: hasDebit ? amount : -amount,
  };
}

/** Toutes les lignes des écritures `posted`, vérifiées, dans l'ordre d'entrée. */
export function postedLines(entries: readonly ReportingEntry[]): ParsedLine[] {
  const out: ParsedLine[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new RangeError(`Écriture en double : ${entry.id}`);
    seen.add(entry.id);
    if (entry.status !== 'posted') continue;
    checkDay(entry.date, `Écriture ${entry.id}, date`);
    for (let i = 0; i < entry.lines.length; i += 1) out.push(parseLine(entry, i));
  }
  return out;
}

/** Ordre des livres : date, journal, exercice, numéro, identifiant, rang. */
export function compareLines(a: ParsedLine, b: ParsedLine): number {
  return (
    byString(a.entry.date, b.entry.date) ||
    byString(a.entry.journalCode, b.entry.journalCode) ||
    (a.entry.fiscalYear ?? 0) - (b.entry.fiscalYear ?? 0) ||
    (a.entry.number ?? Number.MAX_SAFE_INTEGER) - (b.entry.number ?? Number.MAX_SAFE_INTEGER) ||
    byString(a.entry.id, b.entry.id) ||
    a.index - b.index
  );
}

/** Décompte des écritures écartées des livres, par statut. */
export function excludedCounts(entries: readonly ReportingEntry[]): {
  draft: number;
  awaitingRate: number;
} {
  let draft = 0;
  let awaitingRate = 0;
  for (const e of entries) {
    if (e.status === 'draft') draft += 1;
    else if (e.status === 'awaiting_rate') awaitingRate += 1;
  }
  return { draft, awaitingRate };
}

/** Somme par devise → liste triée de chaînes signées. */
export function currencyTotals(
  map: ReadonlyMap<ReportingCurrency, { debit: bigint; credit: bigint }>,
): { currency: ReportingCurrency; debit: string; credit: string; balance: string }[] {
  return [...map.entries()]
    .sort(([a], [b]) => byString(a, b))
    .map(([currency, t]) => ({
      currency,
      debit: formatCents(t.debit),
      credit: formatCents(t.credit),
      balance: formatCents(t.debit - t.credit),
    }));
}

/** Rattachement d'un compte au plan : compte du pack le plus long qui le préfixe, sinon classe. */
export interface ChartMatch {
  /** Compte du pack retenu (préfixe le plus long), ou `null`. */
  packAccount: ReportingChart['accounts'][number] | null;
  classNumber: string | null;
  classLabel: string | null;
  /** `to_confirm` si le compte ou la classe l'est, ou si le compte n'est pas rattaché. */
  confirmation: 'sourced' | 'to_confirm';
}

export function chartLookup(chart: ReportingChart | null | undefined): (n: string) => ChartMatch {
  const accounts = [...(chart?.accounts ?? [])].sort(
    (a, b) => b.number.length - a.number.length || byString(a.number, b.number),
  );
  const classes = [...(chart?.classes ?? [])]
    .map((c) => ({ ...c, number: String(c.number) }))
    .sort((a, b) => b.number.length - a.number.length || byString(a.number, b.number));
  const cache = new Map<string, ChartMatch>();
  return (number: string): ChartMatch => {
    const hit = cache.get(number);
    if (hit !== undefined) return hit;
    const packAccount = accounts.find((a) => number.startsWith(a.number)) ?? null;
    const classNumber =
      packAccount !== null
        ? String(packAccount.classNumber)
        : (classes.find((c) => number.startsWith(c.number))?.number ?? null);
    const klass = classNumber === null ? undefined : classes.find((c) => c.number === classNumber);
    const confirmation =
      packAccount !== null &&
      packAccount.confirmation === 'sourced' &&
      klass?.confirmation === 'sourced'
        ? 'sourced'
        : 'to_confirm';
    const match: ChartMatch = {
      packAccount,
      classNumber,
      classLabel: klass?.label ?? null,
      confirmation,
    };
    cache.set(number, match);
    return match;
  };
}
