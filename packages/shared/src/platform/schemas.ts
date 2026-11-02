// Corps de requête et vues de la console Lalanda (ADR-0053 — P0). Les lots P2 à P7
// RÉUTILISENT ces briques dans leurs contrôleurs ; aucun ne les recopie.
//
// Règles communes : corps `.strict()` (un champ inattendu est un 400, jamais un silence :
// un `userId` glissé dans un corps n'agit pas sur autrui), codes métier stables dans
// `params.code`, dates en ISO 8601. Les règles qui exigent la base (détenteurs d'une
// action, appartenance de l'opérateur, nombre de destinataires) ne sont PAS ici : elles
// sont jugées par les fonctions de décision de l'API (`platform-actions.ts`).

import { z } from 'zod';

import { PLANS } from '../pricing/index.js';
import {
  PLATFORM_ACTIONS,
  PLATFORM_LIMITS as L,
  PLATFORM_REASON_CATEGORIES,
  PLATFORM_ROLE_SLUGS,
  PLATFORM_SUSPENSION_MODES,
  PLATFORM_VIEW_REASONS,
  type PlatformAction,
  type PlatformRoleSlug,
} from './constants.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Identifiant Mongo (24 hexadécimaux), ramené en minuscules. */
export const PlatformTargetId = z
  .string()
  .refine((v) => OBJECT_ID.test(v), {
    message: 'Identifiant invalide.',
    params: { code: 'PLATFORM_ID_INVALID' },
  })
  .transform((v) => v.toLowerCase());

const reasonCategory = z.enum(PLATFORM_REASON_CATEGORIES, {
  error: 'Catégorie de motif obligatoire.',
});

const isoDateTime = z.iso.datetime({ message: 'Date attendue au format ISO 8601.' });

/**
 * Chaîne obligatoire d'au moins `min` caractères (après `trim`), dont le refus porte un
 * code stable dans `params.code` (zod 4 n'accepte `params` que sur un `custom`).
 */
function textAtLeast(min: number, max: number, code: string, message: string) {
  return z
    .string({ error: message })
    .trim()
    .max(max)
    .superRefine((v, ctx) => {
      if (v.length < min) ctx.addIssue({ code: 'custom', message, params: { code } });
    });
}

const internalNote = textAtLeast(
  L.internalNoteMinLength,
  L.internalNoteMaxLength,
  'REASON_REQUIRED',
  `Note interne : ${L.internalNoteMinLength} caractères au moins.`,
);

const clientMessage = textAtLeast(
  1,
  L.clientMessageMaxLength,
  'REASON_REQUIRED',
  'Message destiné au client obligatoire.',
);

// ── Recherche et lecture journalisée (§ 2.6) ───────────────────────────────────

/** `GET /admin/users?q=` : trois caractères au moins, sinon `400 SEARCH_REQUIRED`. */
export const PlatformSearchQuerySchema = z.object({
  q: textAtLeast(
    L.searchMinLength,
    200,
    'SEARCH_REQUIRED',
    `Recherche : ${L.searchMinLength} caractères au moins.`,
  ),
});

/** `?reason=` d'ouverture d'une fiche détaillée, sinon `400 REASON_REQUIRED`. */
export const PlatformViewReasonQuerySchema = z.object({
  reason: z.enum(PLATFORM_VIEW_REASONS, { error: 'Motif de consultation obligatoire.' }),
});

// ── Comptes et organisations (§ 6.1) ───────────────────────────────────────────

export const SuspendOrganizationInputSchema = z
  .object({
    reasonCategory,
    clientMessage,
    internalNote,
    mode: z.enum(PLATFORM_SUSPENSION_MODES).default('read_only'),
  })
  .strict();

export const RestoreOrganizationInputSchema = z
  .object({ liftReason: internalNote, liftedClientMessage: clientMessage })
  .strict();

export const BlockUserInputSchema = z.object({ reasonCategory, internalNote }).strict();

/** Débloquer exige un motif, comme bloquer (§ 5.3). */
export const UnblockUserInputSchema = z.object({ internalNote }).strict();

/**
 * Attribution d'un rôle plateforme (§ 5.3) : motif obligatoire ; `platform_support` porte
 * une échéance obligatoire, 90 jours au plus (décision ouverte n° 18). L'échéance est
 * jugée contre `now`, passé par l'appelant (`grantPlatformRoleInputSchema(now)`), pour
 * que le schéma reste une fonction pure.
 */
export function grantPlatformRoleInputSchema(now: Date) {
  return z
    .object({
      role: z.enum(PLATFORM_ROLE_SLUGS, { error: 'Rôle plateforme inconnu.' }),
      reason: textAtLeast(
        L.roleReasonMinLength,
        L.roleReasonMaxLength,
        'REASON_REQUIRED',
        `Motif : ${L.roleReasonMinLength} caractères au moins.`,
      ),
      expiresAt: isoDateTime.optional(),
    })
    .strict()
    .superRefine((v, ctx) => {
      if (v.expiresAt !== undefined && Date.parse(v.expiresAt) <= now.getTime()) {
        ctx.addIssue({
          code: 'custom',
          path: ['expiresAt'],
          message: 'Échéance déjà passée.',
          params: { code: 'EXPIRY_IN_PAST' },
        });
      }
      if (v.role !== 'platform_support') return;
      if (v.expiresAt === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['expiresAt'],
          message: 'Le rôle Support exige une échéance.',
          params: { code: 'SUPPORT_EXPIRY_REQUIRED' },
        });
        return;
      }
      if (Date.parse(v.expiresAt) - now.getTime() > L.supportRoleMaxDays * DAY_MS) {
        ctx.addIssue({
          code: 'custom',
          path: ['expiresAt'],
          message: `Le rôle Support est attribué pour ${L.supportRoleMaxDays} jours au plus.`,
          params: { code: 'SUPPORT_EXPIRY_TOO_LONG' },
        });
      }
    });
}

// ── Abonnements et paiements manuels (§ 6.2) ───────────────────────────────────

/** Confirmer : note obligatoire (référence de l'opération reçue). */
export const ConfirmManualPaymentInputSchema = z.object({ note: internalNote }).strict();

/** Refuser : motif obligatoire, désormais journalisé. */
export const RejectManualPaymentInputSchema = z.object({ reason: internalNote }).strict();

/** Octroi manuel (`platform_plan_grants`) : remplace `PATCH /admin/organizations/:id/plan`. */
export const PlanGrantInputSchema = z
  .object({
    targetOrganizationId: PlatformTargetId,
    plan: z.enum(PLANS, { error: 'Offre inconnue.' }),
    reasonCategory,
    clientMessage,
    internalNote,
    startsAt: isoDateTime.optional(),
    endsAt: isoDateTime.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.endsAt === undefined) return;
    const start = v.startsAt === undefined ? null : Date.parse(v.startsAt);
    if (start !== null && Date.parse(v.endsAt) <= start) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'La fin doit suivre le début.',
        params: { code: 'GRANT_PERIOD_INVALID' },
      });
    }
  });

// ── ADR-0053 — P3 : corps de la console des abonnements (§ 6.2) ─────────────────

const optionalClientMessage = z.string().trim().max(L.clientMessageMaxLength).optional();

/**
 * Confirmation depuis la console : note interne obligatoire (référence de l'opération
 * reçue) ; message au client facultatif, repris par le miroir « Équipe Lalanda ».
 */
export const ConsoleConfirmManualPaymentInputSchema = ConfirmManualPaymentInputSchema.extend({
  clientMessage: optionalClientMessage,
}).strict();

/** Refus depuis la console : motif interne obligatoire, message au client facultatif. */
export const ConsoleRejectManualPaymentInputSchema = RejectManualPaymentInputSchema.extend({
  clientMessage: optionalClientMessage,
}).strict();

/** Retrait d'un octroi (ou annulation d'une demande en attente) : motif et message client. */
export const RevokePlanGrantInputSchema = z.object({ internalNote, clientMessage }).strict();

/** Approbation d'un octroi par une seconde personne : note interne facultative. */
export const ApprovePlanGrantInputSchema = z
  .object({ internalNote: z.string().trim().max(L.internalNoteMaxLength).optional() })
  .strict();

// ── Fonctionnalités par offre (§ 6.3) ──────────────────────────────────────────

/**
 * Dérogation par organisation : motif et échéance obligatoires, 90 jours au plus
 * (décision ouverte n° 10). La clé `feature` est validée par l'API contre le catalogue
 * `FEATURES` du lot P4 ; ici, seulement sa forme.
 */
export function featureOverrideInputSchema(now: Date) {
  return z
    .object({
      targetOrganizationId: PlatformTargetId,
      feature: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, { message: 'Fonctionnalité inconnue.' }),
      value: z.boolean(),
      reasonCategory,
      internalNote,
      endsAt: isoDateTime,
    })
    .strict()
    .superRefine((v, ctx) => {
      const delta = Date.parse(v.endsAt) - now.getTime();
      if (delta <= 0 || delta > L.featureOverrideMaxDays * DAY_MS) {
        ctx.addIssue({
          code: 'custom',
          path: ['endsAt'],
          message: `Échéance obligatoire, dans les ${L.featureOverrideMaxDays} jours.`,
          params: { code: 'OVERRIDE_EXPIRY_INVALID' },
        });
      }
    });
}

// ── Annonces (§ 6.6) ───────────────────────────────────────────────────────────

/** États d'abonnement filtrables (copie de `SUBSCRIPTION_STATUSES`, égalité testée par l'API). */
export const PLATFORM_AUDIENCE_SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'grace',
  'suspended',
  'canceled',
] as const;

/**
 * Catégorie de destinataires (§ 6.6), critères combinés en ET. Uniquement des
 * métadonnées de plateforme, jamais le contenu d'une organisation. Un filtre vide
 * vaut « tous les comptes actifs ». Les rôles d'organisation sont validés par l'API
 * (`isOrgRole`) ; ici, seulement leur forme.
 */
export const AudienceFilterSchema = z
  .object({
    ownersOnly: z.boolean().optional(),
    plans: z.array(z.enum(PLANS)).min(1).optional(),
    subscriptionStatuses: z
      .array(z.enum(PLATFORM_AUDIENCE_SUBSCRIPTION_STATUSES))
      .min(1)
      .optional(),
    countries: z
      .array(z.string().regex(/^[A-Z]{2}$/, { message: 'Code pays ISO à deux lettres.' }))
      .min(1)
      .optional(),
    orgRoles: z
      .array(z.string().regex(/^[a-z_]{2,40}$/))
      .min(1)
      .optional(),
    signedUpAfter: isoDateTime.optional(),
    signedUpBefore: isoDateTime.optional(),
  })
  .strict();

export type AudienceFilter = z.infer<typeof AudienceFilterSchema>;

export const AnnouncementDraftInputSchema = z
  .object({
    title: z.string().trim().min(1).max(L.announcementTitleMaxLength),
    /** Texte brut : aucun HTML n'est interprété (§ 6.6). */
    body: z.string().trim().min(1).max(L.announcementBodyMaxLength),
    audience: AudienceFilterSchema,
    expiresAt: isoDateTime.optional(),
  })
  .strict();

/** Envoi : le nombre de destinataires est RETAPÉ par l'opérateur (§ 6.6). */
export const AnnouncementSendInputSchema = z
  .object({ confirmedAudienceCount: z.number().int().min(0) })
  .strict();

// ── Vue d'accès (`GET /me/platform-access`, § 7) ───────────────────────────────

/**
 * Ce que `GET /me/platform-access` renvoie. Les champs historiques (S21b) restent servis
 * tels quels pendant une version ; `actions` est la vérité nouvelle, lue par la coquille
 * de console (lot P1) pour ses onglets. N'autorise rien : le serveur décide.
 */
export interface PlatformAccessContract {
  roles: Array<{ role: PlatformRoleSlug; label: string }>;
  isPlatformOperator: boolean;
  canReadAdmin: boolean;
  canManagePlatform: boolean;
  canManageIntegrations: boolean;
  forbiddenActions: string[];
  /** ADR-0053 — actions plateforme détenues, ordre du catalogue. */
  actions: PlatformAction[];
}

/** Ordre canonique d'une liste d'actions (celui du catalogue). */
export function sortPlatformActions(actions: Iterable<PlatformAction>): PlatformAction[] {
  const held = new Set(actions);
  return PLATFORM_ACTIONS.filter((a) => held.has(a));
}
