import { z } from 'zod';

import { CANVAS_BLOCKS, type CanvasBlockId } from './canvas.schema.js';

/**
 * Validation du PUT /projects/:id/canvas (S18d — docs/05).
 *
 * PUT = remplacement complet : le corps décrit les 9 blocs dans leur intégralité.
 * - **les 9 blocs sont REQUIS** : voir la note « suppression par omission » ci-dessous;
 * - `.strict()` partout → un bloc inconnu ou un champ de carte inconnu est refusé;
 * - texte ≤ 500 caractères, max 20 cartes par bloc (canvas = synthèse, pas un wiki);
 * - ids de cartes uniques dans un bloc (ils servent de clé stable côté UI et
 *   d'ancre des futurs liens carte ↔ hypothèse financière, docs/05).
 *
 * La forme est dérivée de `CANVAS_BLOCKS` : ajouter un bloc au schéma Mongoose
 * met automatiquement à jour la validation, jamais de liste dupliquée.
 *
 * ── Suppression par omission (revue CTO S18d, I1) ───────────────
 * Les blocs portaient initialement `.default([])`. Un `PUT` avec `{}` était donc
 * accepté et **vidait les neuf blocs** en consommant une version et une révision :
 * une API destructrice par simple omission, contraire à docs/05 (« la suppression
 * d'une carte ne cascade pas »). Un bloc omis est désormais une erreur 400, jamais
 * un effacement silencieux. Vider un bloc reste possible — explicitement, en
 * envoyant `[]`. Une sémantique de mise à jour partielle relèverait d'un `PATCH`
 * dédié, pas d'un `PUT` permissif.
 */

export const MAX_CARD_TEXT_LENGTH = 500;
export const MAX_CARDS_PER_BLOCK = 20;

/**
 * Ids de cartes : générés par le client (`crypto.randomUUID()`), donc
 * alphanumériques et tirets. Le premier caractère doit être alphanumérique, ce
 * qui écarte notamment `__proto__` — défense en profondeur : aucun puits
 * d'injection de prototype n'existe aujourd'hui (les ids ne servent jamais de
 * clé d'objet), mais rien ne garantit que ce soit vrai des consommateurs futurs.
 */
const CARD_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

const CanvasCardSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(CARD_ID_PATTERN, 'id de carte invalide (attendu : ^[a-z0-9][a-z0-9_-]*$)'),
    texte: z.string().min(1).max(MAX_CARD_TEXT_LENGTH),
    ordre: z.number().int().min(0),
  })
  .strict();

const BlockSchema = z
  .array(CanvasCardSchema)
  .max(MAX_CARDS_PER_BLOCK)
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
