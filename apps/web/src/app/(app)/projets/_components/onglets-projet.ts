// Onglets de la page d'un projet (ADR-0039 § 8) — point de branchement du lot L3b.
//
// La page `/projets/[id]` porte un en-tête et des onglets ; chaque onglet est
// une route enfant (`/projets/[id]/<segment>`). L'interface ne promet rien qui
// n'existe pas (ADR-0016) : un onglet dont la vue n'est pas livrée est déclaré
// ici avec `livre: false` et n'est PAS affiché.
//
// Pour brancher le Calendrier ou la Chronologie (lot L3b) : créer la route
// `projets/[id]/calendrier/page.tsx` (ou `chronologie/`), puis passer `livre`
// à `true` ci-dessous — une ligne, rien d'autre. Le contexte du projet
// (`useProjet()`, `project-context.tsx`) fournit projet, tâches, réglages,
// membres et l'ouverture du panneau de tâche.

import type { OrgAction } from '@/lib/api';

export interface OngletProjet {
  segment: string;
  label: string;
  /** Action exigée pour AFFICHER l'onglet, ou `null` (déjà `work.read` pour entrer). */
  action: OrgAction | null;
  /** La vue existe-t-elle ? Un onglet non livré n'est jamais rendu. */
  livre: boolean;
}

/** Ordre d'affichage (ADR-0039 § 8). Temps, Marge, Activité : lots suivants. */
export const ONGLETS_PROJET: readonly OngletProjet[] = [
  { segment: 'liste', label: 'Liste', action: null, livre: true },
  { segment: 'kanban', label: 'Kanban', action: null, livre: true },
  // Lot L3b — vues temporelles.
  { segment: 'calendrier', label: 'Calendrier', action: null, livre: false },
  { segment: 'chronologie', label: 'Chronologie', action: null, livre: false },
  { segment: 'reglages', label: 'Réglages', action: 'work.manage', livre: true },
];

/** Onglet par défaut de `/projets/[id]`. */
export const ONGLET_DEFAUT = 'liste';

export function ongletsVisibles(
  actions: readonly OrgAction[] | null,
  onglets: readonly OngletProjet[] = ONGLETS_PROJET,
): OngletProjet[] {
  return onglets.filter(
    (o) => o.livre && (o.action === null || (actions !== null && actions.includes(o.action))),
  );
}

/** Segment d'onglet du chemin `/projets/<id>/<segment>[/…]`, ou `null`. */
export function ongletDuChemin(pathname: string): string | null {
  const m = /^\/projets\/[^/]+\/([^/?#]+)/.exec(pathname);
  return m ? m[1]! : null;
}
