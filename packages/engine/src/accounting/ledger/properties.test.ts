// Propriétés de la restitution comptable (ADR-0049 § Plan de validation, lot
// K3). Générateur pseudo-aléatoire à GRAINE FIXE : un échec est rejouable à
// l'identique (la graine figure dans le message). Délais explicites : ces
// tests rejouent plusieurs centaines de jeux d'écritures.

import { describe, expect, it } from 'vitest';

import { computeOpeningEntries } from '../closing/index.js';
import {
  checkLettering,
  computeAuxiliaryBalances,
  computeLedger,
  computeTrialBalance,
  resolveLettering,
  suggestLettering,
  type LetteringEvent,
  type ReportingChart,
  type ReportingCurrency,
  type ReportingEntry,
  type ReportingLine,
} from './index.js';

const HEAVY_TIMEOUT = 180_000;
const RUNS = 200;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
const int = (r: () => number, lo: number, hi: number): number =>
  lo + Math.floor(r() * (hi - lo + 1));
const fmt = (c: bigint): string => `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;
const cents = (s: string): bigint => {
  const neg = s.startsWith('-');
  const [i = '0', f = '0'] = (neg ? s.slice(1) : s).split('.');
  const v = BigInt(i) * 100n + BigInt(f.padEnd(2, '0'));
  return neg ? -v : v;
};

// Plan de test : numéros fictifs, déclarés ici seulement.
const chart: ReportingChart = {
  classes: [
    { number: '1', label: 'c1', confirmation: 'to_confirm' },
    { number: '4', label: 'c4', confirmation: 'to_confirm' },
    { number: '5', label: 'c5', confirmation: 'to_confirm' },
    { number: '6', label: 'c6', confirmation: 'to_confirm' },
    { number: '7', label: 'c7', confirmation: 'to_confirm' },
  ],
  accounts: [
    {
      number: '10',
      label: 'Capital',
      classNumber: '1',
      nature: 'equity',
      confirmation: 'to_confirm',
    },
    {
      number: '40',
      label: 'Fournisseurs',
      classNumber: '4',
      nature: 'liability',
      confirmation: 'to_confirm',
      auxiliaryKind: 'supplier',
    },
    {
      number: '41',
      label: 'Clients',
      classNumber: '4',
      nature: 'asset',
      confirmation: 'to_confirm',
      auxiliaryKind: 'customer',
    },
    { number: '44', label: 'État', classNumber: '4', nature: 'mixed', confirmation: 'to_confirm' },
    {
      number: '52',
      label: 'Banque',
      classNumber: '5',
      nature: 'asset',
      confirmation: 'to_confirm',
    },
    {
      number: '60',
      label: 'Achats',
      classNumber: '6',
      nature: 'expense',
      confirmation: 'to_confirm',
    },
    {
      number: '70',
      label: 'Ventes',
      classNumber: '7',
      nature: 'income',
      confirmation: 'to_confirm',
    },
  ],
};
const ACCOUNTS = ['101', '401', '411', '4431', '521', '601', '706', 'ATT'] as const;
const AUX: Record<string, readonly string[]> = { '401': ['F1', 'F2'], '411': ['C1', 'C2', 'C3'] };

function randomLine(r: () => number, book: bigint, side: 'D' | 'C'): ReportingLine {
  const account = pick(r, ACCOUNTS);
  const auxes = AUX[account];
  const currency: ReportingCurrency = r() < 0.3 ? 'USD' : 'CDF';
  const doc = currency === 'CDF' ? book : BigInt(int(r, 1, 50_000));
  return {
    accountNumber: account,
    auxiliaryAccountNumber: auxes ? pick(r, auxes) : null,
    label: 'g',
    debit: side === 'D' ? fmt(book) : null,
    credit: side === 'C' ? fmt(book) : null,
    currency,
    amount: fmt(doc),
  };
}

/** Écriture équilibrée en monnaie de tenue : n−1 lignes libres, la dernière solde. */
function randomEntry(r: () => number, id: string, year = 2026): ReportingEntry {
  const lines: ReportingLine[] = [];
  let sum = 0n;
  const n = int(r, 1, 4);
  for (let i = 0; i < n; i += 1) {
    const book = BigInt(int(r, 1, 5_000_000));
    const side = r() < 0.5 ? 'D' : 'C';
    sum += side === 'D' ? book : -book;
    lines.push(randomLine(r, book, side));
  }
  if (sum === 0n) {
    const book = BigInt(int(r, 1, 1000));
    lines.push(randomLine(r, book, 'D'));
    sum += book;
  }
  lines.push(randomLine(r, sum > 0n ? sum : -sum, sum > 0n ? 'C' : 'D'));
  const status = r() < 0.85 ? 'posted' : pick(r, ['draft', 'awaiting_rate'] as const);
  const month = int(r, 1, 12);
  const day = int(r, 1, 28);
  return {
    id,
    journalCode: pick(r, ['VE', 'AC', 'OD', 'T01']),
    fiscalYear: year,
    number: int(r, 1, 999),
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    status,
    source: null,
    sourceKey: null,
    lines,
  };
}

const randomBook = (seed: number): ReportingEntry[] => {
  const r = rng(seed);
  return Array.from({ length: int(r, 1, 40) }, (_, i) => randomEntry(r, `s${seed}-e${i}`));
};

describe('propriété : la balance est équilibrée quand les écritures le sont', () => {
  it(
    `${RUNS} jeux aléatoires : balance, classes, grand livre et auxiliaires concordent`,
    () => {
      for (let seed = 1; seed <= RUNS; seed += 1) {
        const entries = randomBook(seed);
        const r = rng(seed * 7919);
        const fromM = int(r, 1, 12);
        const toM = int(r, fromM, 12);
        const period = {
          entries,
          bookCurrency: 'CDF' as const,
          from: `2026-${String(fromM).padStart(2, '0')}-01`,
          to: `2026-${String(toM).padStart(2, '0')}-28`,
          chart,
        };
        const tb = computeTrialBalance(period);
        const msg = `graine ${seed}`;
        expect(tb.balanced, msg).toBe(true);
        expect(tb.unbalancedEntries, msg).toEqual([]);
        expect(tb.totals.periodDebit, msg).toBe(tb.totals.periodCredit);
        expect(tb.totals.closingDebit, msg).toBe(tb.totals.closingCredit);
        const sumClasses = (k: 'periodDebit' | 'closingCredit'): bigint =>
          tb.classes.reduce((s, c) => s + cents(c.totals[k]), 0n);
        expect(fmt(sumClasses('periodDebit')), msg).toBe(tb.totals.periodDebit);
        expect(fmt(sumClasses('closingCredit')), msg).toBe(tb.totals.closingCredit);
        expect(
          tb.rows.reduce((s, x) => s + cents(x.closingBalance), 0n),
          msg,
        ).toBe(0n);

        const ledger = computeLedger(period);
        for (const a of ledger.accounts) {
          const row = tb.rows.find((x) => x.accountNumber === a.accountNumber);
          expect(a.closingBalance, msg).toBe(row?.closingBalance);
          const last = a.lines.at(-1);
          if (last) expect(last.balance, msg).toBe(a.closingBalance);
        }
        const aux = computeAuxiliaryBalances(period);
        for (const g of aux.groups) {
          const row = tb.rows.find((x) => x.accountNumber === g.collectiveAccountNumber);
          expect(cents(g.closingBalance) + cents(g.withoutAuxiliaryBalance), msg).toBe(
            cents(row?.closingBalance ?? '0.00'),
          );
        }
      }
    },
    HEAVY_TIMEOUT,
  );

  it(
    'une écriture faussée d’un centime rend la balance déséquilibrée et la désigne',
    () => {
      for (let seed = 1; seed <= 60; seed += 1) {
        const entries = randomBook(seed).map((e) => ({ ...e, status: 'posted' as const }));
        const victim = entries[0];
        if (victim === undefined) continue;
        const first = victim.lines[0] as ReportingLine;
        const bumped: ReportingLine =
          first.debit !== null
            ? { ...first, debit: fmt(cents(first.debit) + 1n) }
            : { ...first, credit: fmt(cents(first.credit ?? '0') + 1n) };
        entries[0] = { ...victim, lines: [bumped, ...victim.lines.slice(1)] };
        const tb = computeTrialBalance({
          entries,
          bookCurrency: 'CDF',
          from: '2026-01-01',
          to: '2026-12-31',
        });
        expect(tb.balanced, `graine ${seed}`).toBe(false);
        expect(
          tb.unbalancedEntries.map((u) => u.entryId),
          `graine ${seed}`,
        ).toEqual([victim.id]);
      }
    },
    HEAVY_TIMEOUT,
  );
});

/** Factures et règlements partiels ou complets, par tiers et devise, citant leur facture. */
function randomReceivables(seed: number): ReportingEntry[] {
  const r = rng(seed);
  const out: ReportingEntry[] = [];
  const n = int(r, 1, 12);
  for (let i = 0; i < n; i += 1) {
    const aux = pick(r, ['C1', 'C2', 'C3']);
    const currency: ReportingCurrency = r() < 0.4 ? 'USD' : 'CDF';
    const doc = BigInt(int(r, 100, 900_000));
    const rateIn = currency === 'CDF' ? 1n : BigInt(int(r, 2000, 3000));
    const ref = `inv${i}`;
    const line = (
      account: string,
      side: 'D' | 'C',
      book: bigint,
      d: bigint,
      auxNo: string | null,
    ): ReportingLine => ({
      accountNumber: account,
      auxiliaryAccountNumber: auxNo,
      label: ref,
      debit: side === 'D' ? fmt(book) : null,
      credit: side === 'C' ? fmt(book) : null,
      currency,
      amount: fmt(d),
      documentRef: auxNo ? ref : null,
    });
    out.push({
      id: `f${i}`,
      journalCode: 'VE',
      fiscalYear: 2026,
      number: i + 1,
      date: '2026-02-01',
      status: 'posted',
      source: null,
      sourceKey: null,
      lines: [line('411', 'D', doc * rateIn, doc, aux), line('706', 'C', doc * rateIn, doc, null)],
    });
    // 0 à 3 règlements dont la somme ne dépasse pas la facture
    let left = doc;
    const k = int(r, 0, 3);
    for (let j = 0; j < k && left > 0n; j += 1) {
      const pay = j === k - 1 && r() < 0.6 ? left : BigInt(int(r, 1, Number(left)));
      left -= pay;
      const rateOut = currency === 'CDF' ? 1n : BigInt(int(r, 2000, 3000));
      out.push({
        id: `r${i}-${j}`,
        journalCode: 'T01',
        fiscalYear: 2026,
        number: j + 1,
        date: '2026-03-01',
        status: 'posted',
        source: null,
        sourceKey: null,
        lines: [
          line('521', 'D', pay * rateOut, pay, null),
          line('411', 'C', pay * rateOut, pay, aux),
        ],
      });
    }
  }
  return out;
}

describe('propriété : le lettrage est cohérent', () => {
  it(
    `${RUNS} jeux : suggestions sommées à zéro en devise, une ligne au plus par lettrage`,
    () => {
      for (let seed = 1; seed <= RUNS; seed += 1) {
        const entries = randomReceivables(seed);
        const msg = `graine ${seed}`;
        const { suggestions } = suggestLettering(entries);
        const seen = new Set<string>();
        for (const s of suggestions) {
          for (const ref of s.lineRefs) {
            expect(seen.has(ref), msg).toBe(false);
            seen.add(ref);
          }
          const check = checkLettering({ entries, lineRefs: s.lineRefs });
          if (s.status === 'full') {
            expect(check.ok, msg).toBe(true);
            if (check.ok) {
              expect(check.documentTotal, msg).toBe('0.00');
              expect(check.bookDifference, msg).toBe(s.bookDifference);
            }
          } else {
            expect(check.ok ? 'OK' : check.code, msg).toBe('LETTERING_NOT_BALANCED');
            expect(s.remaining, msg).not.toBe('0.00');
          }
        }

        // Rejeu d'événements : lettrer les suggestions complètes, délettrer au hasard, relettrer sous un autre code
        // (rejeté tant que le premier lettrage est actif).
        const r = rng(seed * 104729);
        const events: LetteringEvent[] = [];
        const full = suggestions.filter((s) => s.status === 'full');
        full.forEach((s, i) => {
          events.push({
            code: `L${i}`,
            action: 'letter',
            lineRefs: s.lineRefs,
            at: `2026-04-${String((i % 28) + 1).padStart(2, '0')}`,
          });
          if (r() < 0.3) events.push({ code: `L${i}`, action: 'unletter', at: '2026-05-01' });
          if (r() < 0.3)
            events.push({
              code: `X${i}`,
              action: 'letter',
              lineRefs: s.lineRefs,
              at: '2026-05-02',
            });
        });
        const state = resolveLettering(events);
        const lineCodes = new Map<string, string>();
        for (const a of state.active) {
          for (const ref of a.lineRefs) {
            expect(lineCodes.has(ref), msg).toBe(false);
            lineCodes.set(ref, a.code);
          }
          const check = checkLettering({ entries, lineRefs: a.lineRefs });
          expect(check.ok, msg).toBe(true);
        }
        expect(Object.keys(state.byLine).length, msg).toBe(lineCodes.size);
        for (const [ref, code] of lineCodes) expect(state.byLine[ref], msg).toBe(code);
        // Plus rien de complet à suggérer pour les lignes lettrées.
        const again = suggestLettering(entries, new Set(Object.keys(state.byLine)));
        for (const s of again.suggestions)
          for (const ref of s.lineRefs) expect(state.byLine[ref], msg).toBeUndefined();
      }
    },
    HEAVY_TIMEOUT,
  );
});

describe('propriété : les à-nouveaux reportent exactement les soldes', () => {
  it(
    `${RUNS} exercices : écriture équilibrée, soldes de bilan reportés au centime, résultat exact`,
    () => {
      for (let seed = 1; seed <= RUNS; seed += 1) {
        const entries = [...randomBook(seed), ...randomReceivables(seed + 5000)];
        const msg = `graine ${seed}`;
        const detail = seed % 2 === 0;
        const opening = computeOpeningEntries({
          entries,
          bookCurrency: 'CDF',
          fiscalYearEnd: '2026-12-31',
          openingDate: '2027-01-01',
          journalCode: 'AN',
          chart,
          resultAccountNumber: seed % 3 === 0 ? null : '131',
          suspenseAccountNumber: 'ATT',
          detailThirdPartiesByDocument: detail,
        });
        expect(opening.balanced, msg).toBe(true);
        expect(opening.totals.debit, msg).toBe(opening.totals.credit);

        // Soldes attendus, recalculés indépendamment.
        const expected = new Map<string, { book: bigint; doc: bigint }>();
        let result = 0n;
        for (const e of entries) {
          if (e.status !== 'posted') continue;
          for (const l of e.lines) {
            const book = l.debit !== null ? cents(l.debit) : -cents(l.credit ?? '0');
            const doc = l.debit !== null ? cents(l.amount) : -cents(l.amount);
            if (/^(60|70)/.test(l.accountNumber)) {
              result += book;
              continue;
            }
            const key = `${l.accountNumber}|${l.auxiliaryAccountNumber ?? ''}|${l.currency}`;
            const x = expected.get(key) ?? { book: 0n, doc: 0n };
            x.book += book;
            x.doc += doc;
            expected.set(key, x);
          }
        }
        const resultLine = opening.lines.find((l) => l.label.startsWith('Résultat'));
        const carried = new Map<string, { book: bigint; doc: bigint }>();
        for (const l of opening.lines) {
          if (l === resultLine) continue;
          const key = `${l.accountNumber}|${l.auxiliaryAccountNumber ?? ''}|${l.currency}`;
          const x = carried.get(key) ?? { book: 0n, doc: 0n };
          x.book += l.debit !== null ? cents(l.debit) : -cents(l.credit ?? '0');
          x.doc += cents(l.amount);
          carried.set(key, x);
        }
        for (const [key, x] of expected) {
          const c = carried.get(key) ?? { book: 0n, doc: 0n };
          expect(c.book, `${msg} ${key} (tenue)`).toBe(x.book);
          const warned = opening.warnings.some(
            (w) =>
              w.code === 'DOCUMENT_BALANCE_WITHOUT_BOOK_BALANCE' &&
              key === `${w.accountNumber}|${w.auxiliaryAccountNumber ?? ''}|${w.currency}`,
          );
          if (!warned) expect(c.doc, `${msg} ${key} (devise)`).toBe(x.doc);
        }
        for (const key of carried.keys()) expect(expected.has(key), `${msg} ${key}`).toBe(true);
        expect(cents(opening.result.amount), msg).toBe(-result);
        if (result === 0n) expect(resultLine, msg).toBeUndefined();
        else expect(resultLine?.accountNumber, msg).toBe(seed % 3 === 0 ? 'ATT' : '131');
      }
    },
    HEAVY_TIMEOUT,
  );
});
