// ─────────────────────────────────────────────────────────────────────────────
// Absences des assignés d'un projet (ADR-0045 § 6.2) — INFORMATIF
//
// L'API lit, par le port `WORK_ABSENCES_SOURCE`, les absences APPROUVÉES des
// assignés (jours de début et de fin, jamais le type ni le motif) et les passe
// ici. Ce module décide, au jour de référence donné :
//   - le badge « Absent du … au … » d'un assigné absent aujourd'hui ;
//   - le constat `ASSIGNEE_ABSENT_ON_DUE_DATE` d'une tâche non terminée dont
//     l'échéance tombe pendant une absence de son assigné.
// Rien n'est déplacé ni réassigné. Aucune base, aucune horloge.
// ─────────────────────────────────────────────────────────────────────────────

import { addDays, isCalendarDay } from '../treasury/calendar.js';

/** Absence approuvée d'un membre : premier et dernier jour, inclus (une demi-journée compte). */
export interface WorkAbsenceInput {
  userId: string;
  startDate: string;
  endDate: string;
}

/** Période d'absence continue (absences qui se touchent ou se recouvrent réunies). */
export interface WorkAbsenceSpan {
  from: string;
  to: string;
}

/** Ce que le calcul lit d'une tâche. */
export interface WorkAbsenceTaskInput {
  id: string;
  assigneeUserId: string | null;
  dueDate: string | null;
  done: boolean;
}

export interface WorkTaskAbsence {
  taskId: string;
  /** Absence de l'assigné en cours au jour de référence (badge), sinon `null`. */
  assigneeAbsence: WorkAbsenceSpan | null;
  /**
   * Absence de l'assigné qui couvre l'échéance d'une tâche NON terminée (constat
   * `ASSIGNEE_ABSENT_ON_DUE_DATE`), sinon `null`.
   */
  dueDateAbsence: WorkAbsenceSpan | null;
}

export const ASSIGNEE_ABSENT_ON_DUE_DATE = 'ASSIGNEE_ABSENT_ON_DUE_DATE' as const;

function checkDay(value: string, what: string): string {
  if (!isCalendarDay(value))
    throw new RangeError(`${what} : date invalide ${JSON.stringify(value)}`);
  return value;
}

/**
 * Périodes d'absence par membre, triées : deux absences qui se recouvrent ou se
 * suivent (fin la veille du début de la suivante) forment une seule période.
 */
export function absenceSpansByUser(
  absences: readonly WorkAbsenceInput[],
): Map<string, WorkAbsenceSpan[]> {
  const byUser = new Map<string, WorkAbsenceSpan[]>();
  for (const [i, a] of absences.entries()) {
    const from = checkDay(a.startDate, `Absence n° ${i + 1} (début)`);
    const to = checkDay(a.endDate, `Absence n° ${i + 1} (fin)`);
    if (to < from) throw new RangeError(`Absence n° ${i + 1} : la fin précède le début`);
    byUser.set(a.userId, [...(byUser.get(a.userId) ?? []), { from, to }]);
  }
  for (const [userId, spans] of byUser) {
    spans.sort((x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : 0));
    const merged: WorkAbsenceSpan[] = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last && s.from <= addDays(last.to, 1)) {
        if (s.to > last.to) last.to = s.to;
      } else merged.push({ ...s });
    }
    byUser.set(userId, merged);
  }
  return byUser;
}

function spanOn(
  spans: readonly WorkAbsenceSpan[] | undefined,
  day: string,
): WorkAbsenceSpan | null {
  const s = spans?.find((x) => x.from <= day && day <= x.to);
  return s ? { from: s.from, to: s.to } : null;
}

/** Badge et constat d'échéance de chaque tâche, au jour de référence `today`. */
export function taskAbsences(
  tasks: readonly WorkAbsenceTaskInput[],
  absences: readonly WorkAbsenceInput[],
  today: string,
): WorkTaskAbsence[] {
  checkDay(today, 'Jour de référence');
  const spans = absenceSpansByUser(absences);
  return tasks.map((t) => {
    const own = t.assigneeUserId === null ? undefined : spans.get(t.assigneeUserId);
    const due = t.dueDate === null ? null : checkDay(t.dueDate, `Tâche ${t.id} (échéance)`);
    return {
      taskId: t.id,
      assigneeAbsence: spanOn(own, today),
      dueDateAbsence: t.done || due === null ? null : spanOn(own, due),
    };
  });
}
