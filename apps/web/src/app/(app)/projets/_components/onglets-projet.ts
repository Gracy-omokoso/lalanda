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

/**
 * Ordre d'affichage (ADR-0039 § 8, revu par ADR-0057 « façon Asana ») : Aperçu,
 * Liste, Tableau, Chronologie, Calendrier, Fichiers, Marge, Réglages. Les
 * SEGMENTS ne changent pas (liens existants, notifications) : seul le libellé
 * « Kanban » devient « Tableau », et « Documents » devient « Fichiers ».
 */
export const ONGLETS_PROJET: readonly OngletProjet[] = [
  // ADR-0057 : santé, avancement, charge, jalons et retards.
  { segment: 'apercu', label: 'Aperçu', action: null, livre: true },
  { segment: 'liste', label: 'Liste', action: null, livre: true },
  { segment: 'kanban', label: 'Tableau', action: null, livre: true },
  // Lot L3b — vues temporelles.
  { segment: 'chronologie', label: 'Chronologie', action: null, livre: true },
  { segment: 'calendrier', label: 'Calendrier', action: null, livre: true },
  // ADR-0046 — S9 : documents liés et équipements affectés au projet.
  { segment: 'documents', label: 'Fichiers', action: 'docs.read', livre: true },
  // Lot L4a — marge encaissée (la carte signale elle-même un `sales.read` manquant).
  { segment: 'marge', label: 'Marge', action: 'treasury.read', livre: true },
  { segment: 'reglages', label: 'Réglages', action: 'work.manage', livre: true },
];

/** Onglet par défaut de `/projets/[id]` (ADR-0057 : l'Aperçu). */
export const ONGLET_DEFAUT = 'apercu';

/**
 * Onglet où ouvrir un lien de tâche (`/projets/<id>?tache=<id>`, notifications) :
 * la Liste, pour voir la tâche dans son groupe à côté du panneau.
 */
export const ONGLET_TACHE = 'liste';

/** Onglet cible de `/projets/<id>` selon la requête (pur, testé). */
export function ongletDEntree(requete: Readonly<Record<string, unknown>>): string {
  return typeof requete['tache'] === 'string' && requete['tache'] !== ''
    ? ONGLET_TACHE
    : ONGLET_DEFAUT;
}

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
