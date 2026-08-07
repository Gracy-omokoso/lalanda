import { z } from 'zod';

import { CANVAS_BLOCKS, type CanvasBlockId } from './canvas.schema.js';

/**
 * Validation du PUT /projects/:id/canvas (S18d — docs/05).
 *
 * PUT = remplacement complet : le corps décrit les 9 blocs dans leur intégralité.
 * - `.strict()` partout → un bloc inconnu ou un champ de carte inconnu est refusé;
 * - texte ≤ 500 caractères, max 20 cartes par bloc (canvas = synthèse, pas un wiki);
 * - ids de cartes uniques dans un bloc (ils servent de clé stable côté UI et
 *   d'ancre des futurs liens carte ↔ hypothèse financière, docs/05).
 *
 * La forme est dérivée de `CANVAS_BLOCKS` : ajouter un bloc au schéma Mongoose
 * met automatiquement à jour la validation, jamais de liste dupliquée.
 */

export const MAX_CARD_TEXT_LENGTH = 500;
export const MAX_CARDS_PER_BLOCK = 20;

const CanvasCardSchema = z
  .object({
    id: z.string().min(1).max(64),
    texte: z.string().min(1).max(MAX_CARD_TEXT_LENGTH),
    ordre: z.number().int().min(0),
  })
  .strict();

const BlockSchema = z
  .array(CanvasCardSchema)
  .max(MAX_CARDS_PER_BLOCK)
  .default([])
  .refine((cards) => new Set(cards.map((c) => c.id)).size === cards.length, {
    message: 'Ids de cartes dupliqués dans un bloc',
  });

export const PutCanvasSchema = z
  .object(
    Object.fromEntries(CANVAS_BLOCKS.map((bloc) => [bloc, BlockSchema])) as Record<
      CanvasBlockId,
      typeof BlockSchema
    >,
  )
  .strict();

export type PutCanvasInput = z.infer<typeof PutCanvasSchema>;
