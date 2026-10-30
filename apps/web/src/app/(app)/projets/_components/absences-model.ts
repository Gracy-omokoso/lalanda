// Absences vues depuis les Projets (ADR-0045 § 6.1, § 6.2, § 8 ; lot H5) — logique
// pure, sans React.
//
// - Badge « Absent » d'un assigné et constat « absent à l'échéance » : l'API sert
//   seulement les jours (jamais le type ni le motif d'une absence) ; ce module ne fait
//   que les mettre en mots.
// - Bandeaux d'une journée du calendrier de « Mes tâches » : chaque absence du
//   calendrier RH (`GET /hr/calendar?scope=team`) est découpée en jours. Le libellé ne
//   porte JAMAIS le type (« absent », pas « Maladie ») ni de couleur propre au type.

import { addDays } from '@lalanda/shared/work';

import { formatJour } from './projets-model';

/** Période d'absence servie par l'API (jours inclus). */
export interface PeriodeAbsence {
  from: string;
  to: string;
}

/** « Absent jusqu’au 8 mars » (badge court) et « Absent du 3 au 8 mars » (titre complet). */
export function badgeAbsent(p: PeriodeAbsence): { court: string; complet: string } {
  const complet =
    p.from === p.to
      ? `Absent le ${formatJour(p.from, false)}`
      : `Absent du ${formatJour(p.from, false)} au ${formatJour(p.to, false)}`;
  return { court: `Absent jusqu’au ${formatJour(p.to, false)}`, complet };
}

/** Constat `ASSIGNEE_ABSENT_ON_DUE_DATE`, en français. */
export function constatAbsentEcheance(p: PeriodeAbsence, nom?: string | null): string {
  const qui = nom ? `${nom} est absent` : 'Le responsable est absent';
  return `${qui} à l’échéance (${badgeAbsent(p).complet.replace(/^Absent /, '')}) : replanifiez ou réassignez la tâche.`;
}

/** Ce que les bandeaux lisent d'une entrée du calendrier RH. */
export interface AbsenceCalendrierRh {
  employeeName?: string | null;
  status: 'pending' | 'approved';
  start: { date: string; half: 'full' | 'am' | 'pm' };
  end: { date: string; half: 'full' | 'am' | 'pm' };
}

/**
 * Bandeaux d'une journée, par jour de `[debut, fin]` : « Awa — absente le matin »,
 * « … (en attente) ». Une demi-journée n'est précisée qu'au premier et au dernier jour.
 * Ordre stable : par jour, puis par nom.
 */
export function bandeauxAbsence(
  entries: readonly AbsenceCalendrierRh[],
  debut: string,
  fin: string,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of entries) {
    const nom = e.employeeName?.trim() || 'Un collaborateur';
    const lo = e.start.date < debut ? debut : e.start.date;
    const hi = e.end.date > fin ? fin : e.end.date;
    for (let jour = lo; jour <= hi; jour = addDays(jour, 1)) {
      let moment = '';
      if (jour === e.start.date && e.start.half === 'pm') moment = ' l’après-midi';
      if (jour === e.end.date && e.end.half === 'am') moment = ' le matin';
      if (e.start.date === e.end.date && e.start.half !== 'full' && e.start.half === e.end.half) {
        moment = e.start.half === 'am' ? ' le matin' : ' l’après-midi';
      }
      const texte = `${nom} — absent${moment}${e.status === 'pending' ? ' (en attente)' : ''}`;
      out.set(jour, [...(out.get(jour) ?? []), texte]);
    }
  }
  for (const [jour, l] of out)
    out.set(
      jour,
      [...l].sort((a, b) => a.localeCompare(b, 'fr')),
    );
  return out;
}
