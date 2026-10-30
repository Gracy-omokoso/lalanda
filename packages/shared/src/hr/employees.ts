// Dossiers collaborateurs, services, organigramme, réglages, « moi » et « mon équipe »
// — corps de requête, requêtes de liste et vues (ADR-0045 § 2.1 à § 2.3, § 3.1, § 4.4).
// ADR-0045 — H2.
//
// Aucune donnée sensible ici : salaire, coordonnées bancaires, identité, coordonnées
// personnelles et motif détaillé de sortie vivent dans `./private.ts` et dans la
// collection `hr_employee_private`. Les règles qui exigent la base (ressource d'une
// autre organisation → 404, membre de l'organisation, cycles, unicité) sont
// vérifiées par l'API ; ici, la FORME seulement.

import { z } from 'zod';

import {
  HrCalendarDay,
  HrExpectedRevision,
  HrId,
  HrWorkPatternSchema,
  hrFr,
  hrIssue,
  hrOptionalText,
  hrRequiredText,
} from './common.js';
import {
  EMPLOYEE_EXIT_CATEGORIES,
  EMPLOYEE_STATUSES,
  HR_CONTRACT_TYPE_KEY_PATTERN,
  HR_LIMITS,
  HR_ORG_CHART_VIEWS,
  HR_PAGE_LIMIT_DEFAULT,
  HR_PAGE_LIMIT_MAX,
  HR_PHONE_PATTERN,
  type EmployeeExitCategory,
  type EmployeeStatus,
  type HrApprovalFlow,
  type HrContractType,
  type HrOrgChartView,
  type HrOrgChartVisibility,
  type HrTeamCalendarVisibility,
  type HrWorkPattern,
} from './constants.js';
import type { EmployeePrivateSummary } from './private.js';
// ADR-0045 — H3 : exceptions d'acquisition, soldes et demandes de « moi » et de l'équipe.
import {
  LeavePolicyOverridesSchema,
  type LeaveBalanceView,
  type LeaveRequestView,
} from './leave.js';

export * from './private.js';

const L = HR_LIMITS;

/** Codes propres au lot H2, en plus de ceux nommés par l'ADR (`HR_ERROR_CODES`). */
export const HR_H2_ERROR_CODES = [
  'EMPLOYEE_NOT_FOUND',
  'EMPLOYEE_NOT_ACTIVE',
  'EMPLOYEE_ALREADY_EXITED',
  'EMPLOYEE_NOT_EXITED',
  'EMPLOYEE_EXIT_PAST',
  'EMPLOYEE_ANONYMIZED',
  'DEPARTMENT_NOT_FOUND',
  'DEPARTMENT_ARCHIVED',
  'CONTRACT_TYPE_UNKNOWN',
  'CONTRACT_END_DATE_REQUIRED',
  'DATE_BEFORE_START',
  'HR_ORG_CHART_HIDDEN',
  'HR_AUDIT_UNAVAILABLE',
  'HR_PRIVATE_UNREADABLE',
] as const;
export type HrH2ErrorCode = (typeof HR_H2_ERROR_CODES)[number];

/** Libellé de poste posé par `from-members` (« poste à compléter », § 3.1). */
export const HR_JOB_TITLE_TO_COMPLETE = 'À compléter';

/** Identifiant d'un compte (better-auth) : chaîne opaque. */
export const HrUserId = z
  .string(hrFr('Identifiant de compte attendu.'))
  .trim()
  .min(1, { message: 'Identifiant de compte attendu.' })
  .max(64, { message: 'Identifiant de compte invalide.' });

const workPhone = hrOptionalText(L.workPhone).superRefine((v, ctx) => {
  if (v !== null && !HR_PHONE_PATTERN.test(v)) {
    hrIssue(ctx, 'PHONE_INVALID', 'Numéro de téléphone invalide.');
  }
});

const workEmail = hrOptionalText(L.workEmail).superRefine((v, ctx) => {
  if (v !== null && !z.email().safeParse(v).success) {
    hrIssue(ctx, 'EMAIL_INVALID', 'Adresse e-mail invalide.');
  }
});

const contractTypeKey = z
  .string(hrFr('Type de contrat attendu.'))
  .refine((v) => HR_CONTRACT_TYPE_KEY_PATTERN.test(v), {
    message: 'Type de contrat invalide.',
    params: { code: 'CONTRACT_TYPE_UNKNOWN' },
  });

// ── Collaborateurs (§ 2.1) ──────────────────────────────────────────────────

const employeeFields = {
  preferredName: hrOptionalText(L.preferredName).optional(),
  employeeNumber: hrOptionalText(L.employeeNumber).optional(),
  userId: HrUserId.nullable().optional(),
  workEmail: workEmail.optional(),
  workPhone: workPhone.optional(),
  departmentId: HrId.nullable().optional(),
  managerEmployeeId: HrId.nullable().optional(),
  probationEndDate: HrCalendarDay.nullable().optional(),
  contractEndDate: HrCalendarDay.nullable().optional(),
  workPattern: HrWorkPatternSchema.nullable().optional(),
  workLocation: hrOptionalText(L.workLocation).optional(),
  notes: hrOptionalText(L.notes).optional(),
};

/** `POST /hr/employees` — `hr.manage`. Rien d'obligatoire au-delà du nom, du poste et de l'entrée. */
export const CreateEmployeeBody = z
  .object({
    firstName: hrRequiredText(L.firstName, 'Prénom'),
    lastName: hrRequiredText(L.lastName, 'Nom'),
    jobTitle: hrRequiredText(L.jobTitle, 'Poste'),
    contractType: contractTypeKey,
    startDate: HrCalendarDay,
    ...employeeFields,
  })
  .strict();
export type CreateEmployeeBody = z.output<typeof CreateEmployeeBody>;

/** `PUT /hr/employees/:id` — `hr.manage`. La cohérence des dates est vérifiée sur la fiche fusionnée. */
export const UpdateEmployeeBody = z
  .object({
    expectedRevision: HrExpectedRevision,
    firstName: hrRequiredText(L.firstName, 'Prénom').optional(),
    lastName: hrRequiredText(L.lastName, 'Nom').optional(),
    jobTitle: hrRequiredText(L.jobTitle, 'Poste').optional(),
    contractType: contractTypeKey.optional(),
    startDate: HrCalendarDay.optional(),
    ...employeeFields,
    // ADR-0045 — H3 : acquisition propre au collaborateur, par type d'absence (§ 2.1).
    leavePolicyOverrides: LeavePolicyOverridesSchema.optional(),
  })
  .strict();
export type UpdateEmployeeBody = z.output<typeof UpdateEmployeeBody>;

/** `POST /hr/employees/from-members` — une fiche par membre choisi, jamais automatique. */
export const CreateEmployeesFromMembersBody = z
  .object({
    userIds: z
      .array(HrUserId)
      .min(1, { message: 'Au moins un membre.' })
      .max(L.fromMembersMax, { message: `${L.fromMembersMax} membres au plus.` })
      .superRefine((list, ctx) => {
        if (new Set(list).size !== list.length) {
          hrIssue(ctx, 'USER_DUPLICATE', 'Un membre n’est choisi qu’une fois.');
        }
      }),
  })
  .strict();
export type CreateEmployeesFromMembersBody = z.output<typeof CreateEmployeesFromMembersBody>;

/** `POST /hr/employees/:id/exit`. Le motif détaillé est sensible (section `exitNote`). */
export const ExitEmployeeBody = z
  .object({
    endDate: HrCalendarDay,
    exitCategory: z.enum(EMPLOYEE_EXIT_CATEGORIES, hrFr('Catégorie de sortie inconnue.')),
    expectedRevision: HrExpectedRevision,
  })
  .strict();
export type ExitEmployeeBody = z.output<typeof ExitEmployeeBody>;

export const EmployeeRevisionBody = z.object({ expectedRevision: HrExpectedRevision }).strict();
export type EmployeeRevisionBody = z.output<typeof EmployeeRevisionBody>;

/** `POST /hr/employees/:id/anonymize` — irréversible, d'où la confirmation explicite. */
export const AnonymizeEmployeeBody = z
  .object({
    confirm: z.literal(true, hrFr('Confirmation explicite attendue (`confirm: true`).')),
    expectedRevision: HrExpectedRevision,
  })
  .strict();
export type AnonymizeEmployeeBody = z.output<typeof AnonymizeEmployeeBody>;

export const ListEmployeesQuery = z
  .object({
    q: z.string().trim().min(1).max(L.search).optional(),
    status: z.enum([...EMPLOYEE_STATUSES, 'all']).default('active'),
    departmentId: HrId.optional(),
    managerId: HrId.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(HR_PAGE_LIMIT_MAX).default(HR_PAGE_LIMIT_DEFAULT),
  })
  .strict();
export type ListEmployeesQuery = z.output<typeof ListEmployeesQuery>;

/** Statut dérivé par le moteur (`employeeStatusOf`), jamais stocké. */
export type HrDerivedEmployeeStatus = 'upcoming' | 'probation' | 'active' | 'exited' | 'anonymized';

/** Fiche non sensible. `notes` est `null` hors détenteurs de `hr.read`. */
export interface EmployeeView {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  /** Nom d'usage, sinon « Prénom Nom ». */
  displayName: string;
  employeeNumber: string | null;
  userId: string | null;
  workEmail: string | null;
  workPhone: string | null;
  jobTitle: string;
  departmentId: string | null;
  /** ADR-0045 — H3 : nom du service (copie d'affichage, lue à la requête). */
  departmentName: string | null;
  managerEmployeeId: string | null;
  /** ADR-0045 — H3 : nom d'usage du manager (copie d'affichage). */
  managerName: string | null;
  contractType: string;
  /** ADR-0045 — H3 : libellé du type de contrat (réglages de l'organisation). */
  contractTypeLabel: string | null;
  startDate: string;
  probationEndDate: string | null;
  contractEndDate: string | null;
  endDate: string | null;
  exitCategory: EmployeeExitCategory | null;
  status: EmployeeStatus;
  derivedStatus: HrDerivedEmployeeStatus;
  workPattern: HrWorkPattern | null;
  workLocation: string | null;
  /** ADR-0045 — H3 : exceptions d'acquisition (`hr.read` seulement, `null` sinon). */
  leavePolicyOverrides: Record<string, { accrual: unknown }> | null;
  notes: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeePage {
  items: EmployeeView[];
  nextCursor: string | null;
}

/** Relation du lecteur à la fiche servie (§ 4.4). */
export type HrViewerRelation = 'hr' | 'self' | 'manager';

/**
 * `GET /hr/employees/:id`. `private` : formes masquées, seulement avec
 * `hr.sensitive.read` ou pour soi ; `null` sinon.
 */
export interface EmployeeDetailView {
  employee: EmployeeView;
  private: EmployeePrivateSummary | null;
  viewer: {
    relation: HrViewerRelation;
    canManage: boolean;
    canSeeSensitive: boolean;
  };
}

/** Réponse de la sortie : la liste de départ est PROPOSÉE (lot H4), l'accès n'est pas retiré. */
export interface EmployeeExitResult {
  employee: EmployeeView;
  offboardingSuggested: boolean;
}

export interface EmployeesFromMembersResult {
  items: EmployeeView[];
}

// ── Services (§ 2.3) ────────────────────────────────────────────────────────

export const CreateDepartmentBody = z
  .object({
    name: hrRequiredText(L.departmentName, 'Nom du service'),
    parentId: HrId.nullable().optional(),
    headEmployeeId: HrId.nullable().optional(),
  })
  .strict();
export type CreateDepartmentBody = z.output<typeof CreateDepartmentBody>;

export const UpdateDepartmentBody = z
  .object({
    expectedRevision: HrExpectedRevision,
    name: hrRequiredText(L.departmentName, 'Nom du service').optional(),
    parentId: HrId.nullable().optional(),
    headEmployeeId: HrId.nullable().optional(),
  })
  .strict();
export type UpdateDepartmentBody = z.output<typeof UpdateDepartmentBody>;

export const DepartmentRevisionBody = z.object({ expectedRevision: HrExpectedRevision }).strict();
export type DepartmentRevisionBody = z.output<typeof DepartmentRevisionBody>;

export const ListDepartmentsQuery = z
  .object({ active: z.enum(['true', 'false', 'all']).default('true') })
  .strict();
export type ListDepartmentsQuery = z.output<typeof ListDepartmentsQuery>;

export interface DepartmentView {
  id: string;
  name: string;
  parentId: string | null;
  headEmployeeId: string | null;
  /** ADR-0045 — H3 : nom d'usage du responsable (copie d'affichage). */
  headName: string | null;
  active: boolean;
  /** Collaborateurs actifs rattachés directement. */
  activeEmployees: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentListView {
  items: DepartmentView[];
}

// ── Organigramme (§ 2.3, § 3.1) ─────────────────────────────────────────────

export const OrgChartQuery = z
  .object({ view: z.enum(HR_ORG_CHART_VIEWS).default('departments') })
  .strict();
export type OrgChartQuery = z.output<typeof OrgChartQuery>;

/** Ce que l'organigramme montre d'une personne : rien d'autre. */
export interface OrgChartPerson {
  displayName: string;
  jobTitle: string;
  departmentId: string | null;
  managerEmployeeId: string | null;
}

export interface OrgChartDepartmentNode {
  departmentId: string;
  name: string;
  headEmployeeId: string | null;
  employeeIds: string[];
  headcount: number;
  totalHeadcount: number;
  children: OrgChartDepartmentNode[];
}

export interface OrgChartReportingNode {
  employeeId: string;
  departmentId: string | null;
  directReports: number;
  totalReports: number;
  children: OrgChartReportingNode[];
}

export type OrgChartView = {
  version: string;
  headcount: number;
  people: Record<string, OrgChartPerson>;
  departments: Record<string, { name: string }>;
} & (
  | { view: 'departments'; roots: OrgChartDepartmentNode[]; unassignedEmployeeIds: string[] }
  | { view: 'reporting'; roots: OrgChartReportingNode[]; cycleBrokenAt: string[] }
);

// ── « Moi », « Mon équipe » (§ 3.1, § 4.4) ──────────────────────────────────

/**
 * `GET /hr/me` (`analytics.read`). `employee` est `null` sans fiche reliée (un membre
 * non salarié). Les soldes, demandes, documents et éléments de liste viennent des
 * lots H3 et H4, qui ajoutent leurs propres routes.
 */
export interface HrMeView {
  employee: EmployeeView | null;
  private: EmployeePrivateSummary | null;
  isManager: boolean;
  /** Manager d'au moins un collaborateur, ou détenteur de `leave.approve`. */
  canApprove: boolean;
  directReportIds: string[];
  teamEmployeeIds: string[];
  orgChartVisible: boolean;
  /** ADR-0045 — H3 : mes soldes (moteur `leaveBalance`), vide sans fiche reliée. */
  balances: LeaveBalanceView[];
  /** ADR-0045 — H3 : mes 50 demandes les plus récentes. */
  requests: LeaveRequestView[];
}

/** Fiche réduite d'un membre de l'équipe (aucune donnée sensible, aucune note). */
export interface HrTeamMemberView {
  id: string;
  displayName: string;
  jobTitle: string;
  departmentId: string | null;
  /** ADR-0045 — H3 : copies d'affichage. */
  departmentName: string | null;
  managerEmployeeId: string | null;
  managerName: string | null;
  isDirect: boolean;
  derivedStatus: HrDerivedEmployeeStatus;
  workEmail: string | null;
  workPhone: string | null;
  /** ADR-0045 — H3 : soldes (moteur) et absences en cours ou à venir (type masqué si confidentiel). */
  balances: LeaveBalanceView[];
  absences: LeaveRequestView[];
}

export interface HrTeamView {
  items: HrTeamMemberView[];
}

// ── Réglages (§ 2.2) — lecture et valeurs par défaut au lot H2 ──────────────

export interface HrSettingsView {
  workPattern: HrWorkPattern;
  leaveYearStart: string;
  approvalFlow: HrApprovalFlow;
  allowSoleApprover: boolean;
  contractTypes: HrContractType[];
  reminders: { probationEnd: number; contractEnd: number; documentExpiry: number };
  teamCalendarVisibility: HrTeamCalendarVisibility;
  orgChartVisibility: HrOrgChartVisibility;
  retention: {
    privateDataMonthsAfterExit: number | null;
    anonymizeYearsAfterExit: number | null;
  };
  /** `0` tant que l'organisation n'a rien enregistré (valeurs par défaut). */
  revision: number;
  isDefault: boolean;
}

export type { HrOrgChartView };
