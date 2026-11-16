// Part du temps validé d'un projet — ADR-0077 § 4.5.
//
// INFORMATIF : la marge (`computeProjectMargin`) garde TOUT le temps saisi ; ce calcul
// dit seulement combien de minutes tombent dans une semaine VALIDÉE de leur auteur.
// Pur : aucune base, aucune horloge. Une semaine est désignée par son lundi
// (`AAAA-MM-JJ`) ; une saisie appartient à la semaine qui contient son jour.

export interface TimeApprovalEntryInput {
  userId: string;
  /** Jour `AAAA-MM-JJ`. */
  workedOn: string;
  minutes: number;
}

export interface ApprovedWeekInput {
  userId: string;
  /** Lundi `AAAA-MM-JJ`. */
  week: string;
}

export interface TimeApprovalShare {
  totalMinutes: number;
  approvedMinutes: number;
}

/** Lundi de la semaine qui contient `day` (`AAAA-MM-JJ`). */
export function mondayOfDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const back = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
}

/** Minutes saisies et minutes d'une semaine validée de leur auteur. */
export function timeApprovalShare(
  entries: readonly TimeApprovalEntryInput[],
  approvedWeeks: readonly ApprovedWeekInput[],
): TimeApprovalShare {
  const approved = new Set(approvedWeeks.map((w) => `${w.userId}|${w.week}`));
  let totalMinutes = 0;
  let approvedMinutes = 0;
  for (const e of entries) {
    const minutes = Number.isInteger(e.minutes) && e.minutes > 0 ? e.minutes : 0;
    totalMinutes += minutes;
    if (approved.has(`${e.userId}|${mondayOfDay(e.workedOn)}`)) approvedMinutes += minutes;
  }
  return { totalMinutes, approvedMinutes };
}
