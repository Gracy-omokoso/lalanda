// Client de l'API des ressources humaines — ADR-0045 § 3 (lot H6).
//
// Fichier voisin de `api.ts` (même `jsonRequest`, mêmes erreurs). AUCUN calcul
// n'est fait ici : jours décomptés, soldes, portée et organigramme viennent de
// l'API (moteur `@lalanda/engine`, module `hr`), les durées en chaînes décimales.
//
// Contrats : les unions fermées et les bornes viennent de `@lalanda/shared/hr`
// (lot H0). Les VUES (fiche, « moi », équipe, demandes, calendrier, organigramme)
// n'ont pas encore de contrat partagé : elles recopient l'ADR (§ 2, § 3, § 7) au
// plus près et seront remplacées par les contrats des lots H2 et H3 à leur fusion.
// Tant qu'une route n'existe pas, l'API répond 404 : les écrans le disent, rien
// n'est inventé.
//
// Ce lot ne lit AUCUNE donnée sensible (§ 2.4) : ni `…/private`, ni `reveal`, ni
// documents. Ces routes appartiennent au lot H7 (`api-hr-admin.ts`).

import type {
  EmployeeExitCategory,
  EmployeeStatus,
  HrCalendarScope,
  HrOrgChartView,
  LeaveApprovalDecisionValue,
  LeaveApprovalStepKey,
  LeaveHalf,
  LeaveRequestStatus,
  LeaveUnit,
} from '@lalanda/shared/hr';

import { jsonRequest, salesQuery } from './api';

export type {
  EmployeeStatus,
  HrCalendarScope,
  HrOrgChartView,
  LeaveHalf,
  LeaveRequestStatus,
  LeaveUnit,
} from '@lalanda/shared/hr';

/** Durée en jours, chaîne décimale rendue par l'API (`"2.50"`). */
type DaysString = string;
/** Date civile `AAAA-MM-JJ` au jour de Kinshasa. */
type CalendarDay = string;

// ─── Collaborateurs (§ 2.1, § 3.1) — contrat du lot H2 ──────────────────────

/** Ligne de la liste des collaborateurs : aucune donnée sensible. */
export interface HrEmployeeListItem {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  employeeNumber: string | null;
  jobTitle: string;
  departmentId: string | null;
  /** Copie d'affichage du nom du service, si l'API la sert. */
  departmentName?: string | null;
  managerEmployeeId: string | null;
  /** Copie d'affichage du nom du manager, si l'API la sert. */
  managerName?: string | null;
  contractType: string;
  /** Copie d'affichage du libellé du type de contrat, si l'API la sert. */
  contractTypeLabel?: string | null;
  startDate: CalendarDay;
  endDate: CalendarDay | null;
  status: EmployeeStatus;
  /** Statut dérivé par le moteur (« à venir », « en période d'essai »), si servi. */
  upcoming?: boolean;
  onProbation?: boolean;
  userId: string | null;
  workEmail: string | null;
  workPhone: string | null;
  workLocation: string | null;
}

/** Fiche (dossier non sensible). */
export interface HrEmployeeView extends HrEmployeeListItem {
  probationEndDate: CalendarDay | null;
  contractEndDate: CalendarDay | null;
  exitCategory: EmployeeExitCategory | null;
  notes: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface HrEmployeePage {
  items: HrEmployeeListItem[];
  nextCursor: string | null;
}

export interface ListEmployeesParams {
  q?: string;
  status?: EmployeeStatus;
  departmentId?: string;
  managerId?: string;
  cursor?: string;
  limit?: number;
}

/** Corps de création et de modification d'une fiche (forme d'entrée du web). */
export interface HrEmployeeInput {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  employeeNumber?: string | null;
  jobTitle: string;
  departmentId?: string | null;
  managerEmployeeId?: string | null;
  contractType: string;
  startDate: CalendarDay;
  probationEndDate?: CalendarDay | null;
  contractEndDate?: CalendarDay | null;
  workEmail?: string | null;
  workPhone?: string | null;
  workLocation?: string | null;
  notes?: string | null;
  userId?: string | null;
}

export interface HrEmployeeUpdateInput extends HrEmployeeInput {
  expectedRevision: number;
}

// ─── Services (§ 2.3) — contrat du lot H2 ───────────────────────────────────

export interface HrDepartmentView {
  id: string;
  name: string;
  parentId: string | null;
  headEmployeeId: string | null;
  /** Copie d'affichage du nom du responsable, si l'API la sert. */
  headName?: string | null;
  active: boolean;
  revision: number;
}

export interface HrDepartmentInput {
  name: string;
  parentId?: string | null;
  headEmployeeId?: string | null;
}

// ─── Réglages lus par les écrans (§ 2.2) ────────────────────────────────────

export interface HrSettingsContractType {
  key: string;
  label: string;
  hasEndDate: boolean;
  active: boolean;
}

/** Ce que les écrans de ce lot lisent des réglages (`GET /hr/settings`, `hr.read`). */
export interface HrSettingsView {
  contractTypes: HrSettingsContractType[];
  teamCalendarVisibility: 'department' | 'organization' | 'managers_and_hr';
  orgChartVisibility: 'members' | 'hr_only';
}

// ─── Absences (§ 2.5, § 2.7, § 3.2) — contrat du lot H3 ─────────────────────

/** Type d'absence lisible par tout membre : nom, unité, confidentialité. */
export interface LeaveTypeView {
  id: string;
  label: string;
  unit: LeaveUnit;
  confidential: boolean;
  deductsFromBalance?: boolean;
  requiresDocument?: boolean;
  /** Saisi par les RH seulement (« Absence non justifiée »), si l'API le dit. */
  hrOnly?: boolean;
  active: boolean;
}

export interface LeaveBoundView {
  date: CalendarDay;
  half: LeaveHalf;
}

export interface LeaveApprovalView {
  step: LeaveApprovalStepKey;
  userId: string;
  /** Copie d'affichage du nom de l'approbateur, si l'API la sert. */
  userName?: string | null;
  decision: LeaveApprovalDecisionValue;
  at: string;
  comment: string | null;
  soleApprover: boolean;
  onBehalfOfManager: boolean;
}

export interface LeaveRequestView {
  id: string;
  employeeId: string;
  /** Nom d'affichage du collaborateur, si l'API le sert. */
  employeeName?: string | null;
  /** `null` quand le type est masqué hors ayants droit. */
  typeId: string | null;
  /** Libellé du type, ou « Absent » pour un type confidentiel hors ayants droit. */
  typeLabel: string;
  /** Vrai quand le type est masqué pour le lecteur. */
  masked?: boolean;
  start: LeaveBoundView;
  end: LeaveBoundView;
  /** Jours décomptés par le moteur (`leaveDays`), chaîne décimale. */
  days: DaysString;
  reason: string | null;
  status: LeaveRequestStatus;
  steps: LeaveApprovalStepKey[];
  approvals: LeaveApprovalView[];
  /** Étape en attente, si l'API la sert (sinon déduite de `steps` et `approvals`). */
  currentStep?: LeaveApprovalStepKey | null;
  cancellation?: { at: string; by: string; reason: string | null } | null;
  createdBy: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveRequestPage {
  items: LeaveRequestView[];
  nextCursor: string | null;
}

export interface ListLeaveRequestsParams {
  employeeId?: string;
  status?: LeaveRequestStatus;
  from?: CalendarDay;
  to?: CalendarDay;
  cursor?: string;
  limit?: number;
}

export interface CreateLeaveRequestInput {
  /** Absent : pour soi. Présent : saisie pour autrui (`hr.manage`). */
  employeeId?: string;
  typeId: string;
  start: LeaveBoundView;
  end: LeaveBoundView;
  reason?: string | null;
}

/** Solde d'un type, rendu par le moteur (`leaveBalance`) : jamais additionné ici. */
export interface LeaveBalanceView {
  typeId: string;
  /** Copie d'affichage du libellé du type, si l'API la sert. */
  typeLabel?: string | null;
  leaveYear: number;
  accrued: DaysString;
  allocated: DaysString;
  adjusted: DaysString;
  carriedOver: DaysString;
  expired: DaysString;
  taken: DaysString;
  upcoming: DaysString;
  pending: DaysString;
  available: DaysString;
}

export interface LeaveBalancesView {
  asOf: CalendarDay;
  leaveYear: number;
  balances: LeaveBalanceView[];
}

// ─── « Moi » et « Mon équipe » (§ 3.1) — contrat du lot H2 ──────────────────

/** Élément de liste d'entrée ou de sortie assigné à l'appelant (lot H4). */
export interface HrMyChecklistItem {
  checklistId: string;
  itemId: string;
  label: string;
  employeeName: string;
  dueDate: CalendarDay | null;
  doneAt: string | null;
}

/** Document visible du collaborateur (liste, sans contenu ; lot H4). */
export interface HrMyDocument {
  id: string;
  label: string;
  category: string;
  issuedOn: CalendarDay | null;
  expiresOn: CalendarDay | null;
}

export interface HrMeView {
  /** Ma fiche, si un dossier est relié à mon compte. */
  employee: HrEmployeeView | null;
  balances: LeaveBalanceView[];
  requests: LeaveRequestView[];
  documents?: HrMyDocument[];
  checklistItems?: HrMyChecklistItem[];
  isManager: boolean;
  canApprove: boolean;
}

/** Membre de mon équipe : fiche réduite, absences, soldes (§ 3.1). */
export interface HrTeamMemberView {
  employee: HrEmployeeListItem;
  /** Subordonné direct (sinon indirect). */
  direct: boolean;
  balances?: LeaveBalanceView[];
  absences?: LeaveRequestView[];
}

export interface HrTeamView {
  members: HrTeamMemberView[];
}

// ─── Calendrier (§ 3.2) — contrat du lot H3 (moteur `teamCalendar`) ─────────

export interface HrCalendarEntry {
  requestId: string;
  employeeId: string;
  /** Nom d'affichage, si l'API le sert. */
  employeeName?: string | null;
  status: 'pending' | 'approved';
  start: LeaveBoundView;
  end: LeaveBoundView;
  typeId: string | null;
  /** Libellé du type, ou « Absent ». */
  label: string;
  masked: boolean;
}

export interface HrCalendarView {
  from: CalendarDay;
  to: CalendarDay;
  entries: HrCalendarEntry[];
  holidays: { date: CalendarDay; halfDay: 'am' | 'pm' | null; label: string | null }[];
  /** Noms des collaborateurs de la fenêtre, si l'API les sert à part. */
  employees?: { id: string; name: string; departmentId?: string | null }[];
}

// ─── Organigramme (§ 2.3, moteur `orgChart`) — contrat du lot H2 ────────────

/** Personne citée par l'organigramme : nom d'usage, poste, service — rien d'autre. */
export interface HrOrgChartPerson {
  id: string;
  name: string;
  jobTitle: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  managerEmployeeId?: string | null;
}

export interface HrDepartmentChartNode {
  departmentId: string;
  name: string;
  headEmployeeId: string | null;
  employeeIds: string[];
  headcount: number;
  totalHeadcount: number;
  children: HrDepartmentChartNode[];
}

export interface HrReportingChartNode {
  employeeId: string;
  departmentId: string | null;
  directReports: number;
  totalReports: number;
  children: HrReportingChartNode[];
  /** Copies d'affichage, si l'API les pose sur le nœud. */
  name?: string;
  jobTitle?: string | null;
}

export type HrOrgChartResponse =
  | {
      view: 'departments';
      roots: HrDepartmentChartNode[];
      unassignedEmployeeIds: string[];
      headcount: number;
      people?: HrOrgChartPerson[];
    }
  | {
      view: 'reporting';
      roots: HrReportingChartNode[];
      headcount: number;
      people?: HrOrgChartPerson[];
    };

// ─── Client ─────────────────────────────────────────────────────────────────

const id = encodeURIComponent;

export const hrApi = {
  // Moi, mon équipe (§ 3.1)
  getMe: () => jsonRequest<HrMeView>('/hr/me', { method: 'GET' }),
  getTeam: () => jsonRequest<HrTeamView>('/hr/team', { method: 'GET' }),

  // Collaborateurs (§ 3.1) — aucune route sensible ici.
  listEmployees: (params: ListEmployeesParams = {}) =>
    jsonRequest<HrEmployeePage>(`/hr/employees${salesQuery(params)}`, { method: 'GET' }),
  getEmployee: (employeeId: string) =>
    jsonRequest<HrEmployeeView>(`/hr/employees/${id(employeeId)}`, { method: 'GET' }),
  createEmployee: (body: HrEmployeeInput) =>
    jsonRequest<HrEmployeeView>('/hr/employees', { method: 'POST', body }),
  updateEmployee: (employeeId: string, body: HrEmployeeUpdateInput) =>
    jsonRequest<HrEmployeeView>(`/hr/employees/${id(employeeId)}`, { method: 'PUT', body }),
  createEmployeesFromMembers: (userIds: string[]) =>
    jsonRequest<{ items: HrEmployeeView[] }>('/hr/employees/from-members', {
      method: 'POST',
      body: { userIds },
    }),

  // Services (§ 3.1)
  listDepartments: () =>
    jsonRequest<{ items: HrDepartmentView[] }>('/hr/departments', { method: 'GET' }),
  createDepartment: (body: HrDepartmentInput) =>
    jsonRequest<HrDepartmentView>('/hr/departments', { method: 'POST', body }),
  updateDepartment: (departmentId: string, body: HrDepartmentInput & { expectedRevision: number }) =>
    jsonRequest<HrDepartmentView>(`/hr/departments/${id(departmentId)}`, { method: 'PUT', body }),
  archiveDepartment: (departmentId: string, expectedRevision: number) =>
    jsonRequest<HrDepartmentView>(`/hr/departments/${id(departmentId)}/archive`, {
      method: 'POST',
      body: { expectedRevision },
    }),

  // Organigramme (§ 3.1)
  getOrgChart: (view: HrOrgChartView) =>
    jsonRequest<HrOrgChartResponse>(`/hr/org-chart${salesQuery({ view })}`, { method: 'GET' }),

  // Réglages lus (§ 3.3, lecture `hr.read`)
  getSettings: () => jsonRequest<HrSettingsView>('/hr/settings', { method: 'GET' }),

  // Absences (§ 3.2)
  listLeaveTypes: () =>
    jsonRequest<{ items: LeaveTypeView[] }>('/hr/leave-types', { method: 'GET' }),
  createLeaveRequest: (body: CreateLeaveRequestInput) =>
    jsonRequest<LeaveRequestView>('/hr/leave-requests', { method: 'POST', body }),
  listLeaveRequests: (params: ListLeaveRequestsParams = {}) =>
    jsonRequest<LeaveRequestPage>(`/hr/leave-requests${salesQuery(params)}`, { method: 'GET' }),
  approveLeaveRequest: (requestId: string, body: { comment?: string; expectedRevision: number }) =>
    jsonRequest<LeaveRequestView>(`/hr/leave-requests/${id(requestId)}/approve`, {
      method: 'POST',
      body,
    }),
  rejectLeaveRequest: (requestId: string, body: { comment: string; expectedRevision?: number }) =>
    jsonRequest<LeaveRequestView>(`/hr/leave-requests/${id(requestId)}/reject`, {
      method: 'POST',
      body,
    }),
  cancelLeaveRequest: (requestId: string, body: { reason?: string }) =>
    jsonRequest<LeaveRequestView>(`/hr/leave-requests/${id(requestId)}/cancel`, {
      method: 'POST',
      body,
    }),
  listPendingApprovals: (params: { cursor?: string; limit?: number } = {}) =>
    jsonRequest<LeaveRequestPage>(`/hr/leave-approvals/pending${salesQuery(params)}`, {
      method: 'GET',
    }),
  getLeaveBalances: (params: { employeeId?: string; asOf?: CalendarDay } = {}) =>
    jsonRequest<LeaveBalancesView>(`/hr/leave-balances${salesQuery(params)}`, { method: 'GET' }),
  getCalendar: (params: { from: CalendarDay; to: CalendarDay; scope: HrCalendarScope }) =>
    jsonRequest<HrCalendarView>(`/hr/calendar${salesQuery(params)}`, { method: 'GET' }),
};
