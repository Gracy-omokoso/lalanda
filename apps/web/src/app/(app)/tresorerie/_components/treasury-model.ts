// Modèle des écrans Trésorerie (ADR-0034) — fonctions PURES, testées sans DOM.
//
// Règle : l'interface met en forme, elle ne calcule aucun chiffre officiel. Les
// montants restent des chaînes ; la seule conversion en nombre sert à POSITIONNER
// des points sur le graphique (une coordonnée n'est pas un résultat financier).

import type { OrgAction } from '@/lib/api';
import type {
  ForecastFlowSource,
  ReconciliationFinding,
  ScenarioHypotheses,
  ScenarioId,
  SyncStatus,
  TreasuryAccountKind,
  TreasuryForecast,
  RecurrenceFrequency,
} from '@/lib/treasury-api';

export function peutConsulterTresorerie(actions: readonly OrgAction[] | null): boolean {
  return actions !== null && actions.includes('treasury.read');
}

export function peutGererTresorerie(actions: readonly OrgAction[] | null): boolean {
  return actions !== null && actions.includes('treasury.manage');
}

/** Relier au réalisé exige en plus `actuals.import` (ADR-0034 § 8). */
export function peutRelier(actions: readonly OrgAction[] | null): boolean {
  return (
    actions !== null && actions.includes('actuals.import') && actions.includes('treasury.read')
  );
}

// ─── Montants ────────────────────────────────────────────────────────────────

const INSECABLE = ' ';
const FINE = ' ';
const SIGNE = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * `"-1234.5"` → `−1 234,50 USD`. Mise en forme par manipulation de chaîne,
 * jamais arrondie ; une valeur illisible reste visible telle quelle.
 */
export function formatMontantSigne(valeur: string, devise: string): string {
  const m = SIGNE.exec(valeur);
  if (m === null) return `${valeur}${INSECABLE}${devise}`;
  const entier = (m[2] ?? '0').replace(/^0+(?=\d)/, '');
  let groupe = '';
  for (let i = 0; i < entier.length; i += 1) {
    if (i > 0 && (entier.length - i) % 3 === 0) groupe += FINE;
    groupe += entier[i];
  }
  const dec = (m[3] ?? '').padEnd(2, '0');
  const negatif = m[1] === '-' && /[1-9]/.test(`${entier}${dec}`);
  return `${negatif ? '−' : ''}${groupe},${dec}${INSECABLE}${devise}`;
}

/** Le montant (chaîne signée) est-il strictement négatif ? Comparaison de texte. */
export function estNegatif(valeur: string): boolean {
  return valeur.startsWith('-') && /[1-9]/.test(valeur);
}

/** Montant saisi à la française (virgule, espaces) → chaîne du contrat, signe permis. */
export function lireMontantSigne(
  saisie: string,
): { ok: true; valeur: string } | { ok: false; erreur: string } {
  const s = saisie
    .replace(/[\s  ]/g, '')
    .replace(',', '.')
    .replace('−', '-');
  if (s === '') return { ok: false, erreur: 'Saisissez un montant.' };
  if (!/^-?\d{1,15}(\.\d{1,2})?$/.test(s)) {
    return { ok: false, erreur: 'Montant invalide : chiffres, virgule, deux décimales au plus.' };
  }
  return { ok: true, valeur: s };
}

// ─── Libellés ────────────────────────────────────────────────────────────────

export const ACCOUNT_KIND_LABELS: Readonly<Record<TreasuryAccountKind, string>> = {
  cash: 'Caisse',
  bank: 'Banque',
  mobile_money: 'Mobile money',
};

export const FREQUENCY_LABELS: Readonly<Record<RecurrenceFrequency, string>> = {
  weekly: 'Chaque semaine',
  monthly: 'Chaque mois',
  quarterly: 'Chaque trimestre',
  yearly: 'Chaque année',
};

export const SCENARIO_LABELS: Readonly<Record<ScenarioId, string>> = {
  optimistic: 'Optimiste',
  probable: 'Probable',
  pessimistic: 'Pessimiste',
};

export const FLOW_SOURCE_LABELS: Readonly<Record<ForecastFlowSource, string>> = {
  receivable: 'Échéances clients',
  recurring: 'Dépenses récurrentes',
  plan_in: 'Ventes prévues au plan',
  plan_out: 'Charges prévues au plan',
};

/** Constats d'incertitude de la prévision (ADR-0034 § 7). */
export const FORECAST_FINDING_LABELS: Readonly<Record<string, string>> = {
  RECEIVABLES_WITHOUT_DUE_DATE: 'Factures sans échéance : date d’encaissement supposée',
  RECEIVABLES_OTHER_CURRENCY: 'Factures dans l’autre devise : non comptées',
  ACCOUNTS_OTHER_CURRENCY: 'Comptes dans l’autre devise : non comptés',
  NO_ACCOUNT: 'Aucun compte dans cette devise : solde d’ouverture inconnu (compté 0)',
  EXPENSES_WITHOUT_ACCOUNT: 'Dépenses sans compte : absentes des soldes',
  OVERDUE_RECURRING: 'Échéances récurrentes passées non confirmées : comptées demain',
  PLAN_NOT_USED: 'Plan BUILD non utilisé',
  RECEIPTS_NOT_INTEGRATED: 'Encaissements pas encore reliés',
  RECEIPTS_WITHOUT_ACCOUNT: 'Encaissements sans compte : absents des soldes',
};

export const RECONCILIATION_FINDING_LABELS: Readonly<Record<ReconciliationFinding, string>> = {
  NOT_SYNCED: 'Le réalisé porté diffère des dépenses',
  PERIOD_CLOSED: 'Période clôturée',
  MANUAL_VALUE_PRESENT: 'Saisie manuelle conservée',
  CURRENCY_NOT_CONVERTIBLE: 'Dépense dans une autre devise : non reportée',
  NO_PLAN_BASE: 'Le plan ne publie pas cet exercice',
};

export const SYNC_STATUS_LABELS: Readonly<Record<SyncStatus, string>> = {
  written: 'Écrit',
  unchanged: 'Inchangé',
  removed: 'Retiré',
  PERIOD_CLOSED: 'Période clôturée : non modifiée',
  MANUAL_VALUE_PRESENT: 'Saisie manuelle : non écrasée',
  OTHER_SOURCE_PRESENT: 'Alimentée par les ventes : non écrasée',
  UNKNOWN_LINE: 'Ligne absente du plan validé',
};

/** Hypothèses d'un scénario, lisibles (« 90 % », « 15 j »). */
export function hypothesesLisibles(h: ScenarioHypotheses): { label: string; valeur: string }[] {
  const pct = (r: number): string =>
    `${String(Math.round(r * 1000) / 10).replace('.', ',')}${INSECABLE}%`;
  const jours = (d: number): string => `${d}${INSECABLE}j`;
  return [
    { label: 'Taux d’encaissement des échéances clients', valeur: pct(h.receivableCollectionRate) },
    { label: 'Retard après l’échéance', valeur: jours(h.receivableDelayDays) },
    { label: 'Délai supposé sans échéance', valeur: jours(h.noDueDateDays) },
    { label: 'Facteur des dépenses récurrentes', valeur: pct(h.recurringFactor) },
    { label: 'Réalisation des ventes du plan', valeur: pct(h.planRevenueRate) },
    { label: 'Facteur des charges du plan', valeur: pct(h.planChargesRate) },
  ];
}

/** « 90 » (pour cent saisi) → 0,9 ; `null` si illisible. */
export function lirePourcent(saisie: string): number | null {
  const s = saisie.replace(/[\s% ]/g, '').replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100) / 10_000;
}

/** Mois civil `AAAA-MM` → « mars 2026 ». */
export function libelleMois(mois: string): string {
  const [a, m] = mois.split('-');
  const noms = [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
  ];
  const nom = noms[Number(m) - 1];
  return nom ? `${nom} ${a}` : mois;
}

/** Date civile `AAAA-MM-JJ` → `JJ/MM/AAAA`. */
export function libelleDate(jour: string): string {
  const [a, m, j] = jour.split('-');
  return a && m && j ? `${j}/${m}/${a}` : jour;
}

// ─── Graphique de la prévision ───────────────────────────────────────────────

export interface ForecastChart {
  width: number;
  height: number;
  /** Tracé SVG par scénario. */
  paths: Record<ScenarioId, string>;
  /** Bande d'incertitude entre optimiste et pessimiste (polygone SVG). */
  band: string;
  /** Ordonnée de zéro et du minimum, `null` hors du cadre. */
  zeroY: number | null;
  thresholdY: number | null;
  /** Repères verticaux des horizons 7, 30, 90, 180. */
  horizons: { days: number; x: number }[];
  /** Graduations horizontales (montants en texte de l'API, déjà arrondis à l'unité). */
  ticks: { y: number; value: number }[];
  /** Position du premier jour d'alerte par scénario, `null` sans alerte. */
  alerts: { scenario: ScenarioId; x: number; y: number; severity: 'critique' | 'tension' }[];
}

const PAD = { left: 64, right: 12, top: 12, bottom: 24 };

/**
 * Coordonnées du graphique. Le domaine vertical couvre toutes les séries, zéro
 * et le minimum : une rupture de trésorerie doit toujours être visible.
 */
export function geometrieGraphique(
  forecast: TreasuryForecast,
  width = 720,
  height = 260,
): ForecastChart {
  const byId = new Map(forecast.scenarios.map((s) => [s.id, s]));
  const values: number[] = [0, Number(forecast.minimumBalance)];
  for (const s of forecast.scenarios) for (const p of s.series) values.push(Number(p.balance));
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max === min) {
    max += 1;
    min -= 1;
  }
  const days = Math.max(1, (forecast.scenarios[0]?.series.length ?? 1) - 1);
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const x = (d: number): number => PAD.left + (d / days) * innerW;
  const y = (v: number): number => PAD.top + ((max - v) / (max - min)) * innerH;
  const r = (n: number): number => Math.round(n * 10) / 10;

  const pathOf = (id: ScenarioId): string => {
    const s = byId.get(id);
    if (!s) return '';
    return s.series
      .map((p, d) => `${d === 0 ? 'M' : 'L'}${r(x(d))},${r(y(Number(p.balance)))}`)
      .join(' ');
  };
  const opt = byId.get('optimistic')?.series ?? [];
  const pess = byId.get('pessimistic')?.series ?? [];
  const band =
    opt.length > 0 && pess.length > 0
      ? [
          ...opt.map((p, d) => `${r(x(d))},${r(y(Number(p.balance)))}`),
          ...pess.map((p, d) => `${r(x(d))},${r(y(Number(p.balance)))}`).reverse(),
        ].join(' ')
      : '';

  const inside = (v: number): number | null => (v >= min && v <= max ? r(y(v)) : null);
  const step = (max - min) / 4;
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const value = Math.round(min + step * i);
    return { y: r(y(value)), value };
  });

  return {
    width,
    height,
    paths: {
      optimistic: pathOf('optimistic'),
      probable: pathOf('probable'),
      pessimistic: pathOf('pessimistic'),
    },
    band,
    zeroY: inside(0),
    thresholdY:
      Number(forecast.minimumBalance) > 0 ? inside(Number(forecast.minimumBalance)) : null,
    horizons: [7, 30, 90, 180].filter((h) => h <= days).map((h) => ({ days: h, x: r(x(h)) })),
    ticks,
    alerts: forecast.scenarios.flatMap((s) =>
      s.alerts.map((a) => ({
        scenario: s.id,
        x: r(x(a.dayIndex)),
        y: r(y(Number(a.balance))),
        severity: a.severity,
      })),
    ),
  };
}

/** Graduation lisible et compacte (« 12 k », « −1,5 M ») — affichage seulement. */
export function graduation(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000)
    return `${sign}${String(Math.round(abs / 100_000) / 10).replace('.', ',')}${INSECABLE}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}${INSECABLE}k`;
  return `${sign}${Math.round(abs)}`;
}
