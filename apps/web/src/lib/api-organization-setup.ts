// Déclarations de la mise en route (ADR-0052 § 4). ADR-0052 — O2/O3.
//
// Fichier à part plutôt qu'un bloc de plus dans `api.ts` (zone de conflit de l'ADR) ; la
// lecture `api.getOrganizationSetup` (O0) reste dans `api.ts`. Chaque écriture renvoie la
// vue relue : l'écran n'a pas à recalculer l'avancement.

import type {
  OrganizationSetupDeferrableStep,
  OrganizationSetupModuleId,
  OrganizationSetupView,
} from '@lalanda/shared/organization-setup';

import { jsonRequest } from './api';

const BASE = '/organizations/current/setup';

export const organizationSetupApi = {
  /** Étape 1 : le pays est confirmé (`organization.manage`). */
  confirmCountry: () =>
    jsonRequest<OrganizationSetupView>(`${BASE}/country-confirmation`, { method: 'PUT', body: {} }),
  /** « Pas maintenant » / « je travaille seul » (action de l'étape). */
  defer: (step: OrganizationSetupDeferrableStep) =>
    jsonRequest<OrganizationSetupView>(`${BASE}/deferred/${step}`, { method: 'PUT', body: {} }),
  /** Retire le report : l'étape redevient « à faire ». */
  undefer: (step: OrganizationSetupDeferrableStep) =>
    jsonRequest<OrganizationSetupView>(`${BASE}/deferred/${step}`, { method: 'DELETE' }),
  /** Modules de l'organisation (`organization.manage`) ; `null` = tous. */
  putModules: (modules: readonly OrganizationSetupModuleId[] | null) =>
    jsonRequest<OrganizationSetupView>(`${BASE}/modules`, {
      method: 'PUT',
      body: { modules },
    }),
};
