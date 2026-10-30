// Marge par projet du RUN (ADR-0039 § 5) — point d'entrée du module.
// Versionné à part (`WORK_MARGIN_VERSION`) ; ne touche aucun calcul de plan.

export * from './types.js';
export { computeProjectMargin } from './margin.js';
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
