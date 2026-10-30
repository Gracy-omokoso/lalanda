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
  EmployeeDetailView as ApiEmployeeDetail,
  EmployeePage as ApiEmployeePage,
  EmployeeView as ApiEmployee,
  HrMeView as ApiMe,
  HrTeamView as ApiTeam,
  OrgChartView as ApiOrgChart,
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

// ─── Adaptation aux contrats du lot H2 (`@lalanda/shared/hr`) ───────────────
// ADR-0045 — H2 : les vues ci-dessus ont été écrites avant les contrats. Les réponses
// réelles sont ramenées ici à ces formes, sans calcul : le statut dérivé vient du
// moteur (`derivedStatus`) ; soldes et demandes de « moi », noms du service, du
// manager et du type de contrat sont servis par l'API depuis le lot H3.

/** Fiche de l'API → vue des écrans (`upcoming`, `onProbation` lus sur `derivedStatus`). */
export function employeeFromApi(e: ApiEmployee): HrEmployeeView {
  return {
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    preferredName: e.preferredName,
    employeeNumber: e.employeeNumber,
    jobTitle: e.jobTitle,
    departmentId: e.departmentId,
    // ADR-0045 — H3 : copies d'affichage servies par l'API.
    departmentName: e.departmentName,
    managerEmployeeId: e.managerEmployeeId,
    managerName: e.managerName,
    contractType: e.contractType,
    contractTypeLabel: e.contractTypeLabel,
    startDate: e.startDate,
    endDate: e.endDate,
    status: e.status,
    upcoming: e.derivedStatus === 'upcoming',
    onProbation: e.derivedStatus === 'probation',
    userId: e.userId,
    workEmail: e.workEmail,
    workPhone: e.workPhone,
    workLocation: e.workLocation,
    probationEndDate: e.probationEndDate,
    contractEndDate: e.contractEndDate,
    exitCategory: e.exitCategory,
    notes: e.notes,
    revision: e.revision,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export function meFromApi(m: ApiMe): HrMeView {
  return {
    employee: m.employee ? employeeFromApi(m.employee) : null,
    // ADR-0045 — H3 : soldes (moteur) et demandes servis avec « moi ».
    balances: m.balances,
    requests: m.requests,
    isManager: m.isManager,
    canApprove: m.canApprove,
  };
}

/** Membre réduit de l'API : nom d'usage en `preferredName`, rien d'autre d'inventé. */
export function teamFromApi(t: ApiTeam): HrTeamView {
  return {
    members: t.items.map((m) => ({
      direct: m.isDirect,
      // ADR-0045 — H3 : soldes et absences de l'équipe (type masqué si confidentiel).
      balances: m.balances,
      absences: m.absences,
      employee: {
        id: m.id,
        firstName: m.displayName,
        lastName: '',
        preferredName: m.displayName,
        employeeNumber: null,
        jobTitle: m.jobTitle,
        departmentId: m.departmentId,
        departmentName: m.departmentName,
        managerEmployeeId: m.managerEmployeeId,
        managerName: m.managerName,
        contractType: '',
        startDate: '',
        endDate: null,
        status: m.derivedStatus === 'exited' ? 'exited' : 'active',
        upcoming: m.derivedStatus === 'upcoming',
        onProbation: m.derivedStatus === 'probation',
        userId: null,
        workEmail: m.workEmail,
        workPhone: m.workPhone,
        workLocation: null,
      },
    })),
  };
}

/** Organigramme de l'API : `people` (objet indexé) → liste, nom du service joint. */
export function orgChartFromApi(c: ApiOrgChart): HrOrgChartResponse {
  const people: HrOrgChartPerson[] = Object.entries(c.people).map(([personId, p]) => ({
    id: personId,
    name: p.displayName,
    jobTitle: p.jobTitle,
    departmentId: p.departmentId,
    departmentName: p.departmentId ? (c.departments[p.departmentId]?.name ?? null) : null,
    managerEmployeeId: p.managerEmployeeId,
  }));
  return c.view === 'departments'
    ? {
        view: 'departments',
        roots: c.roots,
        unassignedEmployeeIds: c.unassignedEmployeeIds,
        headcount: c.headcount,
        people,
      }
    : { view: 'reporting', roots: c.roots, headcount: c.headcount, people };
}

export const hrApi = {
  // Moi, mon équipe (§ 3.1)
  getMe: async () => meFromApi(await jsonRequest<ApiMe>('/hr/me', { method: 'GET' })),
  getTeam: async () => teamFromApi(await jsonRequest<ApiTeam>('/hr/team', { method: 'GET' })),

  // Collaborateurs (§ 3.1) — aucune route sensible ici.
  listEmployees: async (params: ListEmployeesParams = {}): Promise<HrEmployeePage> => {
    const page = await jsonRequest<ApiEmployeePage>(`/hr/employees${salesQuery(params)}`, {
      method: 'GET',
    });
    return { items: page.items.map(employeeFromApi), nextCursor: page.nextCursor };
  },
  getEmployee: async (employeeId: string) =>
    employeeFromApi(
      (
        await jsonRequest<ApiEmployeeDetail>(`/hr/employees/${id(employeeId)}`, {
          method: 'GET',
        })
      ).employee,
    ),
  createEmployee: async (body: HrEmployeeInput) =>
    employeeFromApi(await jsonRequest<ApiEmployee>('/hr/employees', { method: 'POST', body })),
  updateEmployee: async (employeeId: string, body: HrEmployeeUpdateInput) =>
    employeeFromApi(
      await jsonRequest<ApiEmployee>(`/hr/employees/${id(employeeId)}`, { method: 'PUT', body }),
    ),
  createEmployeesFromMembers: async (userIds: string[]) => ({
    items: (
      await jsonRequest<{ items: ApiEmployee[] }>('/hr/employees/from-members', {
        method: 'POST',
        body: { userIds },
      })
    ).items.map(employeeFromApi),
  }),
  // Services (§ 3.1)
  listDepartments: () =>
    jsonRequest<{ items: HrDepartmentView[] }>('/hr/departments', { method: 'GET' }),
  createDepartment: (body: HrDepartmentInput) =>
    jsonRequest<HrDepartmentView>('/hr/departments', { method: 'POST', body }),
  updateDepartment: (
    departmentId: string,
    body: HrDepartmentInput & { expectedRevision: number },
  ) =>
    jsonRequest<HrDepartmentView>(`/hr/departments/${id(departmentId)}`, { method: 'PUT', body }),
  archiveDepartment: (departmentId: string, expectedRevision: number) =>
    jsonRequest<HrDepartmentView>(`/hr/departments/${id(departmentId)}/archive`, {
      method: 'POST',
      body: { expectedRevision },
    }),

  // Organigramme (§ 3.1)
  getOrgChart: async (view: HrOrgChartView) =>
    orgChartFromApi(
      await jsonRequest<ApiOrgChart>(`/hr/org-chart${salesQuery({ view })}`, { method: 'GET' }),
    ),

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
