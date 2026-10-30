// Feuille de temps hebdomadaire en LECTURE — ADR-0045 O5, § 6.3. ADR-0045 — H5.
//
// `GET /work/timesheets?userId=&week=` : grille jour × projet des saisies de temps
// EXISTANTES, croisée avec les absences approuvées (demi-journées, jamais le type)
// et les jours fériés. Aucune saisie, aucune validation, aucun verrou nouveaux.
// Calcul : moteur RH `weeklyTimesheet`.

import { z } from 'zod';

import { isCalendarDay } from './scheduling.js';
import type { WorkMemberRef } from './views.js';

const ID = /^[0-9a-f]{24}$/;

/** Lundi d'une semaine `AAAA-MM-JJ`. */
function isMonday(day: string): boolean {
  if (!isCalendarDay(day)) return false;
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1;
}

export const WeeklyTimesheetQuery = z
  .object({
    /** Membre concerné ; absent : l'appelant. Pour autrui : `work.manage` ou manager. */
    userId: z.string().regex(ID, 'Identifiant de membre invalide.').optional(),
    /** Lundi de la semaine ; absent : la semaine courante (jour de Kinshasa). */
    week: z
      .string()
      .refine(isMonday, { message: 'Semaine attendue : le lundi, au format AAAA-MM-JJ.' })
      .optional(),
  })
  .strict();
export type WeeklyTimesheetQuery = z.output<typeof WeeklyTimesheetQuery>;

export const TIMESHEET_FINDING_CODES = ['TIME_ON_LEAVE_DAY', 'NO_TIME_ON_WORKING_DAY'] as const;
export type TimesheetFindingCode = (typeof TIMESHEET_FINDING_CODES)[number];

export interface WeeklyTimesheetDayView {
  date: string;
  weekday: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
  /** Fraction travaillée prévue par la semaine de travail, en jours (« 1 », « 0.5 »). */
  scheduled: string;
  holiday: 'am' | 'pm' | 'full' | null;
  /** Absence approuvée : demi-journées seulement, jamais le type. */
  absence: 'am' | 'pm' | 'full' | null;
  expected: string;
  totalMinutes: number;
}

export interface WeeklyTimesheetView {
  /** Version du moteur RH (`HR_VERSION`). */
  version: string;
  user: WorkMemberRef;
  /** Lundi de la semaine. */
  week: string;
  /** Vrai si le membre est relié à une fiche collaborateur (absences et semaine propres). */
  employeeLinked: boolean;
  days: WeeklyTimesheetDayView[];
  projects: {
    projectId: string;
    projectName: string;
    minutesByDay: number[];
    totalMinutes: number;
  }[];
  totalMinutes: number;
  findings: { code: TimesheetFindingCode; date: string; minutes: number }[];
}
