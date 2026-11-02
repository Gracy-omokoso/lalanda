// Client de l'API des ressources humaines, second volet — ADR-0051 § 6 et § 10 (lot H16).
//
// Notes de frais et avances (H10), présences et plannings (H12), objectifs et
// évaluations (H15). Les formes viennent de `@lalanda/shared/hr` quand le contrat les
// publie ; les vues que l'API seule déclare (présences, créneaux, objectifs,
// évaluations) sont recopiées ici, champ pour champ, depuis les services de l'API.
//
// AUCUN calcul : totaux, restes dus, minutes de présence, constats et décomptes de
// statuts viennent du moteur, par l'API. AUCUN contenu sensible n'est mis en cache, en
// stockage local ni dans une URL : un justificatif est lu en octets (`blob`) avec la
// session, jamais par une adresse publique ; le contenu d'une évaluation n'existe que
// dans l'état de l'écran qui l'a demandé.

import type {
  AdvanceKind,
  AdvancePage,
  AdvanceReasonView,
  AdvanceStatus,
  AdvanceView,
  AttendanceCorrectionStatus,
  AttendanceEventKind,
  AttendanceSource,
  CreateAdvanceBody,
  CreateExpenseReportBody,
  ExpenseListView,
  ExpenseReportPage,
  ExpenseReportStatus,
  ExpenseReportView,
  GoalFinalStatus,
  GoalStatus,
  HrCalendarScope,
  HrExpensesAdvancesSettingsView,
  HrPaymentMethod,
  HrToPayView,
  ReviewListItemView,
  ReviewSection,
  ReviewSectionKind,
  ReviewStatus,
  ShiftStatus,
  UpdateExpenseReportBody,
} from '@lalanda/shared/hr';
import { EXPENSE_RECEIPT_FILE_FIELD } from '@lalanda/shared/hr';

import { API_URL, EVENEMENT_REFUS_API, jsonRequest, salesQuery } from './api';

export type {
  AdvancePage,
  AdvanceView,
  ExpenseReportPage,
  ExpenseReportView,
  HrExpensesAdvancesSettingsView,
  HrToPayView,
  ReviewListItemView,
};

const id = encodeURIComponent;

// ─── Vues propres à l'API (recopiées des services `apps/api/src/hr/**`) ──────

/** `GET /hr/attendance/settings` — `HrPresenceSettingsView` (H12). */
export interface HrPresenceSettingsView {
  attendance: { enabled: boolean; selfClock: boolean; lateToleranceMinutes: number | null };
  planning: { enabled: boolean; indicativeMaxMinutesPerWeek: number | null };
  retention: { attendanceMonths: number | null };
  revision: number;
  isDefault: boolean;
}

export interface AttendanceEventView {
  id: string;
  employeeId: string;
  kind: AttendanceEventKind;
  at: string;
  source: AttendanceSource;
  note: string | null;
  voidedBy: string | null;
  correctionId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface AttendanceClockView {
  event: AttendanceEventView;
  notice: string;
}

/** Constat d'une journée (moteur `attendanceDay`) : un fait, jamais une sanction. */
export interface AttendanceFindingView {
  code: string;
  eventId: string | null;
  shiftId: string | null;
  minutes: number | null;
}

/** Journée de présence (moteur), jamais stockée. */
export interface AttendanceDayView {
  date: string;
  pairs: { inId: string; outId: string; in: string; out: string; minutes: number }[];
  minutes: number;
  firstIn: string | null;
  lastOut: string | null;
  unpairedEventIds: string[];
  leave: 'am' | 'pm' | 'full' | null;
  holiday: 'am' | 'pm' | 'full' | null;
  shiftIds: string[];
  findings: AttendanceFindingView[];
}

export interface AttendanceDaysView {
  employeeId: string;
  employeeName: string;
  from: string;
  to: string;
  planningEnabled: boolean;
  lateToleranceMinutes: number | null;
  version: string;
  minutes: number;
  days: AttendanceDayView[];
  events: AttendanceEventView[];
}

export interface AttendanceCorrectionView {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  proposed: { kind: AttendanceEventKind; at: string }[];
  voidEventIds: string[];
  reason: string;
  status: AttendanceCorrectionStatus;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
  soleApprover: boolean;
  createdEventIds: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceCorrectionPage {
  items: AttendanceCorrectionView[];
  nextCursor: string | null;
}

/** Constat d'un planning (moteur `shiftConflicts`) : jamais un refus. */
export interface ShiftFindingView {
  code: string;
  employeeId: string;
  shiftIds: string[];
  week: string | null;
  minutes: number | null;
}

export interface ShiftView {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  start: string;
  end: string;
  crossesMidnight: boolean;
  label: string | null;
  location: string | null;
  departmentId: string | null;
  workProjectId: string | null;
  status: ShiftStatus;
  publishedAt: string | null;
  note: string | null;
  unavailability: { comment: string; at: string } | null;
  canPlan: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftListView {
  from: string;
  to: string;
  scope: string;
  items: ShiftView[];
  findings: ShiftFindingView[];
}

export interface ShiftWriteView {
  shift: ShiftView;
  findings: ShiftFindingView[];
}

export interface StaffingGapView {
  code: 'UNDERSTAFFED_SLOT';
  needId: string;
  date: string;
  start: string;
  end: string;
  minStaff: number;
  planned: number;
  available: number;
  shortfall: number;
  departmentId: string | null;
  location: string | null;
  label: string | null;
}

export interface PlanningGapsView {
  version: string;
  from: string;
  to: string;
  gaps: StaffingGapView[];
  slotsChecked: number;
  findings: ShiftFindingView[];
}

export interface ShiftInput {
  employeeId: string;
  date: string;
  start: string;
  end: string;
  crossesMidnight?: boolean;
  label?: string;
  location?: string;
  note?: string;
}

/** `GET /hr/settings/performance` (H15). */
export interface HrPerformanceSettingsView {
  enabled: boolean;
  managerChainDepth: number;
  reviewsYearsAfterExit: number | null;
  revision: number;
  isDefault: boolean;
}

export type GoalTargetView =
  { kind: 'text'; value: string } | { kind: 'number'; value: string; unit?: string | null } | null;

export interface GoalView {
  id: string;
  employeeId: string;
  period: { from: string; to: string };
  reviewCycleId: string | null;
  title: string;
  description: string | null;
  measure: string | null;
  target: GoalTargetView;
  weight: number | null;
  workProjectId: string | null;
  status: GoalStatus;
  proposedBy: string;
  agreedBy: string | null;
  agreedAt: string | null;
  closedBy: string | null;
  closedAt: string | null;
  closeComment: string | null;
  progress: { at: string; by: string; percent: number | null; note: string }[];
  visibility: 'private';
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface GoalInput {
  employeeId?: string;
  period: { from: string; to: string };
  title: string;
  description?: string;
  measure?: string;
  target?: { kind: 'text'; value: string } | { kind: 'number'; value: string; unit?: string };
  weight?: number | null;
}

export interface ReviewTemplateSectionView {
  id: string;
  title: string;
  kind: ReviewSectionKind;
  scale?: { min: number; max: number; labels: string[] };
}

export interface ReviewCycleView {
  id: string;
  label: string;
  period: { from: string; to: string };
  template: { sections: ReviewTemplateSectionView[] };
  includesSelfAssessment: boolean;
  openOn: string;
  dueOn: string;
  status: 'draft' | 'open' | 'closed';
  employeeIds: string[];
  /** Décompte des STATUTS (moteur `reviewProgress`) ; jamais une note agrégée. */
  progress: { counts?: Partial<Record<ReviewStatus, number>>; total?: number } | null;
  revision: number;
}

export interface ReviewCycleInput {
  label: string;
  period: { from: string; to: string };
  template: { sections: ReviewTemplateSectionView[] };
  includesSelfAssessment: boolean;
  openOn: string;
  dueOn: string;
  employeeIds: string[];
}

/** Contenu d'une section, en clair : n'existe que dans l'état de l'écran. */
export interface ReviewSectionContentView {
  answers: Record<string, string>;
  ratings?: Record<string, number>;
  overall?: number | null;
}

export interface ReviewRevealView {
  reviewId: string;
  cycleId: string;
  employeeId: string;
  status: ReviewStatus;
  revealedAt: string;
  template: { sections: ReviewTemplateSectionView[] };
  goalSnapshot: { goalId: string; title: string; status: GoalStatus }[] | null;
  closedUnsigned: boolean;
  sections: Partial<Record<ReviewSection, ReviewSectionContentView | null>>;
}

export type ReviewStep = 'submit-self' | 'submit-manager' | 'share' | 'acknowledge' | 'close';

// ─── Fichiers (justificatifs) ───────────────────────────────────────────────

type ErreurHttp = Error & { status: number; detail: unknown };

async function erreurHttp(res: Response): Promise<ErreurHttp> {
  const text = await res.text();
  let detail: unknown = text;
  try {
    detail = JSON.parse(text);
  } catch {
    /* garde le texte brut */
  }
  const err = new Error(
    typeof detail === 'object' && detail !== null && 'message' in detail
      ? String((detail as { message: unknown }).message)
      : `HTTP ${res.status}`,
  ) as ErreurHttp;
  err.status = res.status;
  err.detail = detail;
  if (res.status === 403 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENEMENT_REFUS_API, { detail }));
  }
  return err;
}

/** Justificatif reçu : octets et type. Le navigateur n'en garde rien (`no-store`). */
export interface JustificatifRecu {
  blob: Blob;
  contentType: string;
}

// ─── Client ─────────────────────────────────────────────────────────────────

export interface ListExpenseParams {
  view?: ExpenseListView;
  status?: ExpenseReportStatus;
  employeeId?: string;
  cursor?: string;
  limit?: number;
}

export interface PaymentInput {
  expectedRevision: number;
  paidOn: string;
  accountId: string | null;
  method: HrPaymentMethod;
  reference?: string;
}

export const rh2Api = {
  // ── Réglages (lecture) ─────────────────────────────────────────────────────
  getExpensesSettings: () =>
    jsonRequest<HrExpensesAdvancesSettingsView>('/hr/settings/expenses', { method: 'GET' }),
  getPresenceSettings: () =>
    jsonRequest<HrPresenceSettingsView>('/hr/attendance/settings', { method: 'GET' }),
  getPerformanceSettings: () =>
    jsonRequest<HrPerformanceSettingsView>('/hr/settings/performance', { method: 'GET' }),

  // ── Notes de frais (§ 6.1) ────────────────────────────────────────────────
  listExpenseReports: (p: ListExpenseParams = {}) =>
    jsonRequest<ExpenseReportPage>(`/hr/expense-reports${salesQuery(p)}`, { method: 'GET' }),
  getExpenseReport: (reportId: string) =>
    jsonRequest<ExpenseReportView>(`/hr/expense-reports/${id(reportId)}`, { method: 'GET' }),
  createExpenseReport: (body: CreateExpenseReportBody) =>
    jsonRequest<ExpenseReportView>('/hr/expense-reports', { method: 'POST', body }),
  updateExpenseReport: (reportId: string, body: UpdateExpenseReportBody) =>
    jsonRequest<ExpenseReportView>(`/hr/expense-reports/${id(reportId)}`, {
      method: 'PUT',
      body,
    }),
  deleteExpenseReport: (reportId: string) =>
    jsonRequest<void>(`/hr/expense-reports/${id(reportId)}`, { method: 'DELETE' }),
  /** Envoi multipart : le fichier voyage dans le corps, jamais dans l'URL. */
  uploadReceipt: async (reportId: string, lineId: string, fichier: File) => {
    const fd = new FormData();
    fd.append(EXPENSE_RECEIPT_FILE_FIELD, fichier, fichier.name);
    const res = await fetch(
      `${API_URL}/hr/expense-reports/${id(reportId)}/lines/${id(lineId)}/receipt`,
      { method: 'POST', credentials: 'include', body: fd },
    );
    if (!res.ok) throw await erreurHttp(res);
    return (await res.json()) as ExpenseReportView;
  },
  /** Lu avec la session, en octets : aucune adresse publique, rien en cache. */
  downloadReceipt: async (reportId: string, lineId: string): Promise<JustificatifRecu> => {
    const res = await fetch(
      `${API_URL}/hr/expense-reports/${id(reportId)}/lines/${id(lineId)}/receipt`,
      { method: 'GET', credentials: 'include', cache: 'no-store' },
    );
    if (!res.ok) throw await erreurHttp(res);
    const blob = await res.blob();
    return { blob, contentType: res.headers.get('content-type') ?? blob.type };
  },
  submitExpenseReport: (reportId: string, expectedRevision: number) =>
    jsonRequest<ExpenseReportView>(`/hr/expense-reports/${id(reportId)}/submit`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  cancelExpenseReport: (reportId: string, body: { expectedRevision?: number; reason?: string }) =>
    jsonRequest<ExpenseReportView>(`/hr/expense-reports/${id(reportId)}/cancel`, {
      method: 'POST',
      body,
    }),
  duplicateExpenseReport: (reportId: string) =>
    jsonRequest<ExpenseReportView>(`/hr/expense-reports/${id(reportId)}/duplicate`, {
      method: 'POST',
      body: {},
    }),
  approveExpenseReport: (reportId: string, body: { expectedRevision: number; comment?: string }) =>
    jsonRequest<ExpenseReportView>(`/hr/expense-reports/${id(reportId)}/approve`, {
      method: 'POST',
      body,
    }),
  rejectExpenseReport: (reportId: string, body: { expectedRevision?: number; comment: string }) =>
    jsonRequest<ExpenseReportView>(`/hr/expense-reports/${id(reportId)}/reject`, {
      method: 'POST',
      body,
    }),
  reimburseExpenseReport: (reportId: string, body: PaymentInput) =>
    jsonRequest<ExpenseReportView>(`/hr/expense-reports/${id(reportId)}/reimburse`, {
      method: 'POST',
      body,
    }),
  cancelReimbursement: (reportId: string, body: { expectedRevision: number; reason: string }) =>
    jsonRequest<ExpenseReportView>(`/hr/expense-reports/${id(reportId)}/reimbursement/cancel`, {
      method: 'POST',
      body,
    }),
  toPay: () => jsonRequest<HrToPayView>('/hr/expenses/to-pay', { method: 'GET' }),

  // ── Avances (§ 3.2, § 3.3) ────────────────────────────────────────────────
  listAdvances: (
    p: {
      employeeId?: string;
      status?: AdvanceStatus;
      kind?: AdvanceKind;
      cursor?: string;
      limit?: number;
    } = {},
  ) => jsonRequest<AdvancePage>(`/hr/advances${salesQuery(p)}`, { method: 'GET' }),
  createAdvance: (body: CreateAdvanceBody) =>
    jsonRequest<AdvanceView>('/hr/advances', { method: 'POST', body }),
  submitAdvance: (advanceId: string, expectedRevision: number) =>
    jsonRequest<AdvanceView>(`/hr/advances/${id(advanceId)}/submit`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  cancelAdvance: (advanceId: string, body: { expectedRevision?: number; reason?: string }) =>
    jsonRequest<AdvanceView>(`/hr/advances/${id(advanceId)}/cancel`, { method: 'POST', body }),
  approveAdvance: (advanceId: string, body: { expectedRevision: number; comment?: string }) =>
    jsonRequest<AdvanceView>(`/hr/advances/${id(advanceId)}/approve`, { method: 'POST', body }),
  rejectAdvance: (advanceId: string, body: { expectedRevision?: number; comment: string }) =>
    jsonRequest<AdvanceView>(`/hr/advances/${id(advanceId)}/reject`, { method: 'POST', body }),
  disburseAdvance: (advanceId: string, body: PaymentInput & { accountId: string }) =>
    jsonRequest<AdvanceView>(`/hr/advances/${id(advanceId)}/disburse`, { method: 'POST', body }),
  settleAdvance: (
    advanceId: string,
    body: {
      expectedRevision: number;
      kind: 'cash_return' | 'declared_payroll' | 'write_off';
      amount: string;
      on: string;
      accountId?: string | null;
      reference?: string;
      note?: string;
    },
  ) =>
    jsonRequest<AdvanceView>(`/hr/advances/${id(advanceId)}/settlements`, {
      method: 'POST',
      body,
    }),
  /** Motif d'une avance sur salaire : lecture journalisée, gardée dans l'écran seulement. */
  revealAdvanceReason: (advanceId: string) =>
    jsonRequest<AdvanceReasonView>(`/hr/advances/${id(advanceId)}/reveal-reason`, {
      method: 'POST',
      body: {},
    }),

  // ── Présences (§ 6.2) ─────────────────────────────────────────────────────
  clock: (kind: AttendanceEventKind) =>
    jsonRequest<AttendanceClockView>('/hr/attendance/clock', { method: 'POST', body: { kind } }),
  createAttendanceEvent: (body: {
    employeeId: string;
    kind: AttendanceEventKind;
    at: string;
    note: string;
  }) => jsonRequest<AttendanceEventView>('/hr/attendance/events', { method: 'POST', body }),
  attendanceDays: (p: { employeeId?: string; from: string; to: string }) =>
    jsonRequest<AttendanceDaysView>(`/hr/attendance/days${salesQuery(p)}`, { method: 'GET' }),
  listCorrections: (p: { employeeId?: string; status?: AttendanceCorrectionStatus } = {}) =>
    jsonRequest<AttendanceCorrectionPage>(`/hr/attendance/corrections${salesQuery(p)}`, {
      method: 'GET',
    }),
  requestCorrection: (body: {
    employeeId?: string;
    date: string;
    proposed: { kind: AttendanceEventKind; at: string }[];
    voidEventIds: string[];
    reason: string;
  }) =>
    jsonRequest<AttendanceCorrectionView>('/hr/attendance/corrections', { method: 'POST', body }),
  approveCorrection: (correctionId: string, comment?: string) =>
    jsonRequest<AttendanceCorrectionView>(
      `/hr/attendance/corrections/${id(correctionId)}/approve`,
      { method: 'POST', body: comment ? { comment } : {} },
    ),
  rejectCorrection: (correctionId: string, comment: string) =>
    jsonRequest<AttendanceCorrectionView>(`/hr/attendance/corrections/${id(correctionId)}/reject`, {
      method: 'POST',
      body: { comment },
    }),

  // ── Plannings (§ 6.2) ─────────────────────────────────────────────────────
  listShifts: (p: { from: string; to: string; scope: HrCalendarScope }) =>
    jsonRequest<ShiftListView>(`/hr/shifts${salesQuery(p)}`, { method: 'GET' }),
  createShift: (body: ShiftInput) =>
    jsonRequest<ShiftWriteView>('/hr/shifts', { method: 'POST', body }),
  publishShifts: (ids: string[]) =>
    jsonRequest<{ published: number; items: ShiftView[] }>('/hr/shifts/publish', {
      method: 'POST',
      body: { ids },
    }),
  copyWeek: (fromWeekStart: string, toWeekStart: string) =>
    jsonRequest<{ created: ShiftView[]; skipped: { shiftId: string; code: string }[] }>(
      '/hr/shifts/copy-week',
      { method: 'POST', body: { fromWeekStart, toWeekStart } },
    ),
  cancelShift: (shiftId: string, expectedRevision: number) =>
    jsonRequest<ShiftView>(`/hr/shifts/${id(shiftId)}/cancel`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  signalUnavailability: (shiftId: string, comment: string) =>
    jsonRequest<ShiftView>(`/hr/shifts/${id(shiftId)}/unavailability`, {
      method: 'POST',
      body: { comment },
    }),
  planningGaps: (p: { from: string; to: string }) =>
    jsonRequest<PlanningGapsView>(`/hr/planning/gaps${salesQuery(p)}`, { method: 'GET' }),

  // ── Objectifs (§ 6.3) ─────────────────────────────────────────────────────
  listGoals: (p: { employeeId?: string; from?: string; to?: string; status?: GoalStatus } = {}) =>
    jsonRequest<{ items: GoalView[] }>(`/hr/goals${salesQuery(p)}`, { method: 'GET' }),
  createGoal: (body: GoalInput) => jsonRequest<GoalView>('/hr/goals', { method: 'POST', body }),
  agreeGoal: (goalId: string, expectedRevision: number) =>
    jsonRequest<GoalView>(`/hr/goals/${id(goalId)}/agree`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  closeGoal: (
    goalId: string,
    body: { expectedRevision: number; status: GoalFinalStatus; comment: string },
  ) => jsonRequest<GoalView>(`/hr/goals/${id(goalId)}/close`, { method: 'POST', body }),
  goalProgress: (goalId: string, body: { percent?: number | null; note: string }) =>
    jsonRequest<GoalView>(`/hr/goals/${id(goalId)}/progress`, { method: 'POST', body }),

  // ── Évaluations (§ 6.3) — statuts en liste, contenu par `reveal` seulement ──
  listReviewCycles: () =>
    jsonRequest<{ items: ReviewCycleView[] }>('/hr/review-cycles', { method: 'GET' }),
  createReviewCycle: (body: ReviewCycleInput) =>
    jsonRequest<ReviewCycleView>('/hr/review-cycles', { method: 'POST', body }),
  openReviewCycle: (cycleId: string, expectedRevision: number) =>
    jsonRequest<ReviewCycleView>(`/hr/review-cycles/${id(cycleId)}/open`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  closeReviewCycle: (cycleId: string, expectedRevision: number) =>
    jsonRequest<ReviewCycleView>(`/hr/review-cycles/${id(cycleId)}/close`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  listReviews: (p: { cycleId?: string; mine?: 'true'; toWrite?: 'true' } = {}) =>
    jsonRequest<{ items: ReviewListItemView[] }>(`/hr/reviews${salesQuery(p)}`, {
      method: 'GET',
    }),
  revealReview: (reviewId: string, sections: ReviewSection[]) =>
    jsonRequest<ReviewRevealView>(`/hr/reviews/${id(reviewId)}/reveal`, {
      method: 'POST',
      body: { sections },
    }),
  writeReviewSection: (
    reviewId: string,
    section: ReviewSection,
    body: {
      expectedRevision: number;
      answers: Record<string, string>;
      ratings?: Record<string, number>;
      overall?: number | null;
    },
  ) =>
    jsonRequest<ReviewListItemView>(`/hr/reviews/${id(reviewId)}/sections/${id(section)}`, {
      method: 'PUT',
      body,
    }),
  reviewStep: (reviewId: string, step: ReviewStep, expectedRevision: number) =>
    jsonRequest<ReviewListItemView>(`/hr/reviews/${id(reviewId)}/${step}`, {
      method: 'POST',
      body: { expectedRevision },
    }),
};
