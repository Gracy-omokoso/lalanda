// Contrat d'entrée de `/admin/integrations` — ADR-0013 §4.
//
// Toute la validation est ici, en Zod, et elle est STRICTE au sens fort : la
// liste blanche des clés de `config` et celle des noms de secrets sont
// consultées par fournisseur, et toute clé hors liste est refusée en 400. C'est
// le contrôle qui « empêche qu'un secret soit glissé par erreur dans `config` et
// stocké en clair » (ADR-0013 §1).

import { z } from 'zod';

import { PROVIDER_SPECS, type IntegrationProvider } from './providers.js';

/** Longueur maximale d'un secret accepté — borne anti-abus, pas une règle métier. */
export const MAX_SECRET_LENGTH = 4096;
const MAX_CONFIG_VALUE_LENGTH = 2048;

/**
 * Valeur d'un secret dans un `PUT` (ADR-0013 §4, « écriture par remplacement ») :
 *   - absent  → laissé inchangé;
 *   - `null`  → supprimé;
 *   - chaîne  → remplace.
 * Il n'existe pas de modification partielle d'un secret.
 */
const SecretValueSchema = z.union([z.string().min(1).max(MAX_SECRET_LENGTH), z.null()]);

const ConfigValueSchema = z.union([
  z.string().max(MAX_CONFIG_VALUE_LENGTH),
  z.number(),
  z.boolean(),
]);

export const UpdateIntegrationSchema = z
  .object({
    enabled: z.boolean().optional(),
    config: z.record(ConfigValueSchema).optional(),
    secrets: z.record(SecretValueSchema).optional(),
  })
  .strict();

export type UpdateIntegrationInput = z.infer<typeof UpdateIntegrationSchema>;

export interface WhitelistViolation {
  field: 'config' | 'secrets';
  key: string;
}

/**
 * Contrôle de liste blanche, séparé du schéma Zod parce qu'il dépend du
 * FOURNISSEUR, connu seulement à la lecture du paramètre de route.
 *
 * Retourne la liste complète des violations et non la première : un opérateur qui
 * corrige une clé à la fois pour découvrir la suivante finit par contourner le
 * formulaire.
 */
export function findWhitelistViolations(
  provider: IntegrationProvider,
  input: UpdateIntegrationInput,
): WhitelistViolation[] {
  const spec = PROVIDER_SPECS[provider];
  const violations: WhitelistViolation[] = [];
  for (const key of Object.keys(input.config ?? {})) {
    if (!spec.config.includes(key)) violations.push({ field: 'config', key });
  }
  for (const key of Object.keys(input.secrets ?? {})) {
    if (!spec.secrets.includes(key)) violations.push({ field: 'secrets', key });
  }
  return violations;
}

/** Corps de `POST /admin/reauth` (ADR-0013 §5). */
export const ReauthSchema = z.object({ password: z.string().min(1).max(256) }).strict();
