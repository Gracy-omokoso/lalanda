// Comptes 360° — corps de requête, requêtes de liste et vues (ADR-0040 § 2.1, § 3.1).
// ADR-0040 — C0 : contrats posés avant le lot C1, qui les implémente.
//
// Mêmes règles que `@lalanda/shared/work` : corps `.strict()`, codes métier dans
// `params.code`, identifiants Mongo ramenés en minuscules. Les règles qui exigent
// la base (compte d'une autre organisation → 404, responsable détenant
// `crm.manage`, compte fusionné) sont vérifiées par le service, pas ici. Le corps
// de fiche client d'une conversion `create` est validé par Ventes
// (`CreateCustomerSchema`) : il n'est ici qu'un objet.

import { z } from 'zod';

import {
  CRM_ACCOUNT_KINDS,
  CRM_ACCOUNT_LIMITS,
  CRM_OWNER_ME,
  CRM_PAGE_LIMIT_DEFAULT,
  CRM_PAGE_LIMIT_MAX,
  CRM_PHONE_PATTERN,
  type CrmAccountConversionMode,
  type CrmAccountKind,
  type CrmAccountWarningCode,
} from './constants.js';

type RawIssue = z.core.$ZodRawIssue;
type Ctx = z.RefinementCtx;

/**
 * Message français d'un schéma. Repose `received` comme `fr()` de
 * `@lalanda/shared/work` : un champ absent reste reconnu `FIELD_REQUIRED` par l'API.
 */
function fr(message: string): { error: (iss: RawIssue) => string } {
  const error = (iss: RawIssue): string => {
    if (iss.code === 'invalid_type' || iss.code === 'invalid_value') {
      const input = iss.input;
      (iss as { received?: string }).received =
        input === undefined
          ? 'undefined'
          : input === null
            ? 'null'
            : Array.isArray(input)
              ? 'array'
              : typeof input;
    }
    return message;
  };
  return { error };
}

function issue(ctx: Ctx, code: string, message: string): void {
  ctx.addIssue({ code: 'custom', message, params: { code } });
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Identifiant Mongo (24 hexadécimaux), ramené en minuscules. */
export const CrmId = z
  .string(fr('Identifiant attendu.'))
  .refine((v) => OBJECT_ID.test(v), {
    message: 'Identifiant invalide.',
    params: { code: 'CRM_ID_INVALID' },
  })
  .transform((v) => v.toLowerCase());

const expectedRevision = z
  .number(fr('Révision attendue : un entier.'))
  .int({ message: 'Révision attendue : un entier.' })
  .min(1);

/** Texte obligatoire : espaces de bord retirés, 1 à `max` caractères. */
function requiredText(max: number, what: string) {
  return z
    .string(fr(`${what} : texte attendu.`))
    .trim()
    .refine((v) => v.length > 0, {
      message: `${what} obligatoire.`,
      params: { code: 'FIELD_REQUIRED' },
    })
    .refine((v) => v.length <= max, {
      message: `${max} caractères au plus.`,
      params: { code: 'TEXT_TOO_LONG' },
    });
}

/** Texte facultatif : espaces de bord retirés, vide → `null`. */
function optionalText(max: number) {
  return z
    .string(fr('Texte attendu.'))
    .trim()
    .refine((v) => v.length <= max, {
      message: `${max} caractères au plus.`,
      params: { code: 'TEXT_TOO_LONG' },
    })
    .transform((v) => (v === '' ? null : v))
    .nullable();
}

const phone = optionalText(CRM_ACCOUNT_LIMITS.phone).superRefine((v, ctx) => {
  if (v !== null && !CRM_PHONE_PATTERN.test(v)) {
    issue(ctx, 'PHONE_INVALID', 'Numéro de téléphone invalide.');
  }
});

const email = optionalText(CRM_ACCOUNT_LIMITS.email).superRefine((v, ctx) => {
  if (v !== null && !z.email().safeParse(v).success) {
    issue(ctx, 'EMAIL_INVALID', 'Adresse e-mail invalide.');
  }
});

/** Champs COMMERCIAUX d'un compte — jamais l'identité fiscale (§ 2.1). */
const commercialFields = {
  ownerId: CrmId.nullable().optional(),
  industry: optionalText(CRM_ACCOUNT_LIMITS.industry).optional(),
  origin: optionalText(CRM_ACCOUNT_LIMITS.origin).optional(),
  website: optionalText(CRM_ACCOUNT_LIMITS.website).optional(),
  phone: phone.optional(),
  email: email.optional(),
  address: optionalText(CRM_ACCOUNT_LIMITS.address).optional(),
  notes: optionalText(CRM_ACCOUNT_LIMITS.notes).optional(),
};

/** `POST /crm/accounts` — crée un PROSPECT ; un compte client naît de la fiche client. */
export const CreateCrmAccountBody = z
  .object({ name: requiredText(CRM_ACCOUNT_LIMITS.name, 'Nom'), ...commercialFields })
  .strict();
export type CreateCrmAccountBody = z.infer<typeof CreateCrmAccountBody>;

/**
 * `PUT /crm/accounts/:accountId`. `name` est accepté par le schéma ; pour un compte
 * client, le service le refuse (`409 CRM_ACCOUNT_IDENTITY_FROM_CUSTOMER`).
 */
export const UpdateCrmAccountBody = z
  .object({
    expectedRevision,
    name: requiredText(CRM_ACCOUNT_LIMITS.name, 'Nom').optional(),
    ...commercialFields,
  })
  .strict();
export type UpdateCrmAccountBody = z.infer<typeof UpdateCrmAccountBody>;

/** `POST …/archive`, `…/restore`. */
export const CrmAccountRevisionBody = z.object({ expectedRevision }).strict();
export type CrmAccountRevisionBody = z.infer<typeof CrmAccountRevisionBody>;

/** `POST …/merge` — fusionne un prospect dans un autre compte. */
export const MergeCrmAccountBody = z.object({ targetAccountId: CrmId, expectedRevision }).strict();
export type MergeCrmAccountBody = z.infer<typeof MergeCrmAccountBody>;

/**
 * `POST …/convert` (§ 3.1.1) : `create` crée la fiche client par
 * `CustomersService.create` (règles de Ventes), `link` rattache une fiche existante.
 * Exige `crm.manage` + `sales.manage`.
 */
export const ConvertCrmAccountBody = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('create'),
      customer: z.record(z.string(), z.unknown(), fr('Fiche client attendue.')),
      expectedRevision,
    })
    .strict(),
  z.object({ mode: z.literal('link'), customerId: CrmId, expectedRevision }).strict(),
]);
export type ConvertCrmAccountBody = z.infer<typeof ConvertCrmAccountBody>;

const booleanParam = z.enum(['true', 'false']).transform((v) => v === 'true');

/** `GET /crm/accounts?kind=&ownerId=me|<id>&active=&q=&cursor=&limit=`. */
export const ListCrmAccountsQuery = z
  .object({
    kind: z.enum(CRM_ACCOUNT_KINDS).optional(),
    ownerId: z.union([z.literal(CRM_OWNER_ME), CrmId]).optional(),
    active: booleanParam.optional(),
    q: z.string().trim().min(1).max(CRM_ACCOUNT_LIMITS.search).optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(CRM_PAGE_LIMIT_MAX).default(CRM_PAGE_LIMIT_DEFAULT),
  })
  .strict();
export type ListCrmAccountsQuery = z.infer<typeof ListCrmAccountsQuery>;

// ── Vues (réponses de l'API) ────────────────────────────────────────────────

export interface CrmAccountConversionView {
  customerId: string;
  /** Instant ISO. */
  convertedAt: string;
  convertedBy: string;
  mode: CrmAccountConversionMode;
}

export interface CrmAccountView {
  id: string;
  kind: CrmAccountKind;
  /** `null` pour un prospect ; la fiche client fait foi de l'identité fiscale. */
  customerId: string | null;
  name: string;
  ownerId: string | null;
  industry: string | null;
  origin: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  conversion: CrmAccountConversionView | null;
  mergedInto: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** Ligne de la liste des comptes : la fiche et ses compteurs (§ 3.1). */
export interface CrmAccountListItem extends CrmAccountView {
  counts: { contacts: number; openOpportunities: number };
  /** Prochaine activité non faite, `null` s'il n'y en a pas. */
  nextActivity: { id: string; subject: string; dueAt: string | null } | null;
}

export interface CrmAccountPage {
  items: CrmAccountListItem[];
  nextCursor: string | null;
}

export interface CrmAccountWarning {
  code: CrmAccountWarningCode;
  accountId: string;
}

/** Réponse d'une création ou d'une mise à jour : le compte et ses avertissements. */
export interface CrmAccountWriteResult {
  account: CrmAccountView;
  warnings: CrmAccountWarning[];
}
