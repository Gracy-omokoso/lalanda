// ─────────────────────────────────────────────────────────────────────────────
// Dépenses et trésorerie réelle — types et référentiels (ADR-0034)
//
// Module PUR : aucune base, aucun réseau, aucune horloge (la date du jour est un
// paramètre). Les montants circulent en chaînes décimales (« 1250.50 », signées
// quand un solde peut être négatif) ; l'arithmétique se fait en centimes entiers
// (`bigint`), jamais en flottant.
// ─────────────────────────────────────────────────────────────────────────────

/** Toute évolution d'un calcul de ce module incrémente cette version. */
export const TREASURY_VERSION = '1.0.0';

/** Devises de la trésorerie RUN — les mêmes que la facturation (ADR-0023). */
export const TREASURY_CURRENCIES = ['CDF', 'USD'] as const;
export type TreasuryCurrency = (typeof TREASURY_CURRENCIES)[number];

/** Date civile `AAAA-MM-JJ` (fuseau de Kinshasa, ADR-0027). */
export type CalendarDay = string;
/** Mois civil `AAAA-MM`. */
export type CalendarMonthKey = string;
/** Montant décimal à deux décimales au plus, éventuellement signé. */
export type MoneyString = string;

/**
 * Nature d'une catégorie. Ce n'est PAS une qualification comptable certifiée
 * (ADR-0018 : pas de comptabilité générale) : elle empêche seulement de
 * rattacher un investissement ou un remboursement d'emprunt à une ligne du
 * compte d'exploitation.
 */
export type ExpenseNature = 'exploitation' | 'investissement' | 'financement';

/**
 * Quatorze catégories alignées sur les hypothèses des modèles BUILD
 * (`personnel_mois`, `loyer_mois`, `marketing_mois`, `outils_logiciels_mois`,
 * `transport_stock_mois`, `charges_diverses_mois`, achats variables, IBP,
 * investissements, emprunt) — ADR-0034 § 1. L'ordre est celui de l'affichage.
 */
export const EXPENSE_CATEGORIES = [
  { code: 'achats', label: 'Achats de marchandises et matières', nature: 'exploitation' },
  { code: 'personnel', label: 'Salaires et charges sociales', nature: 'exploitation' },
  { code: 'loyer', label: 'Loyer et charges locatives', nature: 'exploitation' },
  { code: 'transport', label: 'Transport et logistique', nature: 'exploitation' },
  { code: 'marketing', label: 'Marketing et publicité', nature: 'exploitation' },
  { code: 'outils_logiciels', label: 'Outils, logiciels et abonnements', nature: 'exploitation' },
  { code: 'energie_telecom', label: 'Énergie, eau et télécommunications', nature: 'exploitation' },
  {
    code: 'services_exterieurs',
    label: 'Honoraires et services extérieurs',
    nature: 'exploitation',
  },
  {
    code: 'impots_taxes',
    label: 'Impôts et taxes (hors impôt sur les bénéfices)',
    nature: 'exploitation',
  },
  { code: 'impot_benefices', label: 'Impôt sur les bénéfices', nature: 'exploitation' },
  { code: 'frais_financiers', label: 'Frais bancaires et intérêts', nature: 'exploitation' },
  { code: 'charges_diverses', label: 'Charges diverses', nature: 'exploitation' },
  { code: 'investissement', label: 'Investissements (immobilisations)', nature: 'investissement' },
  {
    code: 'remboursement_emprunt',
    label: 'Remboursement du capital emprunté',
    nature: 'financement',
  },
] as const satisfies readonly { code: string; label: string; nature: ExpenseNature }[];

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]['code'];

export const EXPENSE_CATEGORY_CODES: readonly ExpenseCategory[] = EXPENSE_CATEGORIES.map(
  (c) => c.code,
);

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === 'string' && (EXPENSE_CATEGORY_CODES as readonly string[]).includes(value);
}

/** Nature d'une catégorie connue. */
export function expenseCategoryNature(code: ExpenseCategory): ExpenseNature {
  const found = EXPENSE_CATEGORIES.find((c) => c.code === code);
  // Inatteignable : `code` est typé sur la liste elle-même.
  return found ? found.nature : 'exploitation';
}

/** Natures de compte de trésorerie (ADR-0034 § 4). */
export const TREASURY_ACCOUNT_KINDS = ['cash', 'bank', 'mobile_money'] as const;
export type TreasuryAccountKind = (typeof TREASURY_ACCOUNT_KINDS)[number];

/** Fréquences d'une dépense récurrente (ADR-0034 § 3). */
export const RECURRENCE_FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/** Correspondance catégorie → ligne de charge du plan, choisie par l'utilisateur. */
export type CategoryMapping = Partial<Record<ExpenseCategory, string>>;

// ─── Dépenses ────────────────────────────────────────────────────────────────

export interface ExpenseInput {
  id: string;
  spentOn: CalendarDay;
  amount: MoneyString;
  currency: TreasuryCurrency;
  category: ExpenseCategory;
  /** Libellé, pour les pièces citées dans le rapprochement. */
  label?: string;
}

export interface ExpenseMonthlyTotal {
  month: CalendarMonthKey;
  currency: TreasuryCurrency;
  category: ExpenseCategory;
  total: MoneyString;
  count: number;
}

export interface ExpenseAggregation {
  version: string;
  /** Trié par mois, devise, puis ordre des catégories. */
  byMonth: ExpenseMonthlyTotal[];
  totalsByCurrency: Partial<Record<TreasuryCurrency, MoneyString>>;
}

// ─── Pont vers le réalisé ────────────────────────────────────────────────────

export interface ExpenseActualsInput {
  expenses: readonly ExpenseInput[];
  mapping: CategoryMapping;
  /** Devise du projet relié (`deviseAffichage`). Une autre devise n'est pas convertie. */
  projectCurrency: string;
  /** Mois civil qui ouvre l'exercice 1. */
  firstMonth: CalendarMonthKey;
}

/** Case (exercice, mois, ligne) reportable au réalisé. */
export interface ExpenseActualsCell {
  year: number;
  month: number;
  calendarMonth: CalendarMonthKey;
  lineId: string;
  amount: MoneyString;
  /** Identifiants des dépenses, triés : base de l'empreinte d'idempotence. */
  documents: string[];
  /** Contribution de chaque catégorie, dans l'ordre des catégories. */
  categories: { category: ExpenseCategory; amount: MoneyString }[];
}

export type ExpenseActualsSkipReason = 'OUTSIDE_PLAN_HORIZON' | 'CURRENCY_NOT_CONVERTIBLE';

export interface ExpenseActualsSkipped {
  calendarMonth: CalendarMonthKey;
  /** `null` si le mois est hors horizon (exercice et mois inconnus). */
  year: number | null;
  month: number | null;
  lineId: string;
  reason: ExpenseActualsSkipReason;
  expenseIds: string[];
  totalsByCurrency: Partial<Record<TreasuryCurrency, MoneyString>>;
}

export interface ExpenseUnmapped {
  calendarMonth: CalendarMonthKey;
  category: ExpenseCategory;
  currency: TreasuryCurrency;
  total: MoneyString;
  count: number;
}

export interface ExpenseActualsPlan {
  version: string;
  cells: ExpenseActualsCell[];
  skipped: ExpenseActualsSkipped[];
  unmapped: ExpenseUnmapped[];
}

// ─── Comptes et soldes ───────────────────────────────────────────────────────

export interface TreasuryAccountInput {
  id: string;
  currency: TreasuryCurrency;
  /** Solde au DÉBUT du jour d'ouverture ; signé (découvert possible). */
  openingBalance: MoneyString;
  openingDate: CalendarDay;
  active?: boolean;
}

export type MovementDirection = 'in' | 'out';

export interface TreasuryMovementInput {
  accountId: string;
  date: CalendarDay;
  direction: MovementDirection;
  /** Strictement positif ; le sens porte le signe. */
  amount: MoneyString;
}

export interface AccountBalance {
  accountId: string;
  currency: TreasuryCurrency;
  openingBalance: MoneyString;
  inflows: MoneyString;
  outflows: MoneyString;
  balance: MoneyString;
  movementCount: number;
}

export interface AccountBalances {
  version: string;
  asOf: CalendarDay;
  accounts: AccountBalance[];
  /** Comptes ACTIFS seulement. */
  totalsByCurrency: Partial<Record<TreasuryCurrency, MoneyString>>;
  /** Mouvements écartés : compte inconnu, date antérieure à l'ouverture, ou postérieure à `asOf`. */
  ignored: { unknownAccount: number; beforeOpening: number; afterAsOf: number };
}

// ─── Récurrences ─────────────────────────────────────────────────────────────

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  startDate: CalendarDay;
  endDate: CalendarDay | null;
}

export interface RecurringExpenseInput extends RecurrenceRule {
  id: string;
  label: string;
  category: ExpenseCategory;
  currency: TreasuryCurrency;
  amount: MoneyString;
  active: boolean;
}

// ─── Rapprochement ───────────────────────────────────────────────────────────

export interface ReconciliationLineInput {
  lineId: string;
  label: string;
  /** Prévu mensuel (base annuelle ÷ 12, docs/08) ; `null` si le plan n'a pas de base. */
  prevuMensuel: number | null;
}

export interface ReconciliationPeriodInput {
  month: number;
  status: 'open' | 'closed';
  values: Record<string, number>;
  /** Origine de chaque valeur (`run.expenses`, `run.sales`, `manual`) ; absente = saisie manuelle ancienne. */
  sources: Record<string, { source: string } | undefined>;
}

export interface ReconcileExpensesInput {
  year: number;
  lines: readonly ReconciliationLineInput[];
  plan: ExpenseActualsPlan;
  expenses: readonly ExpenseInput[];
  periods: readonly ReconciliationPeriodInput[];
}

export type ReconciliationFinding =
  | 'NOT_SYNCED'
  | 'PERIOD_CLOSED'
  | 'MANUAL_VALUE_PRESENT'
  | 'CURRENCY_NOT_CONVERTIBLE'
  | 'NO_PLAN_BASE';

export type VarianceStatus = 'favorable' | 'defavorable' | 'conforme';

export interface ReconciliationMonth {
  month: number;
  prevu: MoneyString | null;
  realise: MoneyString | null;
  stored: MoneyString | null;
  storedSource: 'run.expenses' | 'run.sales' | 'manual' | null;
  ecart: MoneyString | null;
  statut: VarianceStatus | null;
  findings: ReconciliationFinding[];
}

export interface ReconciliationLine {
  lineId: string;
  label: string;
  comparable: boolean;
  months: ReconciliationMonth[];
  total: {
    monthsCounted: number[];
    prevuCumule: MoneyString | null;
    realiseCumule: MoneyString | null;
    ecart: MoneyString | null;
    /** Fraction (0.12 = +12 %) ; `null` si le prévu cumulé est nul ou absent. */
    ecartPct: number | null;
    statut: VarianceStatus | null;
  };
  categories: { category: ExpenseCategory; amount: MoneyString }[];
  topExpenses: { id: string; label: string; spentOn: CalendarDay; amount: MoneyString }[];
}

export interface ExpenseReconciliation {
  version: string;
  year: number;
  convention: 'annuel/12';
  lines: ReconciliationLine[];
}

// ─── Prévision ───────────────────────────────────────────────────────────────

export const FORECAST_HORIZONS = [7, 30, 90, 180] as const;
export type ForecastHorizon = (typeof FORECAST_HORIZONS)[number];
export const FORECAST_DAYS = 180;

export const FORECAST_SCENARIOS = ['optimistic', 'probable', 'pessimistic'] as const;
export type ForecastScenarioId = (typeof FORECAST_SCENARIOS)[number];

/** Hypothèses EXPLICITES d'un scénario (ADR-0034 § 7). Taux en fraction (0.9 = 90 %). */
export interface ScenarioHypotheses {
  receivableCollectionRate: number;
  receivableDelayDays: number;
  noDueDateDays: number;
  recurringFactor: number;
  planRevenueRate: number;
  planChargesRate: number;
}

export interface ReceivableInput {
  id: string;
  label: string;
  currency: TreasuryCurrency;
  outstanding: MoneyString;
  dueDate: CalendarDay | null;
  issuedOn: CalendarDay;
}

export interface ForecastPlanLine {
  lineId: string;
  label: string;
  direction: MovementDirection;
  /** Montant mensuel du plan (devise du projet = devise de la prévision). */
  monthlyAmount: number;
}

export interface ForecastPlanInput {
  lines: readonly ForecastPlanLine[];
  mapping: CategoryMapping;
}

export type ForecastFindingCode =
  | 'RECEIVABLES_WITHOUT_DUE_DATE'
  | 'RECEIVABLES_OTHER_CURRENCY'
  | 'ACCOUNTS_OTHER_CURRENCY'
  | 'NO_ACCOUNT'
  | 'EXPENSES_WITHOUT_ACCOUNT'
  | 'OVERDUE_RECURRING'
  | 'PLAN_NOT_USED'
  | 'RECEIPTS_NOT_INTEGRATED'
  /** Encaissements (ADR-0031) sans compte de trésorerie : absents des soldes. */
  | 'RECEIPTS_WITHOUT_ACCOUNT';

export interface ForecastFinding {
  code: ForecastFindingCode;
  count: number;
  detail: string | null;
}

export interface TreasuryForecastInput {
  asOf: CalendarDay;
  currency: TreasuryCurrency;
  accounts: readonly (TreasuryAccountInput & { active: boolean })[];
  movements: readonly TreasuryMovementInput[];
  receivables: readonly ReceivableInput[];
  recurring: readonly RecurringExpenseInput[];
  /** Occurrences déjà confirmées (devenues des dépenses) : exclues de la prévision. */
  confirmedOccurrences: readonly { recurringExpenseId: string; occurrenceDate: CalendarDay }[];
  plan: ForecastPlanInput | null;
  scenarios: Record<ForecastScenarioId, ScenarioHypotheses>;
  /** Minimum de trésorerie fixé par l'organisation pour cette devise ; `null` = 0. */
  minimumBalance: MoneyString | null;
  /** Constats connus de l'appelant seulement (encaissements non intégrés, plan écarté…). */
  externalFindings: readonly ForecastFinding[];
}

export type ForecastFlowSource = 'receivable' | 'recurring' | 'plan_in' | 'plan_out';

export interface ForecastFlow {
  date: CalendarDay;
  source: ForecastFlowSource;
  direction: MovementDirection;
  amount: MoneyString;
  label: string;
}

export interface ForecastHorizonSummary {
  days: ForecastHorizon;
  date: CalendarDay;
  closing: MoneyString;
  min: MoneyString;
  minDate: CalendarDay;
  inflows: MoneyString;
  outflows: MoneyString;
  bySource: Record<ForecastFlowSource, MoneyString>;
}

export interface ForecastAlert {
  severity: 'critique' | 'tension';
  date: CalendarDay;
  dayIndex: number;
  horizon: ForecastHorizon;
  balance: MoneyString;
  threshold: MoneyString;
  probableCause: { label: string; amount: MoneyString; date: CalendarDay } | null;
}

export interface ForecastScenario {
  id: ForecastScenarioId;
  hypotheses: ScenarioHypotheses;
  /** 181 points : jour 0 (solde d'ouverture, observation) puis J+1 … J+180 (estimation). */
  series: { date: CalendarDay; balance: MoneyString }[];
  horizons: ForecastHorizonSummary[];
  /** Au plus deux : la première tension (si elle précède la rupture), puis la première rupture. */
  alerts: ForecastAlert[];
  /** Flux datés hors plan (le plan, journalier, est résumé par horizon). */
  flows: ForecastFlow[];
}

export interface TreasuryForecast {
  version: string;
  currency: TreasuryCurrency;
  asOf: CalendarDay;
  openingBalance: MoneyString;
  accountsIncluded: string[];
  minimumBalance: MoneyString;
  planUsed: boolean;
  scenarios: ForecastScenario[];
  uncertainty: {
    horizons: { days: ForecastHorizon; low: MoneyString; high: MoneyString; spread: MoneyString }[];
    findings: ForecastFinding[];
  };
}
