import { z } from 'zod';

/**
 * Validation du PUT /projects/:id/objectives (S18d — docs/01).
 *
 * PUT = remplacement complet : un champ absent efface l'objectif correspondant.
 * Cibles ≥ 0 (les objectifs sont des montants cibles, pas des écarts).
 */
export const PutObjectivesSchema = z
  .object({
    ca_cible_an1: z.number().finite().min(0).optional(),
    ca_cible_an5: z.number().finite().min(0).optional(),
    resultat_net_cible_an1: z.number().finite().min(0).optional(),
    tresorerie_cible: z.number().finite().min(0).optional(),
  })
  .strict();

export type PutObjectivesInput = z.infer<typeof PutObjectivesSchema>;

/** Clés d'objectifs — utilisées par le calcul du taux d'atteinte. */
export const OBJECTIVE_KEYS = [
  'ca_cible_an1',
  'ca_cible_an5',
  'resultat_net_cible_an1',
  'tresorerie_cible',
] as const;

export type ObjectiveKey = (typeof OBJECTIVE_KEYS)[number];
