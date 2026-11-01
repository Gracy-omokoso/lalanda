// Échéances d'un échéancier ou d'un abonnement, et leur état (ADR-0050 § 2.4,
// § 5.3, § 7).
//
// - Récurrence : `occurrencesOf` du module `treasury` (ADR-0034 § 3), IMPORTÉ et
//   non recopié : même quantième, ramené au dernier jour du mois.
// - Rien au-delà des bornes facturables (`billableUntil` de `contractTerms` :
//   fin du terme constaté, ou date d'effet d'une résiliation).
// - `timing` ne change que le LIBELLÉ de période ; aucun montant, aucun prorata.

import { occurrencesOf } from '../treasury/recurrence.js';
import {
  addDays,
  anniversary,
  byString,
  checkDay,
  checkInt,
  compareDays,
  dayNumber,
  dayOfMonth,
  maxDay,
} from './common.js';
import {
  BILLING_FREQUENCIES,
  CONTRACTS_VERSION,
  type BillingBounds,
  type BillingFrequency,
  type BillingOccurrence,
  type BillingOccurrencesResult,
  type ContractBilling,
  type ContractDay,
  type ExcludedScheduleItem,
  type OccurrenceBlock,
  type OccurrenceBlockReason,
  type OccurrenceLink,
  type OccurrenceStatusEntry,
  type OccurrenceStatusOptions,
  type OccurrenceStatusResult,
} from './types.js';

const MONTH_STEP: Record<Exclude<BillingFrequency, 'weekly'>, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/** k-ième occurrence (k entier, éventuellement négatif) — identique à `nthOccurrence` pour k ≥ 0. */
export function nthBillingDate(
  frequency: BillingFrequency,
  anchorDate: ContractDay,
  k: number,
): ContractDay {
  if (frequency === 'weekly') return addDays(anchorDate, 7 * k);
  return anniversary(anchorDate, MONTH_STEP[frequency] * k, dayOfMonth(anchorDate));
}

/** Rang d'une occurrence déjà produite par `occurrencesOf`. */
function rankOf(frequency: BillingFrequency, anchorDate: ContractDay, date: ContractDay): number {
  if (frequency === 'weekly') return (dayNumber(date) - dayNumber(anchorDate)) / 7;
  const [ay, am] = anchorDate.split('-').map(Number) as [number, number];
  const [y, m] = date.split('-').map(Number) as [number, number];
  return (y * 12 + m - (ay * 12 + am)) / MONTH_STEP[frequency];
}

const scheduleKey = (itemRef: string): string => `item:${itemRef}`;

/**
 * Échéances dans la fenêtre fermée `[from, to]`, bornées par `bounds` (§ 2.4) :
 * triées par date puis clé, sans doublon, jamais au-delà de `bounds.endDate`.
 */
export function billingOccurrences(
  billing: ContractBilling,
  bounds: BillingBounds,
  from: ContractDay,
  to: ContractDay,
): BillingOccurrencesResult {
  checkDay(from, 'Fenêtre : début');
  checkDay(to, 'Fenêtre : fin');
  checkDay(bounds.startDate, 'Bornes : début');
  if (bounds.endDate !== null) checkDay(bounds.endDate, 'Bornes : fin');
  const empty: BillingOccurrencesResult = {
    version: CONTRACTS_VERSION,
    occurrences: [],
    excluded: [],
  };
  if (compareDays(from, to) > 0) return empty;

  const exceeds = (start: ContractDay, end: ContractDay): boolean =>
    compareDays(start, bounds.startDate) < 0 ||
    (bounds.endDate !== null && compareDays(end, bounds.endDate) > 0);

  switch (billing.kind) {
    case 'none':
      return empty;

    case 'schedule': {
      const refs = new Set<string>();
      const occurrences: BillingOccurrence[] = [];
      const excluded: ExcludedScheduleItem[] = [];
      for (const item of billing.items) {
        if (typeof item.itemRef !== 'string' || item.itemRef === '') {
          throw new RangeError('Échéance : `itemRef` requis');
        }
        if (refs.has(item.itemRef)) throw new RangeError(`Échéance ${item.itemRef} en double`);
        refs.add(item.itemRef);
        const date = checkDay(item.dueDate, `Échéance ${item.itemRef}`);
        if (compareDays(date, from) < 0 || compareDays(date, to) > 0) continue;
        if (compareDays(date, bounds.startDate) < 0) {
          excluded.push({ itemRef: item.itemRef, date, reason: 'BEFORE_START' });
        } else if (bounds.endDate !== null && compareDays(date, bounds.endDate) > 0) {
          excluded.push({ itemRef: item.itemRef, date, reason: 'AFTER_END' });
        } else {
          occurrences.push({
            key: scheduleKey(item.itemRef),
            kind: 'schedule_item',
            date,
            itemRef: item.itemRef,
            rank: null,
            periodStart: null,
            periodEnd: null,
            periodExceedsBounds: false,
          });
        }
      }
      occurrences.sort((a, b) => compareDays(a.date, b.date) || byString(a.key, b.key));
      excluded.sort((a, b) => compareDays(a.date, b.date) || byString(a.itemRef, b.itemRef));
      return { version: CONTRACTS_VERSION, occurrences, excluded };
    }

    case 'recurring': {
      const { frequency, anchorDate, timing } = billing;
      if (!(BILLING_FREQUENCIES as readonly string[]).includes(frequency)) {
        throw new RangeError(`Fréquence inconnue ${JSON.stringify(frequency)}`);
      }
      if (timing !== 'in_advance' && timing !== 'in_arrears') {
        throw new RangeError(`Échéance de période inconnue ${JSON.stringify(timing)}`);
      }
      checkDay(anchorDate, 'Date d’ancrage');
      const dates = occurrencesOf(
        { frequency, startDate: anchorDate, endDate: bounds.endDate },
        maxDay(from, bounds.startDate),
        to,
      );
      const occurrences = dates.map((date): BillingOccurrence => {
        const rank = rankOf(frequency, anchorDate, date);
        const periodStart =
          timing === 'in_advance'
            ? date
            : addDays(nthBillingDate(frequency, anchorDate, rank - 1), 1);
        const periodEnd =
          timing === 'in_advance'
            ? addDays(nthBillingDate(frequency, anchorDate, rank + 1), -1)
            : date;
        return {
          key: date,
          kind: 'subscription_occurrence',
          date,
          itemRef: null,
          rank,
          periodStart,
          periodEnd,
          periodExceedsBounds: exceeds(periodStart, periodEnd),
        };
      });
      return { version: CONTRACTS_VERSION, occurrences, excluded: [] };
    }
  }
}

function blockApplies(block: OccurrenceBlock, key: string, date: ContractDay): boolean {
  const hasKey = block.key !== undefined && block.key !== null;
  const hasFrom = block.fromDate !== undefined && block.fromDate !== null;
  if (hasKey && block.key !== key) return false;
  if (hasFrom && compareDays(date, block.fromDate as string) < 0) return false;
  return true;
}

/**
 * État de chaque échéance (§ 3, `GET …/schedule`) : `prepared` (lien vivant),
 * `blocked` (due, sans lien, au moins un blocage), `to_prepare` (due : date ≤
 * aujourd'hui + délai), `upcoming` sinon. Un lien orphelin est ignoré :
 * l'échéance redevient « à préparer ».
 */
export function occurrenceStatus(
  occurrences: readonly { key: string; date: ContractDay }[],
  links: readonly OccurrenceLink[],
  blocks: readonly OccurrenceBlock[],
  options: OccurrenceStatusOptions,
): OccurrenceStatusResult {
  const today = checkDay(options.today, 'Date du jour');
  const lead = checkInt(options.leadDays ?? 0, 0, 30, 'Délai de préparation');
  const horizon = dayNumber(addDays(today, lead));
  for (const b of blocks) {
    if (b.fromDate !== undefined && b.fromDate !== null) checkDay(b.fromDate, 'Blocage : date');
  }

  const keys = new Set<string>();
  for (const o of occurrences) {
    if (keys.has(o.key)) throw new RangeError(`Échéance ${o.key} en double`);
    keys.add(o.key);
    checkDay(o.date, `Échéance ${o.key}`);
  }

  const byKey = new Map<string, string[]>();
  for (const link of links) {
    if (link.orphan === true) continue;
    const list = byKey.get(link.key) ?? [];
    list.push(link.invoiceId);
    byKey.set(link.key, list);
  }

  const entries = occurrences.map((o): OccurrenceStatusEntry => {
    const linked = byKey.get(o.key);
    if (linked !== undefined && linked.length > 0) {
      const invoiceId = [...linked].sort(byString)[0] as string;
      return { key: o.key, date: o.date, state: 'prepared', invoiceId, reasons: [] };
    }
    if (dayNumber(o.date) > horizon) {
      return { key: o.key, date: o.date, state: 'upcoming', invoiceId: null, reasons: [] };
    }
    const reasons = [
      ...new Set(blocks.filter((b) => blockApplies(b, o.key, o.date)).map((b) => b.reason)),
    ].sort(byString) as OccurrenceBlockReason[];
    return {
      key: o.key,
      date: o.date,
      state: reasons.length > 0 ? 'blocked' : 'to_prepare',
      invoiceId: null,
      reasons,
    };
  });

  return {
    version: CONTRACTS_VERSION,
    entries,
    unknownLinks: [...byKey.keys()].filter((k) => !keys.has(k)).sort(byString),
    duplicateLinks: [...byKey.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([k]) => k)
      .sort(byString),
  };
}
