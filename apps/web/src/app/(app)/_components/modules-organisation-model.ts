// Choix des modules de l'organisation, côté serveur (ADR-0052 § 4, tranche ADR-0030 D3).
// ADR-0052 — O3.
//
// Le choix vivait dans le `localStorage`, par organisation ET par navigateur (constat F5).
// Il est désormais lu dans `GET /organizations/current/setup` et enregistré par un
// détenteur d'`organization.manage` (décision ouverte n° 3, valeur par défaut). L'ancienne
// valeur locale est reprise UNE fois puis effacée. Logique pure : la coquille exécute.

import type { ModuleId } from '@lalanda/ui';

import { lireModules } from './nav-model';

/** Ancien marqueur local « choix fait, tous les modules ». */
export const TOUS_LOCAL = '"*"';

export type PlanModules =
  /** Le serveur a un choix : il fait foi ; une valeur locale est effacée. */
  | { type: 'serveur'; effacerLocal: boolean }
  /** Pas de choix serveur, une valeur locale, et le droit de l'enregistrer : reprise unique. */
  | { type: 'migrer'; modules: ModuleId[] | null }
  /**
   * Pas de choix serveur, une valeur locale, sans le droit de l'enregistrer : elle range
   * encore l'accueil de CET appareil (aucun accès n'en dépend), sans être effacée — elle
   * sera reprise par le premier gérant qui ouvrira l'application sur ce navigateur ou
   * remplacée dès qu'un choix d'organisation existe.
   */
  | { type: 'local'; modules: ModuleId[] | null }
  /** Rien nulle part : tous les modules, aucun choix. */
  | { type: 'aucun' };

export function planModules(entree: {
  choisiServeur: boolean;
  brutLocal: string | null;
  peutEnregistrer: boolean;
}): PlanModules {
  if (entree.choisiServeur) return { type: 'serveur', effacerLocal: entree.brutLocal !== null };
  if (entree.brutLocal === null) return { type: 'aucun' };
  const modules = entree.brutLocal === TOUS_LOCAL ? null : lireModules(entree.brutLocal);
  return entree.peutEnregistrer ? { type: 'migrer', modules } : { type: 'local', modules };
}
