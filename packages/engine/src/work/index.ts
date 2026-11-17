// Marge par projet du RUN (ADR-0039 § 5) — point d'entrée du module.
// Versionné à part (`WORK_MARGIN_VERSION`) ; ne touche aucun calcul de plan.

export * from './types.js';
export { computeProjectMargin } from './margin.js';
// ADR-0051 — H14 (§ 7.3) : frais approuvés non remboursés, informatifs.
export { pendingExpenseClaimsOf } from './margin.js';
// ADR-0045 § 6.2 (lot H5) : absences des assignés, badge et constat d'échéance.
export {
  ASSIGNEE_ABSENT_ON_DUE_DATE,
  absenceSpansByUser,
  taskAbsences,
  type WorkAbsenceInput,
  type WorkAbsenceSpan,
  type WorkAbsenceTaskInput,
  type WorkTaskAbsence,
} from './absences.js';
// ADR-0077 § 4.5 : part du temps validé, informative.
export {
  timeApprovalShare,
  type ApprovedWeekInput,
  type TimeApprovalEntryInput,
  type TimeApprovalShare,
} from './time-approval.js';
// ADR-0078 § 2.4 : récapitulatif temps × taux d'achat d'un consultant.
export {
  CONSULTANT_RECAP_VERSION,
  consultantTimeRecap,
  type ConsultantRecapEntryInput,
  type ConsultantRecapInput,
  type ConsultantRecapLine,
  type ConsultantRecapResult,
} from './consultant-recap.js';
