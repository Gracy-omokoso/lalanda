// Propriétés du moteur des contrats (ADR-0050 § 7, Plan de validation, lot V1).
// Générateur pseudo-aléatoire à GRAINE FIXE : un échec est rejouable à
// l'identique (la graine et le rang figurent dans le message). Délai explicite
// de 120 s par propriété.

import { describe, expect, it } from 'vitest';

import { addDays, dayNumber } from '../treasury/calendar.js';
import { nthOccurrence } from '../treasury/recurrence.js';
import {
  billingOccurrences,
  contractTerms,
  nthBillingDate,
  noticeCheck,
  occurrenceStatus,
  orderInvoicing,
  type BillingFrequency,
  type ContractInput,
  type LinkedInvoiceInput,
  type OrderLineInput,
  type RecordedRenewal,
} from './index.js';

const TIMEOUT = 120_000;
const RUNS = 400;
const SEED = 0x50_0050;

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
const FREQUENCIES: readonly BillingFrequency[] = ['weekly', 'monthly', 'quarterly', 'yearly'];

/** Jour au hasard entre 2024 et 2031, avec une forte part de fins de mois et de 29 février. */
function randomDay(r: () => number): string {
  const year = int(r, 2024, 2031);
  const month = int(r, 1, 12);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = r() < 0.4 ? last - int(r, 0, 2) : int(r, 1, last);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const milli = (q: string): bigint => {
  const [i = '0', f = ''] = q.split('.');
  return BigInt(i) * 1000n + BigInt(f.padEnd(3, '0') || '0');
};
const qty = (m: bigint): string => {
  const f = (m % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${m / 1000n}${f === '' ? '' : `.${f}`}`;
};

describe('propriétés — occurrences d’échéancier', () => {
  it(
    'abonnement : égal à l’énumération naïve, sans trou ni doublon, rien hors des bornes',
    () => {
      const r = rng(SEED);
      for (let run = 0; run < RUNS; run += 1) {
        const frequency = pick(r, FREQUENCIES);
        const anchorDate = randomDay(r);
        const startDate = addDays(anchorDate, int(r, -40, 200));
        const endDate = r() < 0.2 ? null : addDays(startDate, int(r, 0, 1500));
        const from = addDays(startDate, int(r, -100, 400));
        const to = addDays(from, int(r, -5, 900));
        const ctx = `graine ${SEED}, rang ${run}`;
        const result = billingOccurrences(
          {
            kind: 'recurring',
            frequency,
            anchorDate,
            timing: r() < 0.5 ? 'in_advance' : 'in_arrears',
            autoPrepare: true,
          },
          { startDate, endDate },
          from,
          to,
        );
        const dates = result.occurrences.map((o) => o.date);

        // Énumération naïve : nthOccurrence de rang 0, 1, 2… filtrée.
        const lo = Math.max(dayNumber(from), dayNumber(startDate));
        let hi = dayNumber(to);
        if (endDate !== null) hi = Math.min(hi, dayNumber(endDate));
        const naive: string[] = [];
        for (let k = 0; ; k += 1) {
          const d = nthOccurrence({ frequency, startDate: anchorDate, endDate: null }, k);
          if (dayNumber(d) > hi) break;
          if (dayNumber(d) >= lo) naive.push(d);
        }
        expect(dates, ctx).toEqual(naive);

        // Pas de doublon, ordre strict, rangs consécutifs (pas de trou).
        for (let i = 1; i < result.occurrences.length; i += 1) {
          const prev = result.occurrences[i - 1]!;
          const cur = result.occurrences[i]!;
          expect(dayNumber(cur.date) > dayNumber(prev.date), ctx).toBe(true);
          expect(cur.rank, ctx).toBe((prev.rank ?? NaN) + 1);
        }
        for (const o of result.occurrences) {
          expect(dayNumber(o.date) >= dayNumber(startDate), ctx).toBe(true);
          if (endDate !== null) expect(dayNumber(o.date) <= dayNumber(endDate), ctx).toBe(true);
          expect(nthBillingDate(frequency, anchorDate, o.rank!), ctx).toBe(o.date);
          // Les périodes libellées se touchent : ni trou ni chevauchement.
          expect(dayNumber(o.periodStart!) <= dayNumber(o.periodEnd!), ctx).toBe(true);
        }
        for (let i = 1; i < result.occurrences.length; i += 1) {
          expect(result.occurrences[i]!.periodStart, ctx).toBe(
            addDays(result.occurrences[i - 1]!.periodEnd!, 1),
          );
        }

        // Découper la fenêtre en deux ne perd ni ne double aucune échéance.
        if (dayNumber(from) <= dayNumber(to)) {
          const mid = addDays(from, int(r, 0, dayNumber(to) - dayNumber(from)));
          const left = billingOccurrences(
            { kind: 'recurring', frequency, anchorDate, timing: 'in_advance', autoPrepare: true },
            { startDate, endDate },
            from,
            mid,
          ).occurrences.map((o) => o.date);
          const right = billingOccurrences(
            { kind: 'recurring', frequency, anchorDate, timing: 'in_advance', autoPrepare: true },
            { startDate, endDate },
            addDays(mid, 1),
            to,
          ).occurrences.map((o) => o.date);
          expect([...left, ...right], ctx).toEqual(dates);
        }
      }
    },
    TIMEOUT,
  );

  it(
    'nthBillingDate prolonge nthOccurrence (rangs ≥ 0) et reste monotone pour les rangs négatifs',
    () => {
      const r = rng(SEED + 1);
      for (let run = 0; run < RUNS; run += 1) {
        const frequency = pick(r, FREQUENCIES);
        const anchorDate = randomDay(r);
        const k = int(r, 0, 60);
        expect(nthBillingDate(frequency, anchorDate, k)).toBe(
          nthOccurrence({ frequency, startDate: anchorDate, endDate: null }, k),
        );
        const neg = -int(r, 1, 30);
        expect(
          dayNumber(nthBillingDate(frequency, anchorDate, neg)) <
            dayNumber(nthBillingDate(frequency, anchorDate, neg + 1)),
        ).toBe(true);
      }
    },
    TIMEOUT,
  );

  it(
    'échéancier : chaque échéance de la fenêtre apparaît une seule fois, rien au-delà du terme',
    () => {
      const r = rng(SEED + 2);
      for (let run = 0; run < RUNS; run += 1) {
        const startDate = randomDay(r);
        const endDate = r() < 0.2 ? null : addDays(startDate, int(r, 0, 700));
        const items = Array.from({ length: int(r, 0, 25) }, (_, i) => ({
          itemRef: `i${i}`,
          dueDate: addDays(startDate, int(r, -100, 900)),
        }));
        const from = addDays(startDate, int(r, -150, 300));
        const to = addDays(from, int(r, 0, 900));
        const ctx = `graine ${SEED + 2}, rang ${run}`;
        const res = billingOccurrences(
          { kind: 'schedule', items },
          { startDate, endDate },
          from,
          to,
        );
        const seen = [
          ...res.occurrences.map((o) => o.itemRef!),
          ...res.excluded.map((e) => e.itemRef),
        ];
        expect(new Set(seen).size, ctx).toBe(seen.length);
        const inWindow = items.filter(
          (i) => dayNumber(i.dueDate) >= dayNumber(from) && dayNumber(i.dueDate) <= dayNumber(to),
        );
        expect(seen.length, ctx).toBe(inWindow.length);
        for (const o of res.occurrences) {
          expect(dayNumber(o.date) >= dayNumber(startDate), ctx).toBe(true);
          if (endDate !== null) expect(dayNumber(o.date) <= dayNumber(endDate), ctx).toBe(true);
        }
        for (let i = 1; i < res.occurrences.length; i += 1) {
          expect(
            dayNumber(res.occurrences[i]!.date) >= dayNumber(res.occurrences[i - 1]!.date),
            ctx,
          ).toBe(true);
        }
      }
    },
    TIMEOUT,
  );

  it(
    'reconduction tacite : termes contigus, jamais facturé au-delà du terme constaté, maxRenewals respecté',
    () => {
      const r = rng(SEED + 3);
      for (let run = 0; run < RUNS / 2; run += 1) {
        const startDate = randomDay(r);
        const maxRenewals = r() < 0.5 ? null : int(r, 0, 4);
        const contract: ContractInput = {
          startDate,
          status: 'signed',
          lines: [],
          billing: { kind: 'none' },
          initialTermMonths: int(r, 1, 36),
          renewal: { mode: 'tacit', periodMonths: int(r, 1, 24), maxRenewals },
          noticeDays: int(r, 0, 120),
          clauses: null,
        };
        const frequency = pick(r, FREQUENCIES);
        const ctx = `graine ${SEED + 3}, rang ${run}`;
        const renewals: RecordedRenewal[] = [];
        const steps = int(r, 0, 6);
        for (let step = 0; step <= steps; step += 1) {
          // Un jour bien après la fin du dernier terme : la proposition reste une proposition.
          const res0 = contractTerms(contract, [], renewals, null, startDate);
          const today = addDays(res0.lastTermEnd!, int(r, 1, 400));
          const res = contractTerms(contract, [], renewals, null, today);
          expect(res.issues, ctx).toEqual([]);
          expect(res.billableUntil, ctx).toBe(res.lastTermEnd);
          expect(res.termElapsed, ctx).toBe(true);
          // Termes contigus, chacun non vide.
          for (let i = 0; i < res.terms.length; i += 1) {
            const t = res.terms[i]!;
            expect(dayNumber(t.to!) >= dayNumber(t.from), ctx).toBe(true);
            if (i > 0) expect(t.from, ctx).toBe(addDays(res.terms[i - 1]!.to!, 1));
          }
          // Date limite = fin − préavis ; notifier ce jour-là respecte la clause saisie.
          expect(res.noticeDeadline, ctx).toBe(addDays(res.currentTerm.to!, -contract.noticeDays));
          expect(
            noticeCheck(res.noticeDeadline!, res.currentTerm.to!, contract.noticeDays).result,
            ctx,
          ).toBe('meets_clause');
          // Aucune échéance au-delà du terme constaté, même si la reconduction est due.
          const occ = billingOccurrences(
            {
              kind: 'recurring',
              frequency,
              anchorDate: startDate,
              timing: 'in_advance',
              autoPrepare: true,
            },
            { startDate, endDate: res.billableUntil },
            startDate,
            addDays(today, 800),
          );
          for (const o of occ.occurrences) {
            expect(dayNumber(o.date) <= dayNumber(res.lastTermEnd!), ctx).toBe(true);
          }
          if (maxRenewals !== null && renewals.length >= maxRenewals) {
            expect(res.proposedNextTerm, ctx).toBeNull();
            expect(res.status, ctx).toBe('ended');
            break;
          }
          const next = res.proposedNextTerm;
          expect(next, ctx).not.toBeNull();
          expect(res.status, ctx).toBe('expiring');
          expect(next!.from, ctx).toBe(addDays(res.lastTermEnd!, 1));
          renewals.push({
            termIndex: next!.index,
            from: next!.from,
            to: next!.to!,
            mode: 'tacit_recorded',
          });
        }
      }
    },
    TIMEOUT,
  );

  it(
    'occurrenceStatus : un état par échéance ; préparée si et seulement si un lien vivant existe',
    () => {
      const r = rng(SEED + 4);
      for (let run = 0; run < RUNS; run += 1) {
        const anchor = randomDay(r);
        const occ = billingOccurrences(
          {
            kind: 'recurring',
            frequency: pick(r, FREQUENCIES),
            anchorDate: anchor,
            timing: 'in_advance',
            autoPrepare: true,
          },
          { startDate: anchor, endDate: null },
          anchor,
          addDays(anchor, 400),
        ).occurrences;
        const links = occ
          .filter(() => r() < 0.4)
          .map((o, i) => ({ key: o.key, invoiceId: `inv${i}`, orphan: r() < 0.3 }));
        const today = addDays(anchor, int(r, -30, 450));
        const res = occurrenceStatus(
          occ,
          links,
          r() < 0.5
            ? []
            : [{ reason: 'AMENDMENT_PENDING', fromDate: addDays(anchor, int(r, 0, 400)) }],
          { today, leadDays: int(r, 0, 30) },
        );
        const ctx = `graine ${SEED + 4}, rang ${run}`;
        expect(
          res.entries.map((e) => e.key),
          ctx,
        ).toEqual(occ.map((o) => o.key));
        const alive = new Set(links.filter((l) => !l.orphan).map((l) => l.key));
        for (const e of res.entries) {
          expect(e.state === 'prepared', ctx).toBe(alive.has(e.key));
          expect(e.reasons.length > 0, ctx).toBe(e.state === 'blocked');
        }
      }
    },
    TIMEOUT,
  );
});

describe('propriétés — reste à facturer', () => {
  it(
    'jamais négatif, égal à commandé − émis apparié (borné à 0), indépendant de l’ordre des factures',
    () => {
      const r = rng(SEED + 5);
      for (let run = 0; run < RUNS; run += 1) {
        const lines: OrderLineInput[] = Array.from({ length: int(r, 1, 5) }, (_, i) => ({
          lineRef: `L${i}`,
          catalogItemId: r() < 0.3 ? null : `item${i}`,
          unitPrice: `${int(r, 1, 500)}.${String(int(r, 0, 99)).padStart(2, '0')}`,
          quantity: qty(BigInt(int(r, 1, 20_000))),
        }));
        const expectedIssued = new Map<string, bigint>();
        const expectedDraft = new Map<string, bigint>();
        const invoices: LinkedInvoiceInput[] = Array.from({ length: int(r, 0, 6) }, (_, n) => {
          const state = r() < 0.6 ? ('issued' as const) : ('draft' as const);
          const chosen = lines.filter(() => r() < 0.6);
          const invLines = chosen.map((l, index) => {
            const mismatch = r() < 0.15;
            const q = BigInt(int(r, 1, 15_000));
            if (!mismatch) {
              const target = state === 'issued' ? expectedIssued : expectedDraft;
              target.set(l.lineRef, (target.get(l.lineRef) ?? 0n) + q);
            }
            return {
              index,
              catalogItemId: mismatch ? 'other' : l.catalogItemId,
              unitPrice: l.unitPrice,
              quantity: qty(q),
            };
          });
          return {
            invoiceId: `f${n}`,
            state,
            lines: invLines,
            lineMap: chosen.map((l, index) => ({
              invoiceLineIndex: index,
              lineRef: l.lineRef,
              quantity: '1',
            })),
          };
        });
        const ctx = `graine ${SEED + 5}, rang ${run}`;
        const res = orderInvoicing(lines, invoices);
        const shuffled = [...invoices].sort(() => (r() < 0.5 ? -1 : 1));
        expect(orderInvoicing(lines, shuffled).lines, ctx).toEqual(res.lines);
        let allDone = true;
        let anyIssued = false;
        for (const [i, line] of res.lines.entries()) {
          const ordered = milli(lines[i]!.quantity);
          const done = expectedIssued.get(line.lineRef) ?? 0n;
          const draft = expectedDraft.get(line.lineRef) ?? 0n;
          const rest = ordered > done ? ordered - done : 0n;
          expect(line.remainingToInvoice.startsWith('-'), ctx).toBe(false);
          expect(line.remainingToPrepare.startsWith('-'), ctx).toBe(false);
          expect(milli(line.invoiced), ctx).toBe(done);
          expect(milli(line.remainingToInvoice), ctx).toBe(rest);
          expect(milli(line.remainingToPrepare), ctx).toBe(rest > draft ? rest - draft : 0n);
          expect(milli(line.overInvoiced), ctx).toBe(done > ordered ? done - ordered : 0n);
          if (rest > 0n) allDone = false;
          if (done > 0n) anyIssued = true;
        }
        expect(res.status, ctx).toBe(
          allDone ? 'invoiced' : anyIssued ? 'partially_invoiced' : 'not_invoiced',
        );
      }
    },
    TIMEOUT,
  );
});

describe('propriétés — préavis', () => {
  it(
    'conforme à la clause si et seulement si la notification précède ou égale la date limite',
    () => {
      const r = rng(SEED + 6);
      for (let run = 0; run < RUNS * 2; run += 1) {
        const effectiveOn = randomDay(r);
        const noticeGivenOn = addDays(effectiveOn, -int(r, -30, 400));
        const noticeDays = int(r, 0, 365);
        const res = noticeCheck(noticeGivenOn, effectiveOn, noticeDays);
        const ctx = `graine ${SEED + 6}, rang ${run}`;
        expect(res.daysGiven, ctx).toBe(dayNumber(effectiveOn) - dayNumber(noticeGivenOn));
        expect(res.latestNoticeDate, ctx).toBe(addDays(effectiveOn, -noticeDays));
        expect(res.result === 'meets_clause', ctx).toBe(
          dayNumber(noticeGivenOn) <= dayNumber(res.latestNoticeDate),
        );
      }
    },
    TIMEOUT,
  );
});
