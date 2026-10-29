// ─────────────────────────────────────────────────────────────────────────────
// Rapports du CRM (ADR-0040 § 7.2). ADR-0040 — C3.
//
// Fonction PURE `crmReports`, sans horloge ni base : le jour de référence
// (`asOf`) et la période sont des paramètres, les dates sont des JOURS CIVILS de
// Kinshasa `AAAA-MM-JJ` déjà calculés par l'appelant. Montants en chaînes,
// additionnés en entiers `bigint` PAR DEVISE (`sumAmountsByCurrency`,
// `weightedForecast`), JAMAIS convertis d'une devise à l'autre.
//
// Tous les montants sont des ESTIMATIONS (`basis: 'estimated'`) : ni réalisé, ni
// plan. Rien ici n'alimente `actual_periods`, un plan ni un scénario.
//
// Seuil d'échantillon (ADR-0040 décision ouverte n° 11, ADR-0035 n° 3) : tout
// taux et toute durée moyenne sous `minSample` (défaut 10) est `unavailable`,
// avec l'échantillon et le minimum requis — jamais un chiffre tiré de trois cas.
// ─────────────────────────────────────────────────────────────────────────────

import { divRound } from '../invoice-totals/decimal.js';
import type { DecimalString } from '../invoice-totals/types.js';
import {
  weightedForecast,
  type CurrencyForecast,
  type ForecastProbability,
  type ForecastProbabilitySource,
} from './forecast.js';
import { CRM_INDICATORS_VERSION, sumAmountsByCurrency, type CurrencyTotal } from './index.js';

/** Période par défaut des rapports : 12 mois glissants (décision ouverte n° 12). */
export const CRM_REPORT_DEFAULT_MONTHS = 12;
/** Période la plus longue acceptée (`CRM_REPORT_PERIOD_TOO_LONG` au-delà). */
export const CRM_REPORT_MAX_MONTHS = 24;
/** Seuil d'échantillon des taux et des durées (décision ouverte n° 11). */
// Littéral (et non `DEFAULT_WIN_RATE_MIN_SAMPLE`) : `index.ts` importe ce fichier,
// une constante lue à l'évaluation du module serait encore indéfinie (cycle ESM).
export const CRM_REPORT_MIN_SAMPLE = 10;
/** Motifs de perte les plus fréquents rendus par responsable. */
export const CRM_REPORT_TOP_LOST_REASONS = 3;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Jour civil réel `AAAA-MM-JJ` (le 31 février est refusé). */
function isDay(value: string): boolean {
  const m = DAY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

function requireDay(value: string, what: string): void {
  if (!isDay(value))
    throw new RangeError(`${what} : jour AAAA-MM-JJ attendu, reçu ${JSON.stringify(value)}.`);
}

function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

function addDays(day: string, days: number): string {
  return new Date((dayNumber(day) + days) * 86_400_000).toISOString().slice(0, 10);
}

/** `day` décalé de `delta` mois ; le quantième est ramené à la fin d'un mois plus court. */
function addMonthsToDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  const month = index - year * 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d, last))).toISOString().slice(0, 10);
}

// ── Période ─────────────────────────────────────────────────────────────────

export type CrmReportPeriodResult =
  | { ok: true; from: string; to: string; months: { default: number; max: number } }
  | {
      ok: false;
      code: 'CRM_REPORT_PERIOD_INVALID' | 'CRM_REPORT_PERIOD_TOO_LONG';
      message: string;
    };

/**
 * Période `[from, to]` (jours inclus) d'un rapport. `to` : par défaut `today` ;
 * `from` : par défaut 12 mois glissants avant `to` (le lendemain du même
 * quantième, douze mois plus tôt). Au plus 24 mois.
 */
export function crmReportPeriod(input: {
  today: string;
  from?: string | null;
  to?: string | null;
}): CrmReportPeriodResult {
  requireDay(input.today, 'Jour de référence');
  const to = input.to ?? input.today;
  if (!isDay(to)) {
    return { ok: false, code: 'CRM_REPORT_PERIOD_INVALID', message: 'Fin de période invalide.' };
  }
  const from = input.from ?? addDays(addMonthsToDay(to, -CRM_REPORT_DEFAULT_MONTHS), 1);
  if (!isDay(from)) {
    return { ok: false, code: 'CRM_REPORT_PERIOD_INVALID', message: 'Début de période invalide.' };
  }
  if (from > to) {
    return {
      ok: false,
      code: 'CRM_REPORT_PERIOD_INVALID',
      message: 'Le début de la période doit précéder sa fin.',
    };
  }
  if (from < addDays(addMonthsToDay(to, -CRM_REPORT_MAX_MONTHS), 1)) {
    return {
      ok: false,
      code: 'CRM_REPORT_PERIOD_TOO_LONG',
      message: `Période de ${CRM_REPORT_MAX_MONTHS} mois au plus.`,
    };
  }
  return {
    ok: true,
    from,
    to,
    months: { default: CRM_REPORT_DEFAULT_MONTHS, max: CRM_REPORT_MAX_MONTHS },
  };
}

// ── Entrées et sorties ──────────────────────────────────────────────────────

export interface ReportStage {
  key: string;
  kind: 'open' | 'won' | 'lost';
}

export interface ReportOpportunity {
  id: string;
  /** Étape courante. */
  stageKey: string;
  status: 'open' | 'won' | 'lost';
  /** Montant ESTIMÉ, décimal à 2 décimales au plus, ou `null`. */
  amount: DecimalString | null;
  currency: string;
  /** Jour de création (Kinshasa). */
  createdDay: string;
  /** Jour de clôture (Kinshasa) ; `null` si ouverte. Pour une gagnée : jour du gain. */
  closedDay: string | null;
  /** Date de clôture prévue `AAAA-MM-JJ`, ou `null`. */
  expectedCloseDate: string | null;
  ownerId: string | null;
  lostReasonKey: string | null;
  /** Étapes par lesquelles l'opportunité est passée (`stageHistory`, doublons admis). */
  stagesVisited: readonly string[];
}

export type ReportRate =
  | {
      status: 'available';
      /** Pourcentage entier, arrondi au plus proche (demi vers le haut). */
      ratePercent: string;
      sample: number;
      count: number;
    }
  | { status: 'unavailable'; sample: number; count: number; requiredSample: number };

export type ReportDuration =
  | {
      status: 'available';
      /** Jours civils, moyenne arrondie au jour (demi vers le haut). */
      meanDays: number;
      /** Médiane, arrondie au jour (demi vers le haut) pour un nombre pair. */
      medianDays: number;
      sample: number;
    }
  | { status: 'unavailable'; sample: number; requiredSample: number };

export interface ReportCountAndAmounts {
  count: number;
  /** Montants estimés par devise (sans conversion). */
  amounts: CurrencyTotal[];
}

export interface FunnelStage extends ReportCountAndAmounts {
  stageKey: string;
}

export interface StageConversion {
  fromStageKey: string;
  /** Étape suivante dans l'ordre (ouverte, sinon l'étape gagnée). */
  toStageKey: string | null;
  /** Part des opportunités passées par l'étape qui ont atteint une étape ultérieure. */
  rate: ReportRate;
}

export interface LostReasonCount {
  /** `null` : perdue sans motif. */
  lostReasonKey: string | null;
  count: number;
}

export interface OwnerResult {
  ownerId: string | null;
  /** Ouvertes AUJOURD'HUI (hors période). */
  open: ReportCountAndAmounts;
  /** Gagnées, puis perdues, clôturées dans la période. */
  won: ReportCountAndAmounts;
  lost: ReportCountAndAmounts;
  /** Gagnées / clôturées dans la période. */
  winRate: ReportRate;
  /** Prévision pondérée de ses opportunités ouvertes, par devise. */
  forecast: CurrencyForecast[];
  topLostReasons: LostReasonCount[];
}

export type ForecastBucketKind = 'overdue' | 'month' | 'no_date';

export interface ForecastBucket {
  kind: ForecastBucketKind;
  /** `AAAA-MM` pour `month`, sinon `null`. */
  month: string | null;
  count: number;
  currencies: CurrencyForecast[];
}

export interface CrmReports {
  version: string;
  basis: 'estimated';
  period: { from: string; to: string };
  asOf: string;
  /** Filtre responsable appliqué à TOUS les blocs ; `null` : toute l'organisation. */
  ownerId: string | null;
  minSample: number;
  funnel: { created: number; stages: FunnelStage[] };
  conversion: { stages: StageConversion[]; overall: ReportRate };
  cycle: { won: ReportDuration; lost: ReportDuration };
  byOwner: OwnerResult[];
  forecastByMonth: { probabilitySource: ForecastProbabilitySource; buckets: ForecastBucket[] };
  lostReasons: { total: number; reasons: LostReasonCount[] };
}

// ── Calculs ─────────────────────────────────────────────────────────────────

function rateOf(count: number, sample: number, minSample: number): ReportRate {
  return sample < minSample
    ? { status: 'unavailable', sample, count, requiredSample: minSample }
    : {
        status: 'available',
        ratePercent: divRound(BigInt(count) * 100n, BigInt(sample), 'half_up').toString(),
        sample,
        count,
      };
}

function durationOf(days: readonly number[], minSample: number): ReportDuration {
  const sample = days.length;
  if (sample < minSample || sample === 0) {
    return { status: 'unavailable', sample, requiredSample: minSample };
  }
  const sorted = [...days].sort((a, b) => a - b);
  const sum = sorted.reduce((s, d) => s + BigInt(d), 0n);
  const mid = Math.floor(sample / 2);
  const median =
    sample % 2 === 1
      ? sorted[mid]!
      : Number(divRound(BigInt(sorted[mid - 1]!) + BigInt(sorted[mid]!), 2n, 'half_up'));
  return {
    status: 'available',
    meanDays: Number(divRound(sum, BigInt(sample), 'half_up')),
    medianDays: median,
    sample,
  };
}

function countAndAmounts(items: readonly ReportOpportunity[]): ReportCountAndAmounts {
  return {
    count: items.length,
    amounts: sumAmountsByCurrency(items.map((o) => ({ amount: o.amount, currency: o.currency }))),
  };
}

function lostReasonCounts(lost: readonly ReportOpportunity[]): LostReasonCount[] {
  const counts = new Map<string | null, number>();
  for (const o of lost) counts.set(o.lostReasonKey, (counts.get(o.lostReasonKey) ?? 0) + 1);
  return [...counts.entries()]
    .map(([lostReasonKey, count]) => ({ lostReasonKey, count }))
    .sort((a, b) =>
      b.count !== a.count
        ? b.count - a.count
        : a.lostReasonKey === b.lostReasonKey
          ? 0
          : a.lostReasonKey === null
            ? 1
            : b.lostReasonKey === null
              ? -1
              : a.lostReasonKey < b.lostReasonKey
                ? -1
                : 1,
    );
}

/**
 * Rapports du CRM (ADR-0040 § 7.2). Les opportunités passées couvrent au moins :
 * celles créées dans la période, celles clôturées dans la période et toutes les
 * ouvertes ; le moteur choisit lui-même la population de chaque bloc. Les
 * probabilités d'étape (prévision) sont fournies par l'appelant, comme pour le
 * pipeline (`stageWinRates` sur l'historique de l'organisation).
 */
export function crmReports(input: {
  period: { from: string; to: string };
  /** Jour de référence (Kinshasa) : « en retard » = date prévue antérieure. */
  asOf: string;
  stages: readonly ReportStage[];
  opportunities: readonly ReportOpportunity[];
  probabilities: Readonly<Record<string, ForecastProbability>>;
  probabilitySource: ForecastProbabilitySource;
  /** Filtre responsable ; `undefined` ou `null` : toute l'organisation. */
  ownerId?: string | null;
  minSample?: number;
}): CrmReports {
  const { from, to } = input.period;
  requireDay(from, 'Début de période');
  requireDay(to, 'Fin de période');
  requireDay(input.asOf, 'Jour de référence');
  if (from > to) throw new RangeError('Le début de la période doit précéder sa fin.');
  const minSample = input.minSample ?? CRM_REPORT_MIN_SAMPLE;
  if (!Number.isInteger(minSample) || minSample < 1) {
    throw new RangeError('Échantillon minimal : un entier strictement positif.');
  }
  const ownerId = input.ownerId ?? null;
  const all =
    ownerId === null
      ? input.opportunities
      : input.opportunities.filter((o) => o.ownerId === ownerId);
  for (const o of all) {
    requireDay(o.createdDay, `Création de ${o.id}`);
    if (o.closedDay !== null) requireDay(o.closedDay, `Clôture de ${o.id}`);
  }

  const inPeriod = (day: string | null): boolean => day !== null && day >= from && day <= to;
  const created = all.filter((o) => inPeriod(o.createdDay));
  const closed = all.filter((o) => o.status !== 'open' && inPeriod(o.closedDay));
  const won = closed.filter((o) => o.status === 'won');
  const lost = closed.filter((o) => o.status === 'lost');
  const open = all.filter((o) => o.status === 'open');

  // Entonnoir et conversion par étape : cohorte des opportunités CRÉÉES dans la période.
  const openStages = input.stages.filter((s) => s.kind === 'open').map((s) => s.key);
  const wonStage = input.stages.find((s) => s.kind === 'won')?.key ?? null;
  const progression = [...openStages, ...(wonStage === null ? [] : [wonStage])];
  const rank = new Map(progression.map((k, i) => [k, i]));
  const visited = new Map(created.map((o) => [o.id, new Set(o.stagesVisited)]));
  const furthest = new Map(
    created.map((o) => {
      let max = -1;
      for (const k of visited.get(o.id)!) max = Math.max(max, rank.get(k) ?? -1);
      // Une gagnée a atteint l'étape gagnée, même si l'historique l'omet.
      if (o.status === 'won' && wonStage !== null) max = Math.max(max, rank.get(wonStage)!);
      return [o.id, max];
    }),
  );
  const passedBy = (key: string) => created.filter((o) => visited.get(o.id)!.has(key));

  const funnelStages: FunnelStage[] = openStages.map((key) => ({
    stageKey: key,
    ...countAndAmounts(passedBy(key)),
  }));
  const conversionStages: StageConversion[] = openStages.map((key, i) => {
    const passed = passedBy(key);
    const reached = passed.filter((o) => furthest.get(o.id)! > i).length;
    return {
      fromStageKey: key,
      toStageKey: progression[i + 1] ?? null,
      rate: rateOf(reached, passed.length, minSample),
    };
  });

  // Durée du cycle : jours civils entre création et clôture, gagnées et perdues à part.
  const cycleDays = (items: readonly ReportOpportunity[]) =>
    items.map((o) => Math.max(0, dayNumber(o.closedDay!) - dayNumber(o.createdDay)));

  // Prévision : opportunités ouvertes, regroupées par mois de clôture prévue.
  const forecastOf = (items: readonly ReportOpportunity[]) =>
    weightedForecast({
      opportunities: items.map((o) => ({
        id: o.id,
        stageKey: o.stageKey,
        amount: o.amount,
        currency: o.currency,
        expectedCloseDate: o.expectedCloseDate,
        ownerId: o.ownerId,
      })),
      probabilities: input.probabilities,
      probabilitySource: input.probabilitySource,
    }).currencies;

  const overdue: ReportOpportunity[] = [];
  const noDate: ReportOpportunity[] = [];
  const byMonth = new Map<string, ReportOpportunity[]>();
  for (const o of open) {
    const date = o.expectedCloseDate;
    if (date === null || !isDay(date)) noDate.push(o);
    else if (date < input.asOf) overdue.push(o);
    else {
      const month = date.slice(0, 7);
      byMonth.set(month, [...(byMonth.get(month) ?? []), o]);
    }
  }
  const buckets: ForecastBucket[] = [];
  if (overdue.length > 0) {
    buckets.push({
      kind: 'overdue',
      month: null,
      count: overdue.length,
      currencies: forecastOf(overdue),
    });
  }
  for (const month of [...byMonth.keys()].sort()) {
    const items = byMonth.get(month)!;
    buckets.push({ kind: 'month', month, count: items.length, currencies: forecastOf(items) });
  }
  if (noDate.length > 0) {
    buckets.push({
      kind: 'no_date',
      month: null,
      count: noDate.length,
      currencies: forecastOf(noDate),
    });
  }

  // Résultats par responsable.
  const owners = new Set<string | null>([...open, ...closed].map((o) => o.ownerId));
  const byOwner: OwnerResult[] = [...owners]
    .sort((a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1))
    .map((owner) => {
      const mine = (items: readonly ReportOpportunity[]) =>
        items.filter((o) => o.ownerId === owner);
      const w = mine(won);
      const l = mine(lost);
      const o = mine(open);
      return {
        ownerId: owner,
        open: countAndAmounts(o),
        won: countAndAmounts(w),
        lost: countAndAmounts(l),
        winRate: rateOf(w.length, w.length + l.length, minSample),
        forecast: forecastOf(o),
        topLostReasons: lostReasonCounts(l).slice(0, CRM_REPORT_TOP_LOST_REASONS),
      };
    });

  return {
    version: CRM_INDICATORS_VERSION,
    basis: 'estimated',
    period: { from, to },
    asOf: input.asOf,
    ownerId,
    minSample,
    funnel: { created: created.length, stages: funnelStages },
    conversion: {
      stages: conversionStages,
      overall: rateOf(won.length, closed.length, minSample),
    },
    cycle: {
      won: durationOf(cycleDays(won), minSample),
      lost: durationOf(cycleDays(lost), minSample),
    },
    byOwner,
    forecastByMonth: { probabilitySource: input.probabilitySource, buckets },
    lostReasons: { total: lost.length, reasons: lostReasonCounts(lost) },
  };
}
