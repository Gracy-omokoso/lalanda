// Rapprochement de la comptabilité avec le réalisé (ADR-0049 § 7 ;
// docs/08 § Règle cardinale).
//
// AFFICHÉ, JAMAIS CORRIGÉ : la fonction lit, compare et explique ; elle ne
// rend aucune valeur à écrire, ni dans `actual_periods`, ni dans les écritures.
// Elle ne fabrique aucun chiffre : un réalisé absent reste `null` et la ligne
// est « non comparable », avec sa raison.
//
// Comparaison en DEVISE DE LA PIÈCE, dans la devise du projet (celle du
// réalisé) : aucune conversion. Une pièce dans une autre devise est montrée à
// part (`otherCurrencies`), jamais additionnée.
//
// Décomposition de l'écart (réalisé − comptabilité) en causes typées :
// - `SUSPENSE` : pièce du mois classée au compte d'attente (comptée au réalisé,
//   pas dans les comptes de la règle) ;
// - `PERIOD_MAPPING` : écriture datée d'un autre mois que sa pièce
//   (contre-passation au premier jour ouvert, § 4) ;
// - `MANUAL_ENTRY` : opération diverse sur un compte de la règle ;
// - `OUTSIDE_CUTOVER` : pièces antérieures à la bascule (fourni par l'appelant,
//   qui lit les pièces) ;
// - `ACTUALS_MANUAL_VALUE` : réalisé saisi à la main — tout l'écart lui revient ;
// - `UNEXPLAINED` : reste ; c'est une alerte, pas une correction.

import {
  byString,
  checkCurrency,
  checkMonth,
  formatCents,
  postedLines,
  signedCentsOf,
  type ParsedLine,
} from '../ledger/money.js';
import {
  ACCOUNTING_REPORTING_VERSION,
  type ReportingCurrency,
  type ReportingEntry,
  type ReportingMonth,
} from '../ledger/types.js';

export const RECONCILIATION_CAUSES = [
  'OUTSIDE_CUTOVER',
  'CURRENCY_NOT_CONVERTIBLE',
  'MANUAL_ENTRY',
  'SUSPENSE',
  'PERIOD_MAPPING',
  'ACTUALS_MANUAL_VALUE',
  'UNEXPLAINED',
] as const;
export type ReconciliationCause = (typeof RECONCILIATION_CAUSES)[number];

/** Valeur du réalisé pour une ligne et un mois, telle que lue dans `actual_periods`. */
export interface ActualValue {
  /** Montant signé, deux décimales au plus ; `null` = non saisi, non reporté. */
  value: string | null;
  /** Origine portée par `sources[ligne]` (docs/08). */
  source: 'run.sales' | 'run.expenses' | 'manual' | null;
}

export interface ReconcileWithActualsInput {
  month: ReportingMonth;
  /** Devise du projet relié (celle du réalisé). */
  projectCurrency: ReportingCurrency;
  /** Écritures (tous statuts) des mois voisins compris : un décalage de période se voit des deux côtés. */
  entries: readonly ReportingEntry[];
  suspenseAccountNumbers: readonly string[];
  /** Chiffre d'affaires HT du mois (pont des ventes) ; `null` = non demandé. */
  revenue: ActualValue | null;
  /** Dépenses du mois par catégorie (report des dépenses). */
  expenses: readonly { category: string; actual: ActualValue }[];
  /** Montants connus de l'appelant (pièces antérieures à la bascule), par métrique. */
  outsideCutover?: { revenue?: string; expenses?: Readonly<Record<string, string>> };
  /** Préfixes des clés de produit (défaut : ventes et avoirs, ADR-0049 § 7.4). */
  revenueKeyPrefixes?: readonly string[];
}

export interface ReconciliationMetric {
  metric: string;
  currency: ReportingCurrency;
  comparable: boolean;
  reason: 'NOT_REPORTED' | 'CURRENCY_NOT_CONVERTIBLE' | null;
  actual: string | null;
  actualSource: ActualValue['source'];
  accounting: string;
  /** Réalisé − comptabilité ; `null` si non comparable. */
  difference: string | null;
  causes: { cause: ReconciliationCause; amount: string }[];
  /** Montants du mois dans une autre devise que le projet, jamais convertis. */
  otherCurrencies: { currency: ReportingCurrency; amount: string }[];
  /** Vrai si un écart `UNEXPLAINED` non nul subsiste. */
  alert: boolean;
}

export interface ActualsReconciliation {
  version: string;
  month: ReportingMonth;
  projectCurrency: ReportingCurrency;
  /** Toujours vrai : rien n'est écrit, ni dans le réalisé, ni dans les livres. */
  displayOnly: true;
  metrics: ReconciliationMetric[];
  alertCount: number;
}

const DEFAULT_REVENUE_PREFIXES = ['sale.invoice.revenue.', 'sale.credit_note.revenue.'] as const;

const monthOf = (day: string): string => day.slice(0, 7);

interface MetricSpec {
  metric: string;
  matches: (key: string) => boolean;
  /** +1 : débit positif (charge) ; −1 : crédit positif (produit). */
  sign: 1n | -1n;
  actual: ActualValue;
  outsideCutover: string | undefined;
}

export function reconcileWithActuals(input: ReconcileWithActualsInput): ActualsReconciliation {
  checkMonth(input.month, 'Mois');
  checkCurrency(input.projectCurrency, 'Devise du projet');
  const M = input.month;
  const suspense = new Set(input.suspenseAccountNumbers);
  const lines = postedLines(input.entries);
  const prefixes = input.revenueKeyPrefixes ?? DEFAULT_REVENUE_PREFIXES;

  const specs: MetricSpec[] = [];
  if (input.revenue !== null) {
    specs.push({
      metric: 'revenue',
      matches: (k) => prefixes.some((p) => k.startsWith(p)),
      sign: -1n,
      actual: input.revenue,
      outsideCutover: input.outsideCutover?.revenue,
    });
  }
  for (const e of [...input.expenses].sort((a, b) => byString(a.category, b.category))) {
    const key = `expense.${e.category}`;
    specs.push({
      metric: key,
      matches: (k) => k === key || k.startsWith(`${key}.`),
      sign: 1n,
      actual: e.actual,
      outsideCutover: input.outsideCutover?.expenses?.[e.category],
    });
  }

  const isManual = (l: ParsedLine): boolean =>
    (l.entry.manual ?? null) !== null || (l.entry.generation ?? null) === null;

  const metrics = specs.map((spec): ReconciliationMetric => {
    const keyed = lines.filter((l) => spec.matches(l.line.operationKey ?? ''));
    const ruleAccounts = new Set(
      keyed.filter((l) => !suspense.has(l.line.accountNumber)).map((l) => l.line.accountNumber),
    );
    const v = (l: ParsedLine): bigint => spec.sign * l.doc;
    const srcMonth = (l: ParsedLine): string => monthOf(l.entry.source?.date ?? l.entry.date);

    let accounting = 0n;
    let suspenseAmt = 0n;
    let mappingIn = 0n;
    let mappingOut = 0n;
    let manual = 0n;
    const others = new Map<ReportingCurrency, bigint>();

    for (const l of keyed) {
      const entryM = monthOf(l.entry.date) === M;
      const sourceM = srcMonth(l) === M;
      if (l.currency !== input.projectCurrency) {
        if (sourceM || entryM) others.set(l.currency, (others.get(l.currency) ?? 0n) + v(l));
        continue;
      }
      const inSuspense = suspense.has(l.line.accountNumber);
      if (entryM && !inSuspense) accounting += v(l);
      if (sourceM && entryM && inSuspense) suspenseAmt += v(l);
      if (sourceM && !entryM) mappingIn += v(l);
      if (!sourceM && entryM && !inSuspense) mappingOut += v(l);
    }
    for (const l of lines) {
      if (!isManual(l) || l.line.operationKey) continue;
      if (monthOf(l.entry.date) !== M || !ruleAccounts.has(l.line.accountNumber)) continue;
      if (l.currency !== input.projectCurrency) {
        others.set(l.currency, (others.get(l.currency) ?? 0n) + v(l));
        continue;
      }
      accounting += v(l);
      manual += v(l);
    }

    const otherCurrencies = [...others.entries()]
      .filter(([, a]) => a !== 0n)
      .sort(([a], [b]) => byString(a, b))
      .map(([currency, a]) => ({ currency, amount: formatCents(a) }));
    const base = {
      metric: spec.metric,
      currency: input.projectCurrency,
      actualSource: spec.actual.source,
      accounting: formatCents(accounting),
      otherCurrencies,
    };

    if (spec.actual.value === null) {
      return {
        ...base,
        comparable: false,
        reason: otherCurrencies.length > 0 ? 'CURRENCY_NOT_CONVERTIBLE' : 'NOT_REPORTED',
        actual: null,
        difference: null,
        causes: [],
        alert: false,
      };
    }
    const actual = signedCentsOf(spec.actual.value, `Réalisé ${spec.metric}`);
    const difference = actual - accounting;
    const causes: { cause: ReconciliationCause; amount: bigint }[] = [];
    if (spec.actual.source === 'manual') {
      causes.push({ cause: 'ACTUALS_MANUAL_VALUE', amount: difference });
    } else {
      const outside =
        spec.outsideCutover === undefined ? 0n : signedCentsOf(spec.outsideCutover, 'Hors bascule');
      causes.push(
        { cause: 'OUTSIDE_CUTOVER', amount: outside },
        { cause: 'SUSPENSE', amount: suspenseAmt },
        { cause: 'PERIOD_MAPPING', amount: mappingIn - mappingOut },
        { cause: 'MANUAL_ENTRY', amount: -manual },
      );
      const explained = causes.reduce((s, c) => s + c.amount, 0n);
      causes.push({ cause: 'UNEXPLAINED', amount: difference - explained });
    }
    const kept = causes.filter((c) => c.amount !== 0n);
    return {
      ...base,
      comparable: true,
      reason: null,
      actual: formatCents(actual),
      difference: formatCents(difference),
      causes: kept.map((c) => ({ cause: c.cause, amount: formatCents(c.amount) })),
      alert: kept.some((c) => c.cause === 'UNEXPLAINED'),
    };
  });

  return {
    version: ACCOUNTING_REPORTING_VERSION,
    month: M,
    projectCurrency: input.projectCurrency,
    displayOnly: true,
    metrics,
    alertCount: metrics.filter((m) => m.alert).length,
  };
}
