// DTO d'entrée/sortie pour POST /ai/corrective-actions (S14a — agent D).
//
// L'IA consomme les lignes de la feuille "ratios" produites par le moteur financier
// (feux tricolores rouge/orange) et propose 2-4 corrections concrètes.
// Elle NE recalcule PAS et NE modifie JAMAIS les feuilles officielles :
// elle produit uniquement du texte + une magnitude suggérée.

import { z } from 'zod';

/** Statut du feu tricolore d'un ratio (repris à l'identique du moteur). */
export const SeuilStatutSchema = z.enum(['vert', 'orange', 'rouge']);

/** Ligne financière normalisée telle que produite par l'engine `evaluateTemplate`. */
export const EvaluateLineSchema = z.object({
  sheetId: z.string(),
  lineId: z.string(),
  label: z.string(),
  value: z.number().finite(),
  format: z.enum(['money', 'number', 'percent']),
  seuil: z
    .object({
      valeur: z.number().finite(),
      direction: z.enum(['min', 'max']),
      statut: SeuilStatutSchema,
    })
    .optional(),
});
export type EvaluateLine = z.infer<typeof EvaluateLineSchema>;

/** Payload d'entrée : résultat d'un evaluate (lines complètes + drivers). */
export const CorrectiveActionsRequestSchema = z.object({
  templateSlug: z.string().min(1),
  drivers: z.record(z.string(), z.number().finite()).default({}),
  lines: z.array(EvaluateLineSchema).min(1),
  devise: z.string().optional(),
});
export type CorrectiveActionsRequest = z.infer<typeof CorrectiveActionsRequestSchema>;

/** Une action corrective proposée par l'IA (ou le fallback déterministe). */
export const CorrectiveActionSchema = z.object({
  ratio: z.string().min(1),
  severity: z.enum(['orange', 'rouge']),
  suggestion: z.string().min(1),
  expected_impact: z.string().min(1),
});
export type CorrectiveAction = z.infer<typeof CorrectiveActionSchema>;

/** Réponse : entre 0 (aucune anomalie) et 4 actions maximum. */
export const CorrectiveActionsResponseSchema = z.object({
  actions: z.array(CorrectiveActionSchema).max(4),
  source: z.enum(['llm', 'fallback']),
});
export type CorrectiveActionsResponse = z.infer<typeof CorrectiveActionsResponseSchema>;
