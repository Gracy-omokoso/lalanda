// Constantes des ressources humaines (ADR-0045 § 1, § 2 et § 4). ADR-0045 — H0.
//
// Libellé d'interface ↔ code (ADR-0045 § 1) : « Collaborateur » = `Employee`,
// « Données sensibles » = `EmployeePrivate`, « Service » = `Department`,
// « Type d'absence » = `LeaveType`, « Jour férié ou de fermeture » = `Holiday`,
// « Demande d'absence » = `LeaveRequest`, « Mouvement de solde » = `LeaveLedgerEntry`,
// « Document RH » = `HrDocument`, « Liste d'entrée ou de sortie » = `Checklist`.
//
// Ce fichier ne contient que des unions fermées, des bornes, des valeurs par défaut et
// des codes : AUCUNE règle de droit du travail (ADR-0045 § 9). Aucun droit à congé,
// aucune durée d'essai, de préavis ou de conservation n'est posé par Lalanda ; tout
// est paramétré par l'organisation. Les calculs (jours décomptés, soldes, acquisitions,
// organigramme, portée) appartiennent au moteur `@lalanda/engine` (`hr`, lot H1).

/** Devises d'un salaire déclaré (§ 1) : celles de la trésorerie, jamais converties. */
export const HR_CURRENCIES = ['CDF', 'USD'] as const;
export type HrCurrency = (typeof HR_CURRENCIES)[number];

// ── Collaborateurs (§ 2.1) ──────────────────────────────────────────────────

/**
 * Statut STOCKÉ d'une fiche. « À venir » (date d'entrée future) et « en période
 * d'essai » sont DÉRIVÉS par le moteur, jamais stockés.
 */
export const EMPLOYEE_STATUSES = ['active', 'exited', 'anonymized'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/** Catégorie de sortie (rapports). Le commentaire détaillé est sensible (§ 2.4). */
export const EMPLOYEE_EXIT_CATEGORIES = [
  'resignation',
  'end_of_contract',
  'dismissal',
  'mutual_agreement',
  'retirement',
  'death',
  'other',
] as const;
export type EmployeeExitCategory = (typeof EMPLOYEE_EXIT_CATEGORIES)[number];

/** Jours de la semaine d'un rythme de travail (`workPattern`), lundi d'abord. */
export const HR_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type HrWeekday = (typeof HR_WEEKDAYS)[number];

/** Fraction travaillée d'un jour : non travaillé, demi-journée, journée. */
export const HR_WORK_FRACTIONS = [0, 0.5, 1] as const;
export type HrWorkFraction = (typeof HR_WORK_FRACTIONS)[number];

export type HrWorkPattern = Readonly<Record<HrWeekday, HrWorkFraction>>;

// ── Réglages (§ 2.2) ────────────────────────────────────────────────────────

/** Circuit de validation des absences (décision ouverte n° 6). */
export const HR_APPROVAL_FLOWS = ['manager_only', 'manager_then_hr', 'hr_only'] as const;
export type HrApprovalFlow = (typeof HR_APPROVAL_FLOWS)[number];

/** Visibilité du calendrier d'équipe (décision ouverte n° 8). */
export const HR_TEAM_CALENDAR_VISIBILITIES = [
  'department',
  'organization',
  'managers_and_hr',
] as const;
export type HrTeamCalendarVisibility = (typeof HR_TEAM_CALENDAR_VISIBILITIES)[number];

/** Visibilité de l'organigramme (décision ouverte n° 9). */
export const HR_ORG_CHART_VISIBILITIES = ['members', 'hr_only'] as const;
export type HrOrgChartVisibility = (typeof HR_ORG_CHART_VISIBILITIES)[number];

/** Type de contrat de l'organisation : libellé modifiable, AUCUN effet légal calculé. */
export interface HrContractType {
  readonly key: string;
  readonly label: string;
  /** Une date de fin est alors requise sur la fiche (cohérence de donnée, pas règle légale). */
  readonly hasEndDate: boolean;
  readonly active: boolean;
}

/**
 * Types de contrat proposés à l'activation (§ 2.2) : modifiables, sans portée légale.
 */
export const HR_DEFAULT_CONTRACT_TYPES: readonly HrContractType[] = Object.freeze([
  Object.freeze({ key: 'permanent', label: 'CDI', hasEndDate: false, active: true }),
  Object.freeze({ key: 'fixed_term', label: 'CDD', hasEndDate: true, active: true }),
  Object.freeze({ key: 'internship', label: 'Stage', hasEndDate: true, active: true }),
  Object.freeze({ key: 'freelance', label: 'Prestataire', hasEndDate: false, active: true }),
  Object.freeze({ key: 'daily', label: 'Journalier', hasEndDate: false, active: true }),
  Object.freeze({ key: 'other', label: 'Autre', hasEndDate: false, active: true }),
]);

/**
 * Valeurs par défaut de `hr_settings`, appliquées tant que la dirigeante ne tranche
 * pas autrement (décisions ouvertes n° 5, 6, 8, 9, 11 et 14) : lundi à vendredi, année
 * de congé civile, manager seul, approbateur unique permis, rappels 15 / 30 / 30
 * jours, calendrier par service, organigramme ouvert aux membres reliés, AUCUNE purge.
 */
export const HR_SETTINGS_DEFAULTS = Object.freeze({
  workPattern: Object.freeze({
    mon: 1,
    tue: 1,
    wed: 1,
    thu: 1,
    fri: 1,
    sat: 0,
    sun: 0,
  }) as HrWorkPattern,
  leaveYearStart: '01-01',
  approvalFlow: 'manager_only' as HrApprovalFlow,
  allowSoleApprover: true,
  contractTypes: HR_DEFAULT_CONTRACT_TYPES,
  reminders: Object.freeze({ probationEnd: 15, contractEnd: 30, documentExpiry: 30 }),
  teamCalendarVisibility: 'department' as HrTeamCalendarVisibility,
  orgChartVisibility: 'members' as HrOrgChartVisibility,
  retention: Object.freeze({
    privateDataMonthsAfterExit: null as number | null,
    anonymizeYearsAfterExit: null as number | null,
  }),
});

// ── Données sensibles (§ 2.4) ───────────────────────────────────────────────

/** Sections chiffrées de `hr_employee_private`, chacune lisible seulement au `reveal`. */
export const HR_PRIVATE_SECTIONS = [
  'compensation',
  'bankDetails',
  'identity',
  'personalContact',
] as const;
export type HrPrivateSection = (typeof HR_PRIVATE_SECTIONS)[number];

/** Période d'un salaire de base DÉCLARÉ (jamais calculé). */
export const HR_COMPENSATION_PERIODS = ['month', 'day', 'hour'] as const;
export type HrCompensationPeriod = (typeof HR_COMPENSATION_PERIODS)[number];

/** Nature d'un moyen de paiement du collaborateur. */
export const HR_BANK_DETAIL_KINDS = ['bank', 'mobile_money'] as const;
export type HrBankDetailKind = (typeof HR_BANK_DETAIL_KINDS)[number];

/** Nature d'une pièce d'identité (numéro chiffré ; type et expiration en clair). */
export const HR_ID_DOCUMENT_KINDS = [
  'national_id',
  'passport',
  'voter_card',
  'residence_permit',
  'other',
] as const;
export type HrIdDocumentKind = (typeof HR_ID_DOCUMENT_KINDS)[number];

// ── Types d'absence (§ 2.5) ─────────────────────────────────────────────────

/** Granularité minimale d'une demande. */
export const LEAVE_UNITS = ['day', 'half_day'] as const;
export type LeaveUnit = (typeof LEAVE_UNITS)[number];

/** Nature d'une acquisition ; défaut `none` (décision ouverte n° 7). */
export const LEAVE_ACCRUAL_KINDS = ['none', 'monthly', 'yearly'] as const;
export type LeaveAccrualKind = (typeof LEAVE_ACCRUAL_KINDS)[number];

/** Date d'acquisition annuelle : début de l'année de congé, ou anniversaire d'entrée. */
export const LEAVE_YEARLY_ACCRUAL_ON = ['leave_year_start', 'anniversary'] as const;
export type LeaveYearlyAccrualOn = (typeof LEAVE_YEARLY_ACCRUAL_ON)[number];

/** Prorata d'acquisition ; défaut `calendar_days`. */
export const LEAVE_PRORATIONS = ['calendar_days', 'none'] as const;
export type LeaveProration = (typeof LEAVE_PRORATIONS)[number];

/**
 * Types créés à l'activation (§ 2.5), modifiables, AUCUN droit chiffré : aucun
 * n'acquiert de jours (`accrual: none`, critère 21).
 */
export const HR_DEFAULT_LEAVE_TYPES = Object.freeze([
  Object.freeze({
    key: 'paid_leave',
    label: 'Congés',
    deductsFromBalance: true,
    confidential: false,
    hrOnly: false,
    countsAsAbsenteeism: false,
  }),
  Object.freeze({
    key: 'sick_leave',
    label: 'Maladie',
    deductsFromBalance: false,
    confidential: true,
    hrOnly: false,
    countsAsAbsenteeism: true,
  }),
  Object.freeze({
    key: 'authorized_absence',
    label: 'Absence autorisée',
    deductsFromBalance: false,
    confidential: false,
    hrOnly: false,
    countsAsAbsenteeism: true,
  }),
  Object.freeze({
    key: 'unjustified_absence',
    label: 'Absence non justifiée',
    deductsFromBalance: false,
    confidential: false,
    // Saisie par les RH seulement (§ 2.5).
    hrOnly: true,
    countsAsAbsenteeism: true,
  }),
]);

/** Libellé d'un type confidentiel hors ayants droit (calendrier, manager, projets, brief). */
export const HR_CONFIDENTIAL_LEAVE_LABEL = 'Absent';

// ── Jours fériés (§ 2.6) ────────────────────────────────────────────────────

/** Demi-journée fériée : matin, après-midi (`null` = journée entière). */
export const HR_HOLIDAY_HALVES = ['am', 'pm'] as const;
export type HrHolidayHalf = (typeof HR_HOLIDAY_HALVES)[number];

// ── Demandes et grand livre (§ 2.7) ─────────────────────────────────────────

/** Borne d'une demande : journée entière, matin ou après-midi. */
export const LEAVE_HALVES = ['full', 'am', 'pm'] as const;
export type LeaveHalf = (typeof LEAVE_HALVES)[number];

export const LEAVE_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

/** Étapes du circuit, figées à la soumission par le moteur (`leaveApprovalSteps`). */
export const LEAVE_APPROVAL_STEPS = ['manager', 'hr'] as const;
export type LeaveApprovalStepKey = (typeof LEAVE_APPROVAL_STEPS)[number];

export const LEAVE_APPROVAL_DECISIONS = ['approved', 'rejected'] as const;
export type LeaveApprovalDecisionValue = (typeof LEAVE_APPROVAL_DECISIONS)[number];

/** Nature d'un mouvement du grand livre (ajout seul, jamais modifié). */
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

/** Mouvements saisis à la main (`POST /hr/leave-ledger`, `hr.manage`, note obligatoire). */
export const LEAVE_MANUAL_LEDGER_KINDS = ['allocation', 'adjustment'] as const;
export type LeaveManualLedgerKind = (typeof LEAVE_MANUAL_LEDGER_KINDS)[number];

// ── Documents (§ 2.8) ───────────────────────────────────────────────────────

export const HR_DOCUMENT_CATEGORIES = [
  'contract',
  'amendment',
  'id_document',
  'diploma',
  'medical',
  'leave_justification',
  'onboarding',
  'other',
] as const;
export type HrDocumentCategory = (typeof HR_DOCUMENT_CATEGORIES)[number];

/** Catégories toujours sensibles (`sensitive` imposé vrai, chiffrées côté application). */
export const HR_SENSITIVE_DOCUMENT_CATEGORIES: readonly HrDocumentCategory[] = Object.freeze([
  'id_document',
  'medical',
  'leave_justification',
]);

/** Catégories visibles du collaborateur par défaut (`visibleToEmployee`). */
export const HR_EMPLOYEE_VISIBLE_DOCUMENT_CATEGORIES: readonly HrDocumentCategory[] = Object.freeze(
  ['contract', 'amendment', 'onboarding'],
);

// ── Listes d'entrée et de sortie (§ 2.9) ────────────────────────────────────

export const HR_CHECKLIST_KINDS = ['onboarding', 'offboarding'] as const;
export type HrChecklistKind = (typeof HR_CHECKLIST_KINDS)[number];

/** Assigné symbolique d'un élément de modèle (`{ userId }` pour une personne nommée). */
export const HR_CHECKLIST_ASSIGNEE_ROLES = ['hr', 'manager', 'employee'] as const;
export type HrChecklistAssigneeRole = (typeof HR_CHECKLIST_ASSIGNEE_ROLES)[number];

// ── Vues (§ 3) ──────────────────────────────────────────────────────────────

export const HR_ORG_CHART_VIEWS = ['departments', 'reporting'] as const;
export type HrOrgChartView = (typeof HR_ORG_CHART_VIEWS)[number];

export const HR_CALENDAR_SCOPES = ['me', 'team', 'department', 'organization'] as const;
export type HrCalendarScope = (typeof HR_CALENDAR_SCOPES)[number];

// ── Bornes techniques (§ 2) ─────────────────────────────────────────────────

export const HR_LIMITS = Object.freeze({
  // Fiche (§ 2.1) ; coordonnées professionnelles : bornes de la fiche client.
  firstName: 100,
  lastName: 100,
  preferredName: 100,
  employeeNumber: 30,
  jobTitle: 120,
  workLocation: 120,
  workEmail: 254,
  workPhone: 30,
  notes: 2_000,
  search: 100,
  fromMembersMax: 100,
  // Réglages (§ 2.2).
  contractTypesMin: 1,
  contractTypesMax: 20,
  contractTypeKey: 40,
  contractTypeLabel: 60,
  reminderDaysMax: 120,
  retentionMonthsMax: 600,
  retentionYearsMax: 50,
  // Services (§ 2.3).
  departmentName: 120,
  departmentDepthMax: 8,
  // Données sensibles (§ 2.4).
  compensationHistoryMax: 50,
  compensationNote: 500,
  bankDetailsMax: 3,
  bankName: 120,
  holderName: 120,
  accountNumber: 40,
  iban: 34,
  swift: 11,
  mobileOperator: 60,
  nationality: 60,
  idDocumentsMax: 5,
  idDocumentNumber: 60,
  address: 255,
  emergencyContactsMax: 3,
  emergencyContactName: 120,
  emergencyContactRelation: 60,
  exitNote: 2_000,
  revealsPerHour: 30,
  bankDetailsAlertDays: 7,
  // Types d'absence (§ 2.5).
  leaveTypeLabel: 60,
  accrualDaysMax: 60,
  carryOverMaxDays: 365,
  carryOverExpiresAfterMonthsMax: 36,
  // Jours fériés (§ 2.6).
  holidayLabel: 80,
  // Demandes (§ 2.7).
  leaveCalendarDaysMax: 366,
  leaveReason: 500,
  leaveComment: 2_000,
  ledgerNote: 500,
  // Documents (§ 2.8).
  documentLabel: 120,
  documentImageMaxBytes: 2 * 1024 * 1024,
  documentPdfMaxBytes: 10 * 1024 * 1024,
  documentUploadsPerHour: 30,
  // Listes (§ 2.9).
  checklistTemplateLabel: 120,
  checklistItemsMin: 1,
  checklistItemsMax: 50,
  checklistItemLabel: 200,
  checklistItemNote: 500,
  checklistOffsetDaysMax: 90,
  // Hiérarchie (§ 4.4).
  teamDepthMax: 10,
  // « Mes tâches » (§ 6.1).
  agendaItemsMax: 200,
});

/** Pagination par curseur des listes (motif de `time-cursor.ts`). */
export const HR_PAGE_LIMIT_DEFAULT = 50;
export const HR_PAGE_LIMIT_MAX = 100;

/** Motif de téléphone de la fiche client (`sales.dto.ts`, `crm.dto.ts`). */
export const HR_PHONE_PATTERN = /^\+?[0-9][0-9 .-]{6,19}$/;

/** Clé d'un type de contrat (`hr_settings.contractTypes[].key`). */
export const HR_CONTRACT_TYPE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Clé d'unicité du matricule : majuscules, sans espace ni tiret (« ab-01 » et « AB 01 »
 * sont un même matricule, `409 EMPLOYEE_NUMBER_EXISTS`).
 */
export function employeeNumberKey(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, '');
}

// ── Codes stables (le web les traduit, les tests les citent) ────────────────

/**
 * Codes d'erreur NOMMÉS par l'ADR. Un lot qui a besoin d'un code de plus le déclare
 * dans son propre fichier (zones de conflit : on n'écrit pas dans le fichier d'un
 * autre lot).
 */
export const HR_ERROR_CODES = [
  'STALE_REVISION',
  'SECRETS_NOT_CONFIGURED',
  // Collaborateurs (§ 2.1, § 4.5).
  'EMPLOYEE_NUMBER_EXISTS',
  'EMPLOYEE_USER_NOT_MEMBER',
  'EMPLOYEE_USER_ALREADY_LINKED',
  'EMPLOYEE_NOT_LINKED',
  'MANAGER_CYCLE',
  // Services (§ 2.3).
  'DEPARTMENT_NAME_EXISTS',
  'DEPARTMENT_CYCLE',
  'DEPARTMENT_TOO_DEEP',
  'DEPARTMENT_IN_USE',
  // Données sensibles (§ 2.4).
  'HR_REVEAL_RATE_LIMITED',
  // Absences (§ 2.5, § 2.7, § 4.3).
  'LEAVE_NO_WORKING_DAY',
  'LEAVE_BALANCE_INSUFFICIENT',
  'LEAVE_OVERLAP',
  'SELF_APPROVAL_FORBIDDEN',
  'LEAVE_NOT_YOUR_STEP',
  'APPROVER_ALREADY_APPROVED',
  // Documents (§ 2.8).
  'HR_DOCUMENT_TYPE',
] as const;
export type HrErrorCode = (typeof HR_ERROR_CODES)[number];

/**
 * Constats d'information nommés par l'ADR (§ 6.2, § 6.3) : rien n'est refusé ni
 * corrigé seul ; l'écran les montre.
 */
export const HR_FINDING_CODES = [
  'ASSIGNEE_ABSENT_ON_DUE_DATE',
  'TIME_ON_LEAVE_DAY',
  'NO_TIME_ON_WORKING_DAY',
  'PERSONNEL_EXPENSES_AND_TIME_COST',
] as const;
export type HrFindingCode = (typeof HR_FINDING_CODES)[number];

/**
 * Événements d'audit nommés par l'ADR. Ceux du `reveal`, des changements de données
 * sensibles et du téléchargement d'un document sensible sont STRICTS (écrits avant la
 * réponse : sans trace, rien n'est servi).
 */
export const HR_AUDIT_EVENTS = [
  'hr.private.revealed',
  'hr.private.changed',
  'hr.document.downloaded',
  'hr.leave_balance.adjusted',
  'hr.register.exported',
] as const;
export type HrAuditEvent = (typeof HR_AUDIT_EVENTS)[number];
