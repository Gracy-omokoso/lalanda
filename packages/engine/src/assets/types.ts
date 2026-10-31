// ─────────────────────────────────────────────────────────────────────────────
// Équipements — types (ADR-0046 § 3, § 7.2)
//
// Module PUR : aucune base, aucun réseau, aucune horloge (le jour de référence
// est un paramètre, jour civil de Kinshasa déjà calculé par l'appelant,
// ADR-0027). Montants en chaînes décimales (deux décimales au plus) ;
// arithmétique en entiers `bigint` (centimes), jamais en flottant ; JAMAIS de
// conversion entre devises.
//
// Aucune règle comptable ni fiscale (ADR-0046 § 9) : l'amortissement est une
// ESTIMATION DE GESTION linéaire dont la durée et la valeur résiduelle sont
// saisies par équipement ; aucune durée par défaut, aucune durée SYSCOHADA.
// ─────────────────────────────────────────────────────────────────────────────

/** Toute évolution d'un calcul de ce module incrémente cette version. */
export const ASSETS_VERSION = '1.0.0';

/** Devises des équipements (ADR-0046 § 1). */
export const ASSET_CURRENCIES = ['CDF', 'USD'] as const;
export type AssetCurrency = (typeof ASSET_CURRENCIES)[number];

/** Date civile `AAAA-MM-JJ` (jour de Kinshasa). */
export type AssetDay = string;
/** Montant décimal positif ou nul, deux décimales au plus (« 1200.00 »). */
export type AssetAmount = string;

/** Libellé porté par toute estimation (ADR-0046 O7, § 9). */
export const MANAGEMENT_ESTIMATE_LABEL = 'management_estimate' as const;
/** Texte à afficher partout où l'estimation apparaît (ADR-0046 § 9). */
export const MANAGEMENT_ESTIMATE_NOTICE =
  'Estimation de gestion — n’est pas un amortissement comptable ou fiscal';

/** Bornes de la durée saisie, en années entières (ADR-0046 § 3.1). */
export const DEPRECIATION_YEARS_BOUNDS = { min: 1, max: 50 } as const;
/** Bornes de la périodicité de maintenance, en mois (ADR-0046 § 3.3). */
export const MAINTENANCE_EVERY_MONTHS_BOUNDS = { min: 1, max: 60 } as const;
/** Bornes d'un délai de rappel, en jours (même bornes que les RH, ADR-0045). */
export const ASSET_REMINDER_DAYS_BOUNDS = { min: 0, max: 120 } as const;
/** Réglages par défaut proposés à l'activation (ADR-0046 § 3.5) — l'API les applique. */
export const ASSET_SETTINGS_DEFAULTS = { reminderDays: 30, maintenanceDueSoonDays: 7 } as const;

export const ASSET_STATUSES = [
  'in_service',
  'in_storage',
  'under_maintenance',
  'lost',
  'disposed',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_DISPOSAL_KINDS = [
  'scrapped',
  'sold',
  'donated',
  'lost',
  'stolen',
  'returned',
] as const;
export type AssetDisposalKind = (typeof ASSET_DISPOSAL_KINDS)[number];

// ─── Équipement ──────────────────────────────────────────────────────────────

export interface AssetAcquisitionInput {
  on: AssetDay;
  cost: AssetAmount;
  currency: AssetCurrency;
}

/** Paramètres saisis de l'estimation ; `null` = pas d'estimation. */
export interface ManagementDepreciationInput {
  /** Entier de 1 à 50 ; absent ou `null` = non estimable. */
  years: number | null;
  /** Même devise que le coût d'acquisition ; ≤ coût. */
  residualValue: AssetAmount;
  /** Début de l'estimation : le mois de cette date est le premier mois compté. */
  startOn: AssetDay;
}

export interface AssetDisposalInput {
  on: AssetDay;
  kind?: AssetDisposalKind;
}

/** Affectation ouverte recopiée sur l'équipement (ADR-0046 § 3.1). */
export type AssetAssignee =
  | { kind: 'employee'; employeeId: string }
  | { kind: 'project'; workProjectId: string }
  | { kind: 'location'; locationId: string }
  | { kind: 'member'; userId: string };

export interface AssetInput {
  id: string;
  categoryId?: string | null;
  status: AssetStatus;
  acquisition: AssetAcquisitionInput;
  managementDepreciation?: ManagementDepreciationInput | null;
  disposal?: AssetDisposalInput | null;
  currentAssignment?: { assignee: AssetAssignee; from: AssetDay } | null;
}

// ─── Estimation de gestion ───────────────────────────────────────────────────

export type NotEstimableReason =
  /** Aucune durée saisie (paramètres absents ou `years` nul). */
  | 'NO_DURATION'
  /** Valeur résiduelle supérieure au coût d'acquisition. */
  | 'RESIDUAL_ABOVE_COST';

export interface ManagementEstimateUnavailable {
  version: string;
  label: typeof MANAGEMENT_ESTIMATE_LABEL;
  estimable: false;
  reason: NotEstimableReason;
}

export interface ManagementEstimate {
  version: string;
  label: typeof MANAGEMENT_ESTIMATE_LABEL;
  estimable: true;
  currency: AssetCurrency;
  cost: AssetAmount;
  residualValue: AssetAmount;
  /** Coût − valeur résiduelle. */
  depreciableBase: AssetAmount;
  startOn: AssetDay;
  /** Dernier jour du dernier mois de l'estimation. */
  endOn: AssetDay;
  monthsTotal: number;
  /** Mois comptés à la date effective (mois entamé compté), de 0 à `monthsTotal`. */
  monthsElapsed: number;
  /** Date demandée. */
  onDate: AssetDay;
  /** Date de calcul : `onDate`, ou la date de cession si elle la précède. */
  effectiveOn: AssetDay;
  /** Date de cession qui a arrêté l'estimation, sinon `null`. */
  stoppedByDisposalOn: AssetDay | null;
  /** Part de la base consommée, cumulée. */
  consumed: AssetAmount;
  /** Coût − consommé. */
  estimatedValue: AssetAmount;
  /** Part écoulée de la durée (mois comptés ÷ mois totaux), en %, deux décimales. */
  consumedPercent: string;
}

export interface ManagementScheduleMonth {
  /** `AAAA-MM`. */
  month: string;
  /** 1 pour le premier mois. */
  index: number;
  charge: AssetAmount;
  cumulative: AssetAmount;
  closingValue: AssetAmount;
}

export interface ManagementScheduleYear {
  year: number;
  months: number;
  charge: AssetAmount;
  closingValue: AssetAmount;
}

export interface ManagementScheduleAvailable {
  version: string;
  label: typeof MANAGEMENT_ESTIMATE_LABEL;
  estimable: true;
  currency: AssetCurrency;
  cost: AssetAmount;
  residualValue: AssetAmount;
  depreciableBase: AssetAmount;
  startOn: AssetDay;
  endOn: AssetDay;
  monthsTotal: number;
  /** Tableau arrêté au mois de cession, sinon `null`. */
  stoppedByDisposalOn: AssetDay | null;
  months: ManagementScheduleMonth[];
  /** Regroupement par année civile. */
  years: ManagementScheduleYear[];
}

export type ManagementScheduleResult = ManagementEstimateUnavailable | ManagementScheduleAvailable;
export type ManagementEstimateResult = ManagementEstimateUnavailable | ManagementEstimate;

// ─── Échéances ───────────────────────────────────────────────────────────────

export type ExpiryStatus = 'expired' | 'due_soon' | 'ok';

export const MAINTENANCE_KINDS = ['preventive', 'corrective', 'inspection'] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];
export const MAINTENANCE_STATUSES = ['planned', 'done', 'cancelled'] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export interface AssetMaintenanceInput {
  id: string;
  assetId: string;
  kind: MaintenanceKind;
  status: MaintenanceStatus;
  plannedOn?: AssetDay | null;
  doneOn?: AssetDay | null;
  cost?: AssetAmount | null;
  currency?: AssetCurrency | null;
  recurrence?: { everyMonths: number } | null;
}

export const COVERAGE_KINDS = ['warranty', 'insurance', 'service_contract'] as const;
export type CoverageKind = (typeof COVERAGE_KINDS)[number];

export interface AssetCoverageInput {
  id: string;
  assetId: string;
  kind: CoverageKind;
  startOn: AssetDay;
  endOn: AssetDay;
  /** Absent ou `null` = réglage de l'organisation. */
  reminderDays?: number | null;
  cost?: AssetAmount | null;
  currency?: AssetCurrency | null;
}

/** Collaborateur lu par identifiant (R4) : seule la date de sortie compte. */
export interface AssetEmployeeInput {
  id: string;
  /** Dernier jour dans l'organisation ; `null` = présent. */
  endDate: AssetDay | null;
}

export interface AssetDeadlineSettings {
  reminderDays: number;
  maintenanceDueSoonDays: number;
}

export const ASSET_DEADLINE_KINDS = [
  'maintenance_overdue',
  'maintenance_due_soon',
  'coverage_expired',
  'coverage_due_soon',
  'held_by_former_employee',
] as const;
export type AssetDeadlineKind = (typeof ASSET_DEADLINE_KINDS)[number];

export interface AssetDeadline {
  kind: AssetDeadlineKind;
  assetId: string;
  /** Intervention ou couverture concernée ; `null` pour un détenteur sorti. */
  refId: string | null;
  /** Collaborateur sorti qui détient l'équipement, sinon `null`. */
  employeeId: string | null;
  /** Échéance : date prévue, fin de couverture, ou date de sortie du collaborateur. */
  date: AssetDay;
  /** Jours de `today` à `date` (négatif si passé). */
  daysLeft: number;
  /** Clé stable pour n'émettre une notification qu'une fois par échéance. */
  dedupeKey: string;
}

export interface AssetDeadlinesResult {
  version: string;
  today: AssetDay;
  deadlines: AssetDeadline[];
  counts: Record<AssetDeadlineKind, number>;
  total: number;
}

// ─── Registre, coût total ────────────────────────────────────────────────────

export interface AssetCurrencyTotal {
  currency: AssetCurrency;
  count: number;
  total: AssetAmount;
}

export interface AssetRegisterSummary {
  version: string;
  total: number;
  byStatus: { status: AssetStatus; count: number }[];
  byCategory: {
    categoryId: string | null;
    count: number;
    byStatus: { status: AssetStatus; count: number }[];
    acquisitionCosts: AssetCurrencyTotal[];
  }[];
  /** Tous les équipements, cédés compris. */
  acquisitionCosts: AssetCurrencyTotal[];
  /** Hors équipements cédés. */
  activeAcquisitionCosts: AssetCurrencyTotal[];
  /** Présent seulement si une date est fournie ; hors équipements cédés à cette date. */
  managementEstimate: {
    label: typeof MANAGEMENT_ESTIMATE_LABEL;
    onDate: AssetDay;
    estimatedValues: AssetCurrencyTotal[];
    notEstimable: number;
  } | null;
}

export interface TotalCostOfOwnership {
  version: string;
  assetId: string;
  until: AssetDay | null;
  /** Par devise, jamais convertie. */
  byCurrency: {
    currency: AssetCurrency;
    acquisition: AssetAmount;
    maintenance: AssetAmount;
    coverages: AssetAmount;
    total: AssetAmount;
  }[];
  maintenanceCount: number;
  /** Interventions faites sans coût saisi. */
  unpricedMaintenanceCount: number;
  coverageCount: number;
}

// ─── Affectations ────────────────────────────────────────────────────────────

export interface AssetAssignmentInput {
  id: string;
  assetId: string;
  assignee: AssetAssignee;
  from: AssetDay;
  /** Date de retour ; `null` = ouverte. */
  to: AssetDay | null;
}

export type AssignmentIssueCode =
  /** Retour antérieur à la remise. */
  | 'END_BEFORE_START'
  /** Deux affectations se chevauchent. */
  | 'ASSIGNMENT_OVERLAP'
  /** Plus d'une affectation ouverte. */
  | 'MULTIPLE_OPEN';

export interface AssignmentIssue {
  code: AssignmentIssueCode;
  ids: string[];
}

export interface AssignmentHistoryEntry {
  id: string;
  assignee: AssetAssignee;
  from: AssetDay;
  to: AssetDay | null;
  /** Jours de `from` à `to` (ou à `today` si ouverte). */
  days: number;
}

export interface AssignmentHistory {
  version: string;
  assetId: string;
  today: AssetDay;
  entries: AssignmentHistoryEntry[];
  current: AssignmentHistoryEntry | null;
  issues: AssignmentIssue[];
  valid: boolean;
}

export type NewAssignmentCheck =
  | { ok: true; closes: { id: string; to: AssetDay } | null }
  | { ok: false; code: 'INVALID_HISTORY' | 'STARTS_BEFORE_LAST_ASSIGNMENT' | 'SAME_ASSIGNEE' };
