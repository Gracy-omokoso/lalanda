// Paramètres de la rubrique Projets — règles d'écran pures (ADR-0061), testées.
//
// Deux volets : « Mes notifications » (chacun, pour soi) et « Comportement des
// projets » (organisation, `work.manage`). L'écran prépare les corps ; le serveur
// valide et APPLIQUE chaque réglage (aucun n'est décoratif).

import {
  WORK_NOTIFICATION_EVENTS,
  type PutWorkNotificationPreferencesBody,
  type PutWorkSettingsBody,
  type WorkBehaviorSettings,
  type WorkNotificationEvent,
  type WorkNotificationPreferences,
  type WorkSettingsView,
} from '@lalanda/shared/work';

export const ONGLETS_PARAMETRES = [
  { id: 'notifications', label: 'Mes notifications' },
  { id: 'comportement', label: 'Comportement des projets' },
] as const;
export type OngletParametres = (typeof ONGLETS_PARAMETRES)[number]['id'];

export function ongletParametres(v: string | null, gerer: boolean): OngletParametres {
  return v === 'comportement' && gerer ? 'comportement' : 'notifications';
}

/** Bascule un canal (cloche ou e-mail) d'un événement. */
export function basculerCanal(
  p: WorkNotificationPreferences,
  event: WorkNotificationEvent,
  canal: 'bell' | 'email',
): WorkNotificationPreferences {
  return {
    ...p,
    events: { ...p.events, [event]: { ...p.events[event], [canal]: !p.events[event][canal] } },
  };
}

/** Tout couper ou tout rétablir sur un canal. */
export function toutLeCanal(
  p: WorkNotificationPreferences,
  canal: 'bell' | 'email',
  valeur: boolean,
): WorkNotificationPreferences {
  const events = { ...p.events };
  for (const e of WORK_NOTIFICATION_EVENTS) events[e] = { ...events[e], [canal]: valeur };
  return { ...p, events };
}

export function corpsPreferences(
  p: WorkNotificationPreferences,
  revision: number,
): PutWorkNotificationPreferencesBody {
  return { expectedRevision: revision, events: p.events, digest: p.digest };
}

/** Heures proposées pour le résumé (Kinshasa). */
export const HEURES_RESUME = Array.from({ length: 24 }, (_, h) => h);
export const libelleHeure = (h: number): string => `${String(h).padStart(2, '0')} h 00`;

export const JOURS = [
  { iso: 1, court: 'Lun', long: 'lundi' },
  { iso: 2, court: 'Mar', long: 'mardi' },
  { iso: 3, court: 'Mer', long: 'mercredi' },
  { iso: 4, court: 'Jeu', long: 'jeudi' },
  { iso: 5, court: 'Ven', long: 'vendredi' },
  { iso: 6, court: 'Sam', long: 'samedi' },
  { iso: 7, court: 'Dim', long: 'dimanche' },
] as const;

/**
 * Rôles qui gèrent les projets (`work.manage`) et peuvent donc figurer parmi les
 * créateurs. La direction (Propriétaire, Administrateur) crée toujours.
 */
export const ROLES_CREATEURS = [
  { role: 'owner', label: 'Propriétaire', direction: true },
  { role: 'admin', label: 'Administrateur', direction: true },
  { role: 'finance_director', label: 'Directeur financier', direction: false },
] as const;

/** Bascule un jour ouvré ; refuse de retirer le dernier. */
export function basculerJour(jours: readonly number[], iso: number): number[] {
  const next = jours.includes(iso) ? jours.filter((j) => j !== iso) : [...jours, iso];
  return next.length === 0 ? [...jours] : [...next].sort((a, b) => a - b);
}

/**
 * Corps de `PUT /work/settings` : les réglages existants (étiquettes, colonnes,
 * « échéance proche ») repris tels quels, le comportement remplacé par `patch`.
 */
export function corpsComportement(
  s: WorkSettingsView,
  patch: Partial<WorkBehaviorSettings> & { dueSoonDays?: number },
): PutWorkSettingsBody {
  return {
    expectedRevision: s.revision,
    labels: s.labels,
    defaultColumns: s.defaultColumns,
    dueSoonDays: patch.dueSoonDays ?? s.dueSoonDays,
    projectCreatorRoles: patch.projectCreatorRoles !== undefined ? patch.projectCreatorRoles : s.projectCreatorRoles,
    defaultVisibility: patch.defaultVisibility ?? s.defaultVisibility,
    defaultView: patch.defaultView ?? s.defaultView,
    workingDays: patch.workingDays ?? s.workingDays,
    autoArchiveCompletedDays:
      patch.autoArchiveCompletedDays !== undefined ? patch.autoArchiveCompletedDays : s.autoArchiveCompletedDays,
    managersModerateComments: patch.managersModerateComments ?? s.managersModerateComments,
    showTaskNumbers: patch.showTaskNumbers ?? s.showTaskNumbers,
  };
}

/** « Qui peut créer » : `null` (tous les gestionnaires) ou la liste cochée. */
export function createurs(
  actuels: readonly string[] | null,
  role: string,
  coche: boolean,
): string[] | null {
  const base = actuels ?? ROLES_CREATEURS.map((r) => r.role);
  const next = coche ? [...new Set([...base, role])] : base.filter((r) => r !== role);
  const tous = ROLES_CREATEURS.every((r) => next.includes(r.role));
  return tous ? null : next;
}
