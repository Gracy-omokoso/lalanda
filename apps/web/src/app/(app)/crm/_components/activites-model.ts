// Activités et relances — ADR-0040 § 3.5 et § 8.1 (filtres : les miennes, en
// retard, à venir, faites). Logique pure.
//
// Les jours sont des jours civils de Kinshasa (`AAAA-MM-JJ`) ; le retard est
// celui que rend l'API (`overdue`), jamais recalculé ici.

import type { ActivitiesQuery, ActivityView } from '@/lib/api-crm';

export type FiltreActivites = 'a_faire' | 'en_retard' | 'a_venir' | 'faites' | 'toutes';

export const FILTRES_ACTIVITES: readonly { valeur: FiltreActivites; label: string }[] = [
  { valeur: 'a_faire', label: 'À faire' },
  { valeur: 'en_retard', label: 'En retard' },
  { valeur: 'a_venir', label: 'À venir' },
  { valeur: 'faites', label: 'Faites' },
  { valeur: 'toutes', label: 'Toutes' },
];

export interface FiltresActivites {
  statut: FiltreActivites;
  /** `true` : seulement celles qui me sont assignées (`assignee=me`). */
  miennes: boolean;
}

export const FILTRES_ACTIVITES_INITIAUX: FiltresActivites = { statut: 'a_faire', miennes: true };

const KINSHASA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Kinshasa',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Jour civil `AAAA-MM-JJ` à Kinshasa (UTC+1, sans heure d'été). */
export function jourKinshasa(at: Date): string {
  return KINSHASA.format(at);
}

/** Requête de liste ; « à venir » = non faites dont l'échéance est aujourd'hui ou après. */
export function requeteActivites(
  f: FiltresActivites,
  aujourdhui: string,
  cursor: string | null = null,
): ActivitiesQuery {
  const base: ActivitiesQuery = {
    limit: 50,
    ...(f.miennes ? { assignee: 'me' } : {}),
    ...(cursor ? { cursor } : {}),
  };
  switch (f.statut) {
    case 'a_faire':
      return { ...base, status: 'open' };
    case 'en_retard':
      return { ...base, status: 'overdue' };
    case 'a_venir':
      return { ...base, status: 'open', dueFrom: aujourdhui };
    case 'faites':
      return { ...base, status: 'done' };
    default:
      return { ...base, status: 'all' };
  }
}

/** Échéance lisible d'une activité, à partir de son jour de Kinshasa. */
export function libelleEcheance(
  a: Pick<ActivityView, 'dueDay' | 'done' | 'overdue' | 'kind'>,
  aujourdhui: string,
): string {
  if (a.kind === 'note') return 'Note';
  if (a.dueDay === null) return 'Sans échéance';
  const annee = a.dueDay.slice(0, 4);
  const jour = new Date(`${a.dueDay}T12:00:00Z`).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
    ...(aujourdhui.startsWith(annee) ? {} : { year: 'numeric' }),
  });
  if (a.done) return `Échéance ${jour}`;
  if (a.dueDay === aujourdhui) return 'Aujourd’hui';
  if (a.overdue) return `En retard — ${jour}`;
  return jour;
}

export type TonActivite = 'retard' | 'aujourdhui' | 'neutre' | 'faite';

export function tonActivite(
  a: Pick<ActivityView, 'dueDay' | 'done' | 'overdue'>,
  aujourdhui: string,
): TonActivite {
  if (a.done) return 'faite';
  if (a.overdue) return 'retard';
  if (a.dueDay === aujourdhui) return 'aujourdhui';
  return 'neutre';
}

/** Une activité cochée : on la retire d'une liste « à faire », sinon on la remplace. */
export function appliquerBascule(
  liste: readonly ActivityView[],
  maj: ActivityView,
  statut: FiltreActivites,
): ActivityView[] {
  const garde =
    statut === 'toutes' || (statut === 'faites' && maj.done) || (statut !== 'faites' && !maj.done);
  return garde
    ? liste.map((a) => (a.id === maj.id ? maj : a))
    : liste.filter((a) => a.id !== maj.id);
}
