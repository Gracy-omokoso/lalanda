// Corps de requête de GROW (ADR-0032 § 6). Tous `.strict()` : un champ inconnu est
// refusé (400), jamais ignoré. Un montant est une chaîne décimale (docs/26).

import { JOURNEY_STAGES } from '@lalanda/engine';
import { BadRequestException } from '@nestjs/common';
import { z, type ZodError } from 'zod';

const OBJECT_ID = /^[0-9a-f]{24}$/;

export const PutGrowProfileSchema = z
  .object({
    referenceProjectId: z.string().regex(OBJECT_ID, 'Identifiant de projet invalide.').nullable(),
    declaredStage: z.enum(JOURNEY_STAGES).nullable(),
    recurringCatalogItemIds: z
      .array(z.string().regex(OBJECT_ID, 'Identifiant d’article invalide.'))
      .max(200, '200 articles récurrents au plus.')
      .refine((ids) => new Set(ids).size === ids.length, 'Articles en double.'),
  })
  .strict();
export type PutGrowProfile = z.infer<typeof PutGrowProfileSchema>;

export const PutChecklistSchema = z.object({ done: z.boolean() }).strict();

export const PutDeclaredCashSchema = z
  .object({
    amount: z
      .string({ invalid_type_error: 'Le montant est une chaîne décimale (ex. « 1250.00 »).' })
      .regex(/^\d{1,15}(\.\d{1,2})?$/, 'Montant positif, deux décimales au plus.'),
    currency: z.string().regex(/^[A-Z]{3}$/, 'Code de devise ISO à trois lettres.'),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ.'),
  })
  .strict();
export type PutDeclaredCash = z.infer<typeof PutDeclaredCashSchema>;

export function invalidRequest(error: ZodError): never {
  throw new BadRequestException({
    code: 'INVALID_REQUEST',
    message: 'Corps de requête invalide.',
    details: {
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    },
  });
}
