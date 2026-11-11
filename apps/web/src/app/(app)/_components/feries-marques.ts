// Fériés de l'organisation → jours marqués des calendriers (ADR-0074, décision
// n° 1 du 11 nov. 2026, à revoir avec Gracy).
//
// Source unique : la liste SAISIE par l'organisation (`GET /hr/holidays`,
// ADR-0045 § 2.6, ADR-0068 § 5). Rien n'est inventé ici ; un férié n'est
// qu'une indication dans le calendrier, jamais un blocage.

import type { DateMark } from '@lalanda/ui';
import type { HolidayView } from '@lalanda/shared/hr';

const DEMI_JOURNEE: Record<'am' | 'pm', string> = {
  am: 'matin',
  pm: 'après-midi',
};

/** Nom affiché d'un férié : « Indépendance », « Fermeture (après-midi) », « … — à vérifier ». */
export function nomDuFerie(h: Pick<HolidayView, 'label' | 'halfDay' | 'toVerify'>): string {
  const demi = h.halfDay ? ` (${DEMI_JOURNEE[h.halfDay]})` : '';
  const aVerifier = h.toVerify ? ' — à vérifier' : '';
  return `${h.label.trim()}${demi}${aVerifier}`;
}

/** Jours marqués des sélecteurs de date : date, nom, récurrence. Rien d'autre ne sort. */
export function marquesDesFeries(
  items: readonly Pick<HolidayView, 'date' | 'label' | 'halfDay' | 'recurring' | 'toVerify'>[],
): DateMark[] {
  return items
    .filter((h) => h.label.trim() !== '')
    .map((h) => ({ date: h.date, label: nomDuFerie(h), recurring: h.recurring }));
}

/** La lecture n'est tentée que si l'API l'accepterait : droit de lecture et module RH dans l'offre. */
export function peutLireFeries(
  actions: readonly string[] | null,
  statutRh: 'included' | 'override' | 'not_in_plan' | null,
): boolean {
  if (actions === null || !actions.includes('analytics.read')) return false;
  return statutRh === 'included' || statutRh === 'override';
}
