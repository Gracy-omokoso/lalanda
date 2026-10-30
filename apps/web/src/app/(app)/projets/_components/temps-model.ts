// Feuille de temps hebdomadaire en LECTURE (ADR-0045 O5, § 6.3) — logique pure, lot H7.
//
// Grille jour × projet des saisies de temps existantes, croisée avec les absences
// accordées (demi-journées, jamais le type) et les jours fériés : tout vient de
// `GET /work/timesheets` (moteur RH `weeklyTimesheet`), totaux compris. Aucune
// saisie, aucune validation, aucun verrou. L'écran met en forme et navigue d'une
// semaine à l'autre ; il n'additionne rien.

import { addDays, type WeeklyTimesheetView } from '@lalanda/shared/work';

import type { OrgAction } from '@/lib/api';

import { formatJour } from './projets-model';

export const TEMPS_HREF = '/projets/mes-taches/temps';

type Jour = WeeklyTimesheetView['days'][number];

const JOURS: Record<Jour['weekday'], string> = {
  mon: 'Lun.',
  tue: 'Mar.',
  wed: 'Mer.',
  thu: 'Jeu.',
  fri: 'Ven.',
  sat: 'Sam.',
  sun: 'Dim.',
};

/** Voir la feuille d'un autre membre : `work.manage` (le manager passe par l'API). */
export function peutChoisirMembre(actions: readonly OrgAction[] | null): boolean {
  return actions !== null && actions.includes('work.manage');
}

/** Lundi de la semaine voisine (navigation d'agenda, ±7 jours civils). */
export function semaineVoisine(lundi: string, sens: -1 | 1): string {
  return addDays(lundi, 7 * sens);
}

/** Minutes rendues par l'API en heures lisibles (« 2 h 30 », « 45 min ») ; 0 : « — ». */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

export function enteteJour(j: Pick<Jour, 'weekday' | 'date'>): string {
  return `${JOURS[j.weekday]} ${formatJour(j.date, false)}`;
}

const DEMI: Record<'am' | 'pm' | 'full', string> = {
  full: '',
  am: ' (matin)',
  pm: ' (après-midi)',
};

/** État d'un jour, en texte : férié, absent, non travaillé (jamais le type d'absence). */
export function etatJour(j: Pick<Jour, 'holiday' | 'absence' | 'scheduled'>): string | null {
  const l: string[] = [];
  if (j.holiday) l.push(`Férié${DEMI[j.holiday]}`);
  if (j.absence) l.push(`Absent${DEMI[j.absence]}`);
  if (l.length === 0 && /^0(\.0+)?$/.test(j.scheduled)) return 'Non travaillé';
  return l.length > 0 ? l.join(' · ') : null;
}

/** Jours prévus rendus par l'API (« 1 », « 0.5 ») en français (« 1 j », « 0,5 j »). */
export function formatPrevu(valeur: string): string {
  const [e = '0', f = ''] = valeur.split('.');
  const frac = f.replace(/0+$/, '');
  return `${e}${frac ? `,${frac}` : ''} j`;
}

export function messageConstat(c: WeeklyTimesheetView['findings'][number]): string {
  switch (c.code) {
    case 'TIME_ON_LEAVE_DAY':
      return `${formatMinutes(c.minutes)} saisies le ${formatJour(c.date)}, jour d’absence accordée : vérifiez la saisie ou l’absence.`;
    case 'NO_TIME_ON_WORKING_DAY':
      return `Aucun temps saisi le ${formatJour(c.date)}, jour travaillé (information).`;
  }
}

export function tonConstat(
  c: Pick<WeeklyTimesheetView['findings'][number], 'code'>,
): 'attention' | 'info' {
  return c.code === 'TIME_ON_LEAVE_DAY' ? 'attention' : 'info';
}

export function phraseSemaine(v: Pick<WeeklyTimesheetView, 'days'>): string {
  const premier = v.days[0];
  const dernier = v.days[v.days.length - 1];
  if (!premier || !dernier) return '';
  return `Semaine du ${formatJour(premier.date, false)} au ${formatJour(dernier.date)}`;
}
