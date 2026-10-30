// ─────────────────────────────────────────────────────────────────────────────
// Ressources humaines — types (ADR-0045 § 5, § 7)
//
// Module PUR : aucune base, aucun réseau, aucune horloge. Le jour de référence
// est un paramètre, jour civil de Kinshasa déjà calculé par l'appelant
// (ADR-0027). Durées en jours rendues en chaînes décimales (« 3.5 », « 1.03 ») ;
// arithmétique en CENTIÈMES de jour entiers (`bigint`), jamais en flottant.
//
// AUCUNE règle légale (ADR-0045 § 9) : ni droit à congé, ni jour férié, ni durée
// d'essai par défaut. Semaine de travail, fériés, acquisitions, plafonds de
// report : tout vient du paramétrage de l'organisation, passé en entrée.
// ─────────────────────────────────────────────────────────────────────────────

/** Toute évolution d'un calcul de ce module incrémente cette version. */
export const HR_VERSION = '1.0.0';

/** Date civile `AAAA-MM-JJ` (jour de Kinshasa). */
export type HrDay = string;
/** Durée décimale en jours, deux décimales au plus, signée pour le grand livre (« -3.5 »). */
export type HrDays = string;

// ─── Semaine de travail, fériés, demi-journées ───────────────────────────────

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Fraction travaillée d'un jour de la semaine. */
export type WorkFraction = 0 | 0.5 | 1;

/**
 * Jours travaillés `{ mon…sun: 0 | 0.5 | 1 }` (ADR-0045 § 2.1, § 2.2). Aucune
 * valeur par défaut n'est posée par le moteur : l'appelant passe celle du
 * collaborateur, ou à défaut celle de l'organisation.
 */
export type WorkPattern = Readonly<Record<Weekday, WorkFraction>>;

export type HalfDay = 'am' | 'pm';

/** Jour férié ou de fermeture saisi par l'organisation (ADR-0045 § 2.6). */
export interface HolidayInput {
  date: HrDay;
  /** `am` ou `pm` : demi-journée fériée ; `null` : journée entière. */
  halfDay: HalfDay | null;
  /** Même jour (mois et quantième) chaque année. */
  recurring: boolean;
  label?: string;
}

/** Borne d'une absence : `full` = journée entière ; `am`/`pm` = demi-journée (ADR-0045 § 2.7). */
export interface LeaveBound {
  date: HrDay;
  half: 'full' | 'am' | 'pm';
}

export interface LeavePeriod {
  start: LeaveBound;
  end: LeaveBound;
}

export interface LeaveDayDetail {
  date: HrDay;
  /** Jours décomptés ce jour-là (0, 0.5 ou 1). */
  days: HrDays;
  /** Demi-journées couvertes par la demande ce jour-là. */
  halves: HalfDay[];
  /** Le jour est (en tout ou partie) férié. */
  holiday: boolean;
}

export interface LeaveDaysResult {
  version: string;
  /** Total décompté (« 3.5 ») ; « 0 » = aucun jour travaillé (`422 LEAVE_NO_WORKING_DAY`). */
  days: HrDays;
  /** Jours civils couverts, bornes comprises. */
  calendarDays: number;
  perDay: LeaveDayDetail[];
}

/** Nombre maximal de jours civils d'une demande (ADR-0045 § 2.7). */
export const LEAVE_MAX_CALENDAR_DAYS = 366;

// ─── Chevauchements, disponibilité, calendrier d'équipe ─────────────────────

export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequestInput extends LeavePeriod {
  id: string;
  employeeId: string;
  typeId: string;
  status: LeaveRequestStatus;
  /** Jours décomptés à la soumission (`leaveDays`). */
  days: HrDays;
}

export interface LeaveOverlap {
  requestId: string;
  status: 'pending' | 'approved';
  /** Premier et dernier jour civil communs. */
  from: HrDay;
  to: HrDay;
}

export interface LeaveOverlapsResult {
  version: string;
  overlaps: LeaveOverlap[];
}

export interface AvailabilityResult {
  version: string;
  /** Jours travaillés théoriques (semaine de travail, moins fériés). */
  workingDays: HrDays;
  /** Part des jours travaillés couverte par une absence. */
  absentDays: HrDays;
  /** Jours travaillés − absences. */
  availableDays: HrDays;
  perDay: { date: HrDay; working: HrDays; available: HrDays }[];
}

export interface CalendarEmployeeInput {
  id: string;
  departmentId?: string | null;
}

export interface CalendarLeaveTypeInput {
  id: string;
  label: string;
  confidential: boolean;
}

export interface TeamCalendarViewer {
  /** Fiche du lecteur, s'il en a une. */
  selfEmployeeId: string | null;
  /** Collaborateurs dont le lecteur voit les absences (portée, § 4.4). */
  visibleEmployeeIds: readonly string[];
  /** Collaborateurs dont le lecteur voit aussi les demandes en attente (soi, équipe ; tous pour les RH). */
  pendingVisibleEmployeeIds: readonly string[];
  /** `hr.sensitive.read` : voit le type des absences confidentielles. */
  seesConfidential: boolean;
}

export interface TeamCalendarEntry {
  requestId: string;
  employeeId: string;
  status: 'pending' | 'approved';
  /** Bornes ramenées à la fenêtre demandée. */
  start: LeaveBound;
  end: LeaveBound;
  /** `null` si le type est masqué (« Absent »). */
  typeId: string | null;
  /** Libellé du type, ou « Absent » pour un type confidentiel hors ayants droit. */
  label: string;
  masked: boolean;
}

export interface TeamCalendarResult {
  version: string;
  from: HrDay;
  to: HrDay;
  entries: TeamCalendarEntry[];
  /** Par jour de la fenêtre : collaborateurs absents (absences approuvées seulement). */
  days: { date: HrDay; absentEmployeeIds: string[] }[];
  holidays: { date: HrDay; halfDay: HalfDay | null; label: string | null }[];
}

/** Libellé neutre d'un type confidentiel (ADR-0045 § 2.5). */
export const MASKED_LEAVE_LABEL = 'Absent';

// ─── Grand livre et soldes ───────────────────────────────────────────────────

export const LEAVE_LEDGER_KINDS = [
  'accrual',
  'allocation',
  'adjustment',
  'taken',
  'taken_reversal',
  'carry_over',
  'expiry',
] as const;
export type LeaveLedgerKind = (typeof LEAVE_LEDGER_KINDS)[number];

/** Mouvement du grand livre (`hr_leave_ledger`, ajout seul). */
export interface LeaveLedgerEntryInput {
  typeId: string;
  kind: LeaveLedgerKind;
  /** Signé : crédit positif, débit négatif. */
  days: HrDays;
  effectiveOn: HrDay;
  /** Année de congé (année civile de son premier jour). */
  leaveYear: number;
}

/** Demande en attente : elle réserve ses jours. */
export interface PendingLeaveInput {
  typeId: string;
  startDate: HrDay;
  days: HrDays;
}

/** Début de l'année de congé `MM-JJ` (ADR-0045 § 2.2), `02-29` refusé. */
export type LeaveYearStart = string;

export interface LeaveBalance {
  typeId: string;
  leaveYear: number;
  accrued: HrDays;
  allocated: HrDays;
  adjusted: HrDays;
  carriedOver: HrDays;
  expired: HrDays;
  /** Pris (absences approuvées commencées au plus tard à `asOf`), net des annulations. */
  taken: HrDays;
  /** Approuvé, à venir (après `asOf`). */
  upcoming: HrDays;
  /** En attente de validation. */
  pending: HrDays;
  /** acquis + attribué + ajusté + reporté − expiré − pris − à venir − en attente. */
  available: HrDays;
}

export interface LeaveBalancesResult {
  version: string;
  asOf: HrDay;
  leaveYear: number;
  balances: LeaveBalance[];
}

export interface LeaveDebitCheck {
  version: string;
  ok: boolean;
  /** Manque (> 0) si le solde ne suffit pas, « 0 » sinon. */
  shortfall: HrDays;
  /** Disponible après la demande. */
  availableAfter: HrDays;
}

export type LeaveAccrual =
  | { kind: 'none' }
  | { kind: 'monthly'; days: HrDays }
  | { kind: 'yearly'; days: HrDays; on: 'leave_year_start' | 'anniversary' };

export interface LeaveTypePolicyInput {
  id: string;
  accrual: LeaveAccrual;
  /** Défaut `calendar_days`. */
  proration?: 'calendar_days' | 'none';
  carryOver?: { maxDays: HrDays | null; expiresAfterMonths: number | null };
}

export interface AccrualEmployeeInput {
  startDate: HrDay;
  endDate?: HrDay | null;
  /** Acquisition propre au collaborateur, par type (ADR-0045 § 2.1). */
  leavePolicyOverrides?: Readonly<Record<string, { accrual: LeaveAccrual }>> | null;
}

export interface AccrualDue {
  /** `AAAA-MM` (mensuelle) ou `AAAA-MM-JJ` (premier jour de la période annuelle). */
  period: string;
  periodStart: HrDay;
  periodEnd: HrDay;
  /** Jour d'effet de l'écriture `accrual`. */
  effectiveOn: HrDay;
  leaveYear: number;
  days: HrDays;
  /** Jours civils d'activité dans la période. */
  activeDays: number;
  periodDays: number;
}

export interface AccrualsDueResult {
  version: string;
  typeId: string;
  entries: AccrualDue[];
}

export interface CarryOverResult {
  version: string;
  typeId: string;
  /** Année de congé qui reçoit le report. */
  leaveYear: number;
  /** Écriture `carry_over` de l'année (négative si un solde négatif est reporté). */
  carried: HrDays;
  /** Part non reportée (au-delà du plafond) : perdue, rendue pour information. */
  lapsed: HrDays;
  /** Jour où le reporté non pris expire ; `null` = jamais. */
  expiresOn: HrDay | null;
}

export interface CarryOverExpiryResult {
  version: string;
  typeId: string;
  leaveYear: number;
  /** `false` tant que `asOf` précède `expiresOn` (ou sans expiration). */
  due: boolean;
  expiresOn: HrDay | null;
  /** Montant positif de l'écriture `expiry` à passer (débit), « 0 » si rien. */
  expired: HrDays;
}

// ─── Circuit, structure, portée ──────────────────────────────────────────────

export type ApprovalFlow = 'manager_only' | 'manager_then_hr' | 'hr_only';
export type LeaveApprovalStep = 'manager' | 'hr';

export interface LeaveApprovalStepsResult {
  version: string;
  steps: LeaveApprovalStep[];
  /** Raison du remplacement de l'étape `manager` par `hr`, sinon `null`. */
  managerReplacedBy:
    null | 'NO_MANAGER' | 'MANAGER_WITHOUT_ACCOUNT' | 'CONFIDENTIAL_TYPE' | 'HR_ONLY_FLOW';
}

export type EmployeeStatus = 'active' | 'exited' | 'anonymized';

/**
 * Collaborateur tel que les calculs RH le lisent — jamais de donnée sensible
 * (ADR-0045 § 2.1). Chaque fonction n'en lit que les champs dont elle a besoin.
 */
export interface HrEmployeeInput {
  id: string;
  userId?: string | null;
  status: EmployeeStatus;
  startDate: HrDay;
  /** Dernier jour d'emploi (inclus), posé par la sortie. */
  endDate?: HrDay | null;
  probationEndDate?: HrDay | null;
  contractEndDate?: HrDay | null;
  contractType?: string | null;
  departmentId?: string | null;
  managerEmployeeId?: string | null;
  workPattern?: WorkPattern | null;
  exitCategory?: ExitCategory | null;
  /** Clé de tri (nom normalisé) ; à défaut, l'identifiant. */
  sortName?: string | null;
}

export const EXIT_CATEGORIES = [
  'resignation',
  'end_of_contract',
  'dismissal',
  'mutual_agreement',
  'retirement',
  'death',
  'other',
] as const;
export type ExitCategory = (typeof EXIT_CATEGORIES)[number];

/** Statut dérivé, jamais stocké (ADR-0045 § 2.1). */
export type DerivedEmployeeStatus = 'upcoming' | 'probation' | 'active' | 'exited' | 'anonymized';

export interface DepartmentInput {
  id: string;
  name: string;
  parentId: string | null;
  headEmployeeId?: string | null;
  active: boolean;
}

/** Profondeur maximale de l'arbre des services (ADR-0045 § 2.3). */
export const DEPARTMENT_MAX_DEPTH = 8;
/** Profondeur maximale de l'équipe (subordonnés indirects) d'une portée (ADR-0045 § 4.4). */
export const TEAM_MAX_DEPTH = 10;

export interface ReportingCycleResult {
  version: string;
  cycle: boolean;
}

export interface DepartmentCycleResult {
  version: string;
  cycle: boolean;
  /** Profondeur de l'arbre après le déplacement (racine = 1). */
  depth: number;
  tooDeep: boolean;
}

export interface DepartmentChartNode {
  departmentId: string;
  name: string;
  headEmployeeId: string | null;
  /** Collaborateurs actifs rattachés directement. */
  employeeIds: string[];
  headcount: number;
  /** Effectif du service et de ses sous-services. */
  totalHeadcount: number;
  children: DepartmentChartNode[];
}

export interface ReportingChartNode {
  employeeId: string;
  departmentId: string | null;
  directReports: number;
  totalReports: number;
  children: ReportingChartNode[];
}

export type OrgChartResult =
  | {
      version: string;
      view: 'departments';
      roots: DepartmentChartNode[];
      /** Collaborateurs actifs sans service actif. */
      unassignedEmployeeIds: string[];
      headcount: number;
    }
  | {
      version: string;
      view: 'reporting';
      roots: ReportingChartNode[];
      headcount: number;
      /** Collaborateurs pris dans un cycle existant, rendus comme racines. */
      cycleBrokenAt: string[];
    };

export interface HrViewerSettings {
  teamCalendarVisibility: 'department' | 'organization' | 'managers_and_hr';
  orgChartVisibility: 'members' | 'hr_only';
}

export interface HrViewerScope {
  version: string;
  selfEmployeeId: string | null;
  directReportIds: string[];
  /** Subordonnés directs et indirects (profondeur ≤ 10). */
  teamEmployeeIds: string[];
  /** Collègues actifs du même service (soi exclu). */
  departmentEmployeeIds: string[];
  /** `hr.read`. */
  seesAll: boolean;
  /** `hr.sensitive.read`. */
  seesConfidential: boolean;
  /** `leave.approve`. */
  holdsLeaveApprove: boolean;
  isManager: boolean;
  /** Collaborateurs dont le calendrier des absences est visible (soi compris). */
  calendarEmployeeIds: string[];
  /** Collaborateurs dont les demandes en attente sont visibles. */
  pendingVisibleEmployeeIds: string[];
  orgChartVisible: boolean;
}

// ─── Rapports et échéances ───────────────────────────────────────────────────

export interface CountByKey {
  /** `null` : sans service, sans type de contrat. */
  key: string | null;
  count: number;
}

export interface HeadcountResult {
  version: string;
  asOf: HrDay;
  groupBy: 'none' | 'department' | 'contract_type';
  total: number;
  groups: CountByKey[];
}

export interface MovementsResult {
  version: string;
  from: HrDay;
  to: HrDay;
  entries: number;
  exits: number;
  exitsByCategory: { category: ExitCategory | null; count: number }[];
  /** Effectif moyen de la période (Σ effectifs quotidiens ÷ jours), deux décimales. */
  averageHeadcount: HrDays;
  /** Sorties ÷ effectif moyen, en pour cent, deux décimales ; `null` si effectif moyen nul. */
  exitRatePercent: string | null;
}

export interface AbsenteeismTypeInput {
  id: string;
  countsAsAbsenteeism: boolean;
}

export interface AbsenteeismGroup {
  departmentId: string | null;
  employees: number;
  theoreticalDays: HrDays;
  absenceDays: HrDays;
  /** `null` si aucun jour travaillé théorique. */
  ratePercent: string | null;
}

export interface AbsenteeismResult {
  version: string;
  from: HrDay;
  to: HrDay;
  /** Par service — jamais par personne (ADR-0045 § 7). */
  groups: AbsenteeismGroup[];
  total: Omit<AbsenteeismGroup, 'departmentId'>;
}

export const SENIORITY_BUCKETS = ['lt1', '1to3', '3to5', '5to10', 'gte10'] as const;
export type SeniorityBucket = (typeof SENIORITY_BUCKETS)[number];

export interface SeniorityResult {
  version: string;
  asOf: HrDay;
  total: number;
  buckets: { bucket: SeniorityBucket; count: number }[];
}

export interface DeadlineHorizons {
  /** Jours d'avance, 0 à 120 (ADR-0045 § 2.2). */
  probationEnd: number;
  contractEnd: number;
  documentExpiry: number;
}

export interface DeadlineDocumentInput {
  id: string;
  employeeId: string;
  expiresOn: HrDay | null;
  deleted?: boolean;
}

export interface IdExpiryInput {
  employeeId: string;
  kind: string;
  expiresOn: HrDay;
}

export type HrDeadlineKind = 'probation_end' | 'contract_end' | 'document_expiry' | 'id_expiry';

export interface HrDeadline {
  kind: HrDeadlineKind;
  employeeId: string;
  date: HrDay;
  daysLeft: number;
  /** Document concerné (`document_expiry`). */
  documentId: string | null;
  /** Nature de la pièce (`id_expiry`), jamais son numéro. */
  idKind: string | null;
  /** Clé de dédoublonnage : collaborateur + nature + date (+ document ou pièce). */
  dedupeKey: string;
}

export interface HrDeadlinesResult {
  version: string;
  today: HrDay;
  deadlines: HrDeadline[];
  counts: Record<HrDeadlineKind, number>;
  total: number;
}

/** Bornes des délais de rappel (ADR-0045 § 2.2). */
export const REMINDER_DAYS_BOUNDS = { min: 0, max: 120 } as const;

// ─── Feuille de temps ────────────────────────────────────────────────────────

export interface TimesheetEntryInput {
  projectId: string;
  workedOn: HrDay;
  /** Entier ≥ 0. */
  minutes: number;
}

export type TimesheetFindingCode = 'TIME_ON_LEAVE_DAY' | 'NO_TIME_ON_WORKING_DAY';

export interface TimesheetDay {
  date: HrDay;
  weekday: Weekday;
  /** Fraction travaillée de la semaine de travail, avant fériés et absences. */
  scheduled: HrDays;
  holiday: HalfDay | 'full' | null;
  /** Demi-journées d'absence approuvée. */
  absence: HalfDay | 'full' | null;
  /** Fraction travaillée restante (fériés et absences déduits). */
  expected: HrDays;
  totalMinutes: number;
}

export interface WeeklyTimesheetResult {
  version: string;
  /** Lundi de la semaine. */
  week: HrDay;
  days: TimesheetDay[];
  projects: { projectId: string; minutesByDay: number[]; totalMinutes: number }[];
  totalMinutes: number;
  findings: { code: TimesheetFindingCode; date: HrDay; minutes: number }[];
}
