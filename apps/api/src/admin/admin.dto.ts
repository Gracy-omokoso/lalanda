// Contrats d'entrée de `/admin` (S21b). Tous `.strict()` : un champ inattendu
// est un 400 et non un silence — c'est ce qui transforme un `userId` glissé dans
// un corps en refus explicite plutôt qu'en action sur autrui.

import { z } from 'zod';

import { PLANS } from '../billing/entitlements.js';
import { PLATFORM_ROLES } from '../authz/permissions.js';

export const SetPlanSchema = z
  .object({ plan: z.enum(PLANS as unknown as [string, ...string[]]) })
  .strict()
  .transform((v) => ({ plan: v.plan as (typeof PLANS)[number] }));

/**
 * Motif de suspension : au moins 10 caractères.
 *
 * Le minimum n'est pas décoratif. Une suspension se relit des mois plus tard,
 * souvent par quelqu'un d'autre, parfois devant un client mécontent. « test »
 * ou « ok » ne répondent à aucune des questions qu'on se posera alors.
 */
export const SuspendOrganizationSchema = z
  .object({ reason: z.string().trim().min(10).max(500) })
  .strict();

export const GrantPlatformRoleSchema = z
  .object({
    role: z.enum(PLATFORM_ROLES as unknown as [string, ...string[]]),
    /**
     * Motif — libre en base, mais docs/12 le rend obligatoire côté processus
     * pour le support : « l'accès support doit être limité, visible et audité ».
     */
    reason: z.string().trim().max(500).optional(),
    /**
     * Expiration facultative (ISO 8601). Recommandée pour `platform_support` :
     * un accès permanent au support contredit « durée limitée » (docs/12).
     */
    expiresAt: z.string().datetime().optional(),
  })
  .strict();

export const DisableUserSchema = z.object({ disabled: z.boolean() }).strict();
