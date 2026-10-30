// Absences des membres vues depuis les projets — ADR-0045 § 6.2, § 6.3. ADR-0045 — H5.
//
// Port en LECTURE SEULE (motif de `HR_AGENDA_SOURCE`) : un jeton, une interface, un
// fournisseur nul par défaut (tests, module RH absent). Le fournisseur réel
// (`hr/work/hr-work-absences.source.ts`) lit les demandes APPROUVÉES des collaborateurs
// reliés aux comptes donnés. Il ne rend JAMAIS le type ni le motif d'une absence :
// seulement qui et quand — le fait « absent », que l'équipe d'un projet voit de toute
// façon (décision ouverte n° 8).

import type { HolidayInput, LeavePeriod, WorkPattern } from '@lalanda/engine';

export const WORK_ABSENCES_SOURCE = Symbol('WORK_ABSENCES_SOURCE');

/** Absence approuvée d'un membre (bornes en demi-journées), sans type ni motif. */
export interface WorkMemberAbsence extends LeavePeriod {
  userId: string;
}

/** Ce que la feuille de temps lit des RH pour un membre et une fenêtre. */
export interface WorkTimesheetContext {
  /** Le membre est relié à une fiche collaborateur active ou sortie. */
  employeeLinked: boolean;
  /** L'appelant est le manager (direct ou indirect) de ce collaborateur. */
  viewerIsManager: boolean;
  /** Semaine de travail du collaborateur, sinon celle de l'organisation. */
  workPattern: WorkPattern;
  absences: LeavePeriod[];
  holidays: HolidayInput[];
}

export interface WorkAbsencesSource {
  /** Absences approuvées des membres donnés qui touchent `[from, to]`. */
  absencesOf(
    organizationId: string,
    userIds: readonly string[],
    from: string,
    to: string,
  ): Promise<WorkMemberAbsence[]>;
  timesheetContextOf(
    organizationId: string,
    viewerUserId: string,
    userId: string,
    from: string,
    to: string,
  ): Promise<WorkTimesheetContext>;
}

/** Semaine de travail par défaut sans module RH : lundi à vendredi (décision ouverte n° 5). */
const MON_FRI: WorkPattern = { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 0, sun: 0 };

/** Sans module RH (tests) : aucune absence, aucun férié, aucun manager. */
export const noWorkAbsences: WorkAbsencesSource = {
  absencesOf: async () => [],
  timesheetContextOf: async () => ({
    employeeLinked: false,
    viewerIsManager: false,
    workPattern: MON_FRI,
    absences: [],
    holidays: [],
  }),
};
