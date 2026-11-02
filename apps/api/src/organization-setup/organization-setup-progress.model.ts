// Avancement de la mise en route, par organisation, pour le sélecteur. ADR-0052 — O1.
//
// Modèle PUR : il compte les étapes de la vue de § 3 (mêmes règles, même calcul), sans
// rien relire. Une étape « pas maintenant » n'est pas une faute (§ 3) : elle compte comme
// traitée, comme la carte « Votre société » qui disparaît quand tout est `done` ou
// `deferred`.

import { ORGANIZATION_SETUP_STEP_IDS } from '@lalanda/shared/organization-setup';

import {
  buildOrganizationSetupView,
  type OrganizationSetupFacts,
} from './organization-setup.model.js';

export interface OrganizationSetupProgress {
  organizationId: string;
  /** Étapes faites (donnée lue sur le serveur). */
  done: number;
  /** Étapes déclarées « pas maintenant ». */
  deferred: number;
  /** Nombre d'étapes du parcours (neuf). */
  total: number;
}

export function setupProgress(
  organizationId: string,
  facts: OrganizationSetupFacts,
): OrganizationSetupProgress {
  // Aucun droit : `canAct` n'est pas lu ici, seul l'état des étapes compte.
  const { steps } = buildOrganizationSetupView(organizationId, facts, []);
  return {
    organizationId,
    done: steps.filter((s) => s.state === 'done').length,
    deferred: steps.filter((s) => s.state === 'deferred').length,
    total: ORGANIZATION_SETUP_STEP_IDS.length,
  };
}
