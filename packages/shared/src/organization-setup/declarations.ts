// Déclarations mémorisées de la mise en route (ADR-0052 § 4). ADR-0052 — O2/O3.
//
// La progression reste DÉDUITE des données (ADR-0030 § 8) ; seules sont mémorisées, côté
// serveur, les déclarations que l'on ne peut pas lire ailleurs :
//   - « pays confirmé » (étape 1) ;
//   - « pas maintenant » pour les quatre étapes facultatives de § 4 (« je travaille seul »
//     pour l'équipe) ;
//   - le choix des modules (tranche ADR-0030 D3, remplace le `localStorage`, constat F5).
//
// Aucune règle fiscale ni juridique ici : une déclaration n'ouvre ni ne ferme aucun acte.

import { z } from 'zod';

import type { OrganizationSetupStepId } from './constants.js';

/**
 * Étapes pour lesquelles « pas maintenant » peut être déclaré (§ 4, champ `deferred`).
 * Jamais l'étape 2 (critère 7) : la fiche fiscale garde l'émission de toute facture.
 */
export const ORGANIZATION_SETUP_DEFERRABLE_STEPS = [
  'normalisation',
  'tresorerie',
  'comptabilite',
  'equipe',
] as const satisfies readonly OrganizationSetupStepId[];
export type OrganizationSetupDeferrableStep = (typeof ORGANIZATION_SETUP_DEFERRABLE_STEPS)[number];

export function isDeferrableStep(id: string): id is OrganizationSetupDeferrableStep {
  return (ORGANIZATION_SETUP_DEFERRABLE_STEPS as readonly string[]).includes(id);
}

/** Les trois modules de la navigation (ADR-0038), dans leur ordre d'affichage. */
export const ORGANIZATION_SETUP_MODULE_IDS = ['build', 'run', 'grow'] as const;
export type OrganizationSetupModuleId = (typeof ORGANIZATION_SETUP_MODULE_IDS)[number];

/**
 * `PUT /organizations/current/setup/modules` : `null` = tous les modules (choix fait).
 * Au moins un module, sans doublon ; l'ordre est normalisé par le serveur.
 */
export const PutOrganizationSetupModulesSchema = z
  .object({
    modules: z
      .array(z.enum(ORGANIZATION_SETUP_MODULE_IDS))
      .min(1)
      .max(ORGANIZATION_SETUP_MODULE_IDS.length)
      .refine((m) => new Set(m).size === m.length, { message: 'Module en double.' })
      .nullable(),
  })
  .strict();
export type PutOrganizationSetupModulesInput = z.infer<typeof PutOrganizationSetupModulesSchema>;

/** Ordre canonique ; `null` quand les trois sont choisis (= tous). */
export function normalizeSetupModules(
  modules: readonly OrganizationSetupModuleId[] | null,
): OrganizationSetupModuleId[] | null {
  if (modules === null) return null;
  const propres = ORGANIZATION_SETUP_MODULE_IDS.filter((m) => modules.includes(m));
  return propres.length === ORGANIZATION_SETUP_MODULE_IDS.length ? null : propres;
}
