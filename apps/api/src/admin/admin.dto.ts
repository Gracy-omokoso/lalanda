// Contrats d'entrée de `/admin` (S21b, ADR-0053 — P2). Tous `.strict()` : un champ
// inattendu est un 400 et non un silence — c'est ce qui transforme un `userId` glissé
// dans un corps en refus explicite plutôt qu'en action sur autrui.
//
// Les corps des routes de la console viennent de `@lalanda/shared/platform` (lot P0) ;
// ce fichier n'ajoute que les corps des routes HISTORIQUES, servies une version
// (ADR-0053 § 7), désormais motivées comme leurs remplaçantes.

import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import { PLATFORM_LIMITS, PLATFORM_REASON_CATEGORIES } from '@lalanda/shared/platform';

import { PLANS } from '../billing/entitlements.js';

export {
  BlockUserInputSchema,
  PlatformSearchQuerySchema,
  PlatformViewReasonQuerySchema,
  RestoreOrganizationInputSchema,
  SuspendOrganizationInputSchema,
  UnblockUserInputSchema,
  grantPlatformRoleInputSchema,
} from '@lalanda/shared/platform';

const reasonCategory = z.enum(PLATFORM_REASON_CATEGORIES, {
  error: 'Catégorie de motif obligatoire.',
});
const internalNote = z
  .string({ error: 'Note interne obligatoire.' })
  .trim()
  .min(PLATFORM_LIMITS.internalNoteMinLength)
  .max(PLATFORM_LIMITS.internalNoteMaxLength);
const clientMessage = z
  .string({ error: 'Message destiné au client obligatoire.' })
  .trim()
  .min(1)
  .max(PLATFORM_LIMITS.clientMessageMaxLength);

/**
 * `PATCH /admin/organizations/:id/plan` (historique, remplacé par les octrois du lot P3) :
 * motif obligatoire depuis ADR-0053 (F4, F6) — catégorie, message client, note interne.
 */
export const SetPlanSchema = z
  .object({
    plan: z.enum(PLANS as unknown as [string, ...string[]]),
    reasonCategory,
    clientMessage,
    internalNote,
  })
  .strict()
  .transform((v) => ({ ...v, plan: v.plan as (typeof PLANS)[number] }));

/**
 * `PATCH /admin/users/:id/disabled` (historique, remplacé par `block` / `unblock`) :
 * note interne obligatoire dans les deux sens, catégorie obligatoire pour bloquer (F6).
 */
export const DisableUserSchema = z
  .object({
    disabled: z.boolean(),
    reasonCategory: reasonCategory.optional(),
    internalNote,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.disabled && v.reasonCategory === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['reasonCategory'],
        message: 'Catégorie de motif obligatoire.',
      });
    }
  });

/** Champs dont l'absence ou l'insuffisance signifie « motif manquant ». */
const REASON_FIELDS = new Set([
  'reasonCategory',
  'internalNote',
  'clientMessage',
  'reason',
  'liftReason',
  'liftedClientMessage',
]);

/**
 * 400 d'un corps refusé, avec un code stable : celui que porte le schéma
 * (`params.code`), sinon `REASON_REQUIRED` si un champ de motif est en cause, sinon
 * `VALIDATION_ERROR`.
 */
export function invalidBody(error: z.ZodError, fallbackMessage: string): BadRequestException {
  const issues = error.issues;
  const codeOf = (i: (typeof issues)[number]): string | undefined => {
    const c = (i as { params?: { code?: unknown } }).params?.code;
    return typeof c === 'string' ? c : undefined;
  };
  const codedIssue = issues.find((i) => codeOf(i) !== undefined);
  const coded = codedIssue ? codeOf(codedIssue) : undefined;
  const reasonIssue = issues.find((i) => REASON_FIELDS.has(String(i.path[0] ?? '')));
  const code = coded ?? (reasonIssue ? 'REASON_REQUIRED' : 'VALIDATION_ERROR');
  const message = codedIssue?.message ?? fallbackMessage;
  return new BadRequestException({
    code,
    message,
    fields: issues.map((i) => i.path.join('.')).filter(Boolean),
  });
}
