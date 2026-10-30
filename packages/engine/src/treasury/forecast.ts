// Prévision de trésorerie 7 / 30 / 90 / 180 jours (ADR-0034 § 7).
//
// Une devise à la fois, aucune conversion. Jour 0 = date du jour (`asOf`) : son
// solde est une OBSERVATION (somme des soldes des comptes) ; les jours 1 à 180
// sont des ESTIMATIONS, construites à partir de trois sources de flux :
//
//   1. échéances clients : reste à encaisser × taux d'encaissement, à la date
//      d'échéance (ou émission + délai supposé) + retard du scénario, au plus tôt J+1 ;
//   2. dépenses récurrentes : occurrences non confirmées × facteur, les
//      occurrences en retard (≤ J, 90 jours au plus) comptées à J+1 ;
//   3. plan BUILD (facultatif) : rythme journalier (mensuel × 12 ÷ 365) des
//      lignes de produit × taux de réalisation et des lignes de charge × facteur,
//      une ligne de charge visée par une catégorie récurrente étant diminuée de
//      l'équivalent mensuel de ces récurrences (jamais sous zéro) ;
//   4. échéances fournisseurs (1.1.0, ADR-0044 § 6.3) : reste à payer de chaque
//      facture validée non en litige, à son échéance (passée ou du jour : J+1),
//      dans TOUS les scénarios (le plus prudent : la sortie la plus tôt). Les
//      litiges sont exclus et comptés en incertitude ; les commandes non
//      facturées sont signalées, jamais prévues. Sans `payables`, les sorties
//      sont celles de 1.0.0 (la source `payable` vaut zéro).
//
// Chaque hypothèse est un paramètre du scénario, rendu avec le résultat.

import { computeAccountBalances } from './balances.js';
import { addDays, dayNumber } from './calendar.js';
import {
  applyRate,
  centsOf,
  centsOfPlanNumber,
  divHalfUp,
  formatCents,
  trustedCents,
} from './money.js';
import { monthlyEquivalentCents, occurrencesOf } from './recurrence.js';
import {
  FORECAST_DAYS,
  FORECAST_HORIZONS,
  FORECAST_SCENARIOS,
  TREASURY_VERSION,
  type CalendarDay,
  type ForecastAlert,
  type ForecastFinding,
  type ForecastFlow,
  type ForecastFlowSource,
  type ForecastHorizon,
  type ForecastHorizonSummary,
  type ForecastScenario,
  type ForecastScenarioId,
  type ScenarioHypotheses,
  type TreasuryForecast,
  type TreasuryForecastInput,
} from './types.js';

/** Profondeur maximale des occurrences récurrentes en retard reprises (jours). */
export const OVERDUE_RECURRING_LOOKBACK_DAYS = 90;

/**
 * Valeurs par défaut PROPOSÉES (ADR-0034 § 7, décision ouverte n° 4) — à valider
 * par la dirigeante. Elles sont monotones : l'optimiste encaisse plus, plus tôt,
 * et dépense moins que le probable, lui-même au-dessus du pessimiste.
 */
export const DEFAULT_SCENARIO_HYPOTHESES: Readonly<Record<ForecastScenarioId, ScenarioHypotheses>> =
  {
    optimistic: {
      receivableCollectionRate: 1,
      receivableDelayDays: 0,
      noDueDateDays: 30,
      recurringFactor: 1,
      planRevenueRate: 1,
      planChargesRate: 1,
    },
    probable: {
      receivableCollectionRate: 0.9,
      receivableDelayDays: 15,
      noDueDateDays: 30,
      recurringFactor: 1,
      planRevenueRate: 0.8,
      planChargesRate: 1,
    },
    pessimistic: {
      receivableCollectionRate: 0.7,
      receivableDelayDays: 45,
      noDueDateDays: 30,
      recurringFactor: 1.1,
      planRevenueRate: 0.6,
      planChargesRate: 1.1,
    },
  };

/** Bornes de validation d'une hypothèse (taux en fraction, délais en jours). */
export const SCENARIO_BOUNDS = {
  rate: { min: 0, max: 2 },
  days: { min: 0, max: 365 },
} as const;

/** Vrai si toutes les hypothèses sont des nombres finis dans leurs bornes. */
export function isValidScenarioHypotheses(h: ScenarioHypotheses): boolean {
  const rates = [
    h.receivableCollectionRate,
    h.recurringFactor,
    h.planRevenueRate,
    h.planChargesRate,
  ];
  const days = [h.receivableDelayDays, h.noDueDateDays];
  return (
    rates.every(
      (r) => Number.isFinite(r) && r >= SCENARIO_BOUNDS.rate.min && r <= SCENARIO_BOUNDS.rate.max,
    ) &&
    days.every(
      (d) => Number.isInteger(d) && d >= SCENARIO_BOUNDS.days.min && d <= SCENARIO_BOUNDS.days.max,
    )
  );
}

interface DatedFlow {
  dayIndex: number;
  flow: ForecastFlow;
  cents: bigint;
}

const SOURCES: readonly ForecastFlowSource[] = [
  'receivable',
  'recurring',
  'plan_in',
  'plan_out',
  'payable',
];

const emptySlot = (): Record<ForecastFlowSource, bigint> => ({
  receivable: 0n,
  recurring: 0n,
  plan_in: 0n,
  plan_out: 0n,
  payable: 0n,
});

/** Montants journaliers exacts d'un total mensuel : cumul(d) = mensuel × 12 × d ÷ 365. */
function dailyAmounts(monthlyCents: bigint): bigint[] {
  const out: bigint[] = [0n];
  let previous = 0n;
  for (let d = 1; d <= FORECAST_DAYS; d += 1) {
    const cumulative = divHalfUp(monthlyCents * 12n * BigInt(d), 365n);
    out.push(cumulative - previous);
    previous = cumulative;
  }
  return out;
}

function horizonOf(dayIndex: number): ForecastHorizon {
  for (const h of FORECAST_HORIZONS) if (dayIndex <= h) return h;
  return FORECAST_HORIZONS[FORECAST_HORIZONS.length - 1] as ForecastHorizon;
}

export function forecastTreasury(input: TreasuryForecastInput): TreasuryForecast {
  const asOfN = dayNumber(input.asOf);
  const endN = asOfN + FORECAST_DAYS;
  const findings = new Map<string, ForecastFinding>();
  const note = (code: ForecastFinding['code'], detail: string | null = null): void => {
    const f = findings.get(code) ?? { code, count: 0, detail };
    f.count += 1;
    findings.set(code, f);
  };

  // ── 1. Solde d'ouverture (observation) ─────────────────────────────────────
  const included = input.accounts.filter((a) => a.active && a.currency === input.currency);
  for (const a of input.accounts) {
    if (a.active && a.currency !== input.currency) note('ACCOUNTS_OTHER_CURRENCY');
  }
  if (included.length === 0) note('NO_ACCOUNT');
  const includedIds = new Set(included.map((a) => a.id));
  const balances = computeAccountBalances(
    included,
    input.movements.filter((m) => includedIds.has(m.accountId)),
    input.asOf,
  );
  const opening = centsOf(balances.totalsByCurrency[input.currency] ?? '0.00') ?? 0n;

  // ── 2. Échéances clients ───────────────────────────────────────────────────
  const receivables = input.receivables.filter((r) => {
    if (r.currency !== input.currency) {
      note('RECEIVABLES_OTHER_CURRENCY');
      return false;
    }
    return (centsOf(r.outstanding) ?? 0n) > 0n;
  });
  for (const r of receivables) if (r.dueDate === null) note('RECEIVABLES_WITHOUT_DUE_DATE');

  // ── 3. Récurrences (indépendantes du scénario, sauf le facteur) ────────────
  const confirmed = new Set(
    input.confirmedOccurrences.map((o) => `${o.recurringExpenseId}|${o.occurrenceDate}`),
  );
  const recurringOccurrences: {
    dayIndex: number;
    date: CalendarDay;
    label: string;
    cents: bigint;
  }[] = [];
  const activeRecurring = input.recurring.filter((r) => r.active && r.currency === input.currency);
  for (const rule of activeRecurring) {
    const from = addDays(input.asOf, -OVERDUE_RECURRING_LOOKBACK_DAYS);
    const to = addDays(input.asOf, FORECAST_DAYS);
    for (const date of occurrencesOf(rule, from, to)) {
      if (confirmed.has(`${rule.id}|${date}`)) continue;
      const n = dayNumber(date);
      const overdue = n <= asOfN;
      if (overdue) note('OVERDUE_RECURRING');
      recurringOccurrences.push({
        dayIndex: overdue ? 1 : n - asOfN,
        date: overdue ? addDays(input.asOf, 1) : date,
        label: overdue ? `${rule.label} (échéance du ${date} non confirmée)` : rule.label,
        cents: trustedCents(rule.amount, 'Dépense récurrente'),
      });
    }
  }

  // ── 3 bis. Échéances fournisseurs (ADR-0044 § 6.3) ────────────────────────
  const payableFlows: DatedFlow[] = [];
  const payableSuppliers = new Set<string>();
  for (const p of input.payables ?? []) {
    if (p.currency !== input.currency) continue;
    const cents = trustedCents(p.remaining, 'Reste à payer');
    if (cents <= 0n) continue;
    if (p.disputed) {
      note(
        'PAYABLES_DISPUTED',
        'Factures fournisseurs en litige : exclues de la prévision tant que le litige dure.',
      );
      continue;
    }
    if (p.supplierId) payableSuppliers.add(p.supplierId);
    const n = dayNumber(p.dueDate);
    const overdue = n <= asOfN;
    const dayIndex = overdue ? 1 : n - asOfN;
    if (dayIndex > FORECAST_DAYS) continue;
    payableFlows.push({
      dayIndex,
      cents,
      flow: {
        date: addDays(input.asOf, dayIndex),
        source: 'payable',
        direction: 'out',
        amount: formatCents(cents),
        label: n < asOfN ? `${p.label} (échéance du ${p.dueDate} dépassée)` : p.label,
      },
    });
  }
  for (const rule of activeRecurring) {
    if (rule.supplierId && payableSuppliers.has(rule.supplierId)) {
      note(
        'RECURRING_AND_PAYABLES_SAME_SUPPLIER',
        'Dépense récurrente chez un fournisseur qui a des factures à payer : vérifiez qu’elle n’est pas comptée deux fois.',
      );
    }
  }
  let notInvoiced = 0n;
  let notInvoicedCount = 0;
  for (const o of input.ordersNotInvoiced ?? []) {
    if (o.currency !== input.currency) continue;
    const cents = trustedCents(o.amount, 'Reste à facturer');
    if (cents <= 0n) continue;
    notInvoiced += cents;
    notInvoicedCount += 1;
  }
  if (notInvoicedCount > 0) {
    findings.set('ORDERS_NOT_INVOICED', {
      code: 'ORDERS_NOT_INVOICED',
      count: notInvoicedCount,
      detail: `Commandes approuvées non facturées : ${formatCents(notInvoiced)} ${input.currency} HT, non prévus (montant et date inconnus).`,
    });
  }

  // ── 4. Plan BUILD ──────────────────────────────────────────────────────────
  let planInMonthly = 0n;
  let planOutMonthly = 0n;
  if (input.plan !== null) {
    const recurringByLine = new Map<string, bigint>();
    for (const rule of activeRecurring) {
      const lineId = input.plan.mapping[rule.category];
      if (lineId === undefined) continue;
      recurringByLine.set(
        lineId,
        (recurringByLine.get(lineId) ?? 0n) + monthlyEquivalentCents(rule.amount, rule.frequency),
      );
    }
    for (const line of input.plan.lines) {
      const monthly = centsOfPlanNumber(line.monthlyAmount);
      if (monthly <= 0n) continue;
      if (line.direction === 'in') {
        planInMonthly += monthly;
      } else {
        const rest = monthly - (recurringByLine.get(line.lineId) ?? 0n);
        if (rest > 0n) planOutMonthly += rest;
      }
    }
  }

  const threshold = centsOf(input.minimumBalance ?? '0.00') ?? 0n;

  // ── 5. Scénarios ───────────────────────────────────────────────────────────
  const scenarios: ForecastScenario[] = FORECAST_SCENARIOS.map((id) => {
    const h = input.scenarios[id];
    const dated: DatedFlow[] = [];

    for (const r of receivables) {
      const base =
        r.dueDate !== null ? dayNumber(r.dueDate) : dayNumber(r.issuedOn) + h.noDueDateDays;
      let n = base + h.receivableDelayDays;
      if (n <= asOfN) n = asOfN + 1;
      if (n > endN) continue;
      const cents = applyRate(
        trustedCents(r.outstanding, 'Reste à encaisser'),
        h.receivableCollectionRate,
      );
      if (cents <= 0n) continue;
      const date = addDays(input.asOf, n - asOfN);
      dated.push({
        dayIndex: n - asOfN,
        cents,
        flow: {
          date,
          source: 'receivable',
          direction: 'in',
          amount: formatCents(cents),
          label: r.label,
        },
      });
    }
    for (const o of recurringOccurrences) {
      const cents = applyRate(o.cents, h.recurringFactor);
      if (cents <= 0n) continue;
      dated.push({
        dayIndex: o.dayIndex,
        cents,
        flow: {
          date: o.date,
          source: 'recurring',
          direction: 'out',
          amount: formatCents(cents),
          label: o.label,
        },
      });
    }
    for (const p of payableFlows) dated.push({ ...p, flow: { ...p.flow } });
    dated.sort((a, b) => a.dayIndex - b.dayIndex || a.flow.label.localeCompare(b.flow.label));

    const planIn = dailyAmounts(applyRate(planInMonthly, h.planRevenueRate));
    const planOut = dailyAmounts(applyRate(planOutMonthly, h.planChargesRate));

    // Flux nets par jour et par source.
    const perDay: Record<ForecastFlowSource, bigint>[] = Array.from(
      { length: FORECAST_DAYS + 1 },
      emptySlot,
    );
    for (const d of dated) {
      const slot = perDay[d.dayIndex];
      if (slot === undefined) continue;
      slot[d.flow.source] += d.cents;
    }
    for (let d = 1; d <= FORECAST_DAYS; d += 1) {
      const slot = perDay[d];
      if (slot === undefined) continue;
      slot.plan_in += planIn[d] ?? 0n;
      slot.plan_out += planOut[d] ?? 0n;
    }

    const balancesByDay: bigint[] = [opening];
    for (let d = 1; d <= FORECAST_DAYS; d += 1) {
      const slot = perDay[d] ?? emptySlot();
      const previous = balancesByDay[d - 1] ?? opening;
      balancesByDay.push(
        previous + slot.receivable + slot.plan_in - slot.recurring - slot.plan_out - slot.payable,
      );
    }

    const horizons: ForecastHorizonSummary[] = FORECAST_HORIZONS.map((days) => {
      let min = opening;
      let minIndex = 0;
      const bySource = emptySlot();
      for (let d = 0; d <= days; d += 1) {
        const b = balancesByDay[d] ?? opening;
        if (b < min) {
          min = b;
          minIndex = d;
        }
        if (d === 0) continue;
        const slot = perDay[d];
        if (slot === undefined) continue;
        for (const s of SOURCES) bySource[s] += slot[s];
      }
      return {
        days,
        date: addDays(input.asOf, days),
        closing: formatCents(balancesByDay[days] ?? opening),
        min: formatCents(min),
        minDate: addDays(input.asOf, minIndex),
        inflows: formatCents(bySource.receivable + bySource.plan_in),
        outflows: formatCents(bySource.recurring + bySource.plan_out + bySource.payable),
        bySource: {
          receivable: formatCents(bySource.receivable),
          recurring: formatCents(bySource.recurring),
          plan_in: formatCents(bySource.plan_in),
          plan_out: formatCents(bySource.plan_out),
          payable: formatCents(bySource.payable),
        },
      };
    });

    // Alertes (docs/08 § Alertes) : le premier jour sous le minimum de
    // l'organisation (tension), s'il précède le premier jour sous zéro
    // (critique). Les deux peuvent coexister ; une tension postérieure à la
    // rupture n'apporte rien.
    const criticalIndex = balancesByDay.findIndex((b) => b < 0n);
    const tensionIndex = threshold > 0n ? balancesByDay.findIndex((b) => b < threshold) : -1;
    const alerts: ForecastAlert[] = [];
    const alertAt = (index: number, severity: ForecastAlert['severity']): ForecastAlert => {
      // Cause probable : la plus forte sortie datée jusqu'à ce jour (à montant
      // égal, la plus proche), ou le cumul des charges du plan s'il la dépasse.
      let cause: ForecastAlert['probableCause'] = null;
      let causeCents = 0n;
      for (const d of dated) {
        if (d.flow.direction !== 'out' || d.dayIndex > index) continue;
        if (d.cents >= causeCents) {
          causeCents = d.cents;
          cause = { label: d.flow.label, amount: d.flow.amount, date: d.flow.date };
        }
      }
      let planOutToDate = 0n;
      for (let d = 1; d <= index; d += 1) planOutToDate += planOut[d] ?? 0n;
      if (planOutToDate > causeCents) {
        cause = {
          label: 'Charges du plan BUILD (cumul jusqu’à cette date)',
          amount: formatCents(planOutToDate),
          date: addDays(input.asOf, index),
        };
      }
      return {
        severity,
        date: addDays(input.asOf, index),
        dayIndex: index,
        horizon: horizonOf(index),
        balance: formatCents(balancesByDay[index] ?? opening),
        threshold: formatCents(severity === 'critique' ? 0n : threshold),
        probableCause: cause,
      };
    };
    if (tensionIndex !== -1 && (criticalIndex === -1 || tensionIndex < criticalIndex)) {
      alerts.push(alertAt(tensionIndex, 'tension'));
    }
    if (criticalIndex !== -1) alerts.push(alertAt(criticalIndex, 'critique'));

    return {
      id,
      hypotheses: { ...h },
      series: balancesByDay.map((b, d) => ({
        date: addDays(input.asOf, d),
        balance: formatCents(b),
      })),
      horizons,
      alerts,
      flows: dated.map((d) => d.flow),
    };
  });

  // ── 6. Incertitude ─────────────────────────────────────────────────────────
  const uncertaintyHorizons = FORECAST_HORIZONS.map((days, i) => {
    const closings = scenarios.map((s) =>
      trustedCents(s.horizons[i]?.closing ?? '0.00', 'Clôture'),
    );
    const low = closings.reduce((a, b) => (b < a ? b : a));
    const high = closings.reduce((a, b) => (b > a ? b : a));
    return {
      days,
      low: formatCents(low),
      high: formatCents(high),
      spread: formatCents(high - low),
    };
  });

  for (const f of input.externalFindings) findings.set(f.code, { ...f });

  return {
    version: TREASURY_VERSION,
    currency: input.currency,
    asOf: input.asOf,
    openingBalance: formatCents(opening),
    accountsIncluded: included.map((a) => a.id),
    minimumBalance: formatCents(threshold),
    planUsed: input.plan !== null,
    scenarios,
    uncertainty: { horizons: uncertaintyHorizons, findings: [...findings.values()] },
  };
}
