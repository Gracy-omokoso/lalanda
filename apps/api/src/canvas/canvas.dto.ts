import { z } from 'zod';

/**
 * Validation du PUT /projects/:id/canvas (S18d — docs/05).
 *
 * PUT = remplacement complet : le corps décrit les 9 blocs dans leur intégralité.
 * - `.strict()` partout → un bloc inconnu ou un champ de carte inconnu est refusé;
 * - texte ≤ 500 caractères, max 20 cartes par bloc (canvas = synthèse, pas un wiki).
 */

const CanvasCardSchema = z
  .object({
    id: z.string().min(1).max(64),
    texte: z.string().min(1).max(500),
    ordre: z.number().int().min(0),
  })
  .strict();

const BlockSchema = z.array(CanvasCardSchema).max(20).default([]);

export const PutCanvasSchema = z
  .object({
    segments_clients: BlockSchema,
    proposition_valeur: BlockSchema,
    canaux: BlockSchema,
    relations_clients: BlockSchema,
    revenus: BlockSchema,
    ressources_cles: BlockSchema,
    activites_cles: BlockSchema,
    partenaires_cles: BlockSchema,
    couts: BlockSchema,
  })
  .strict();

export type PutCanvasInput = z.infer<typeof PutCanvasSchema>;
