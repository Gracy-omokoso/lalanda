// Corps de requête et vues du module fiscal — ADR-0021 §2, §3, §4.1, §10.
//
// Tous les schémas sont `.strict()` : un champ inconnu est refusé (400), il
// n'est jamais ignoré en silence.

import { z } from 'zod';

import { LEGAL_FORMS, type LegalForm } from './fiscal-profile.schema.js';
import { zod3Code } from '../validation/zod-compat.js';

/** Libellés affichés des formes juridiques — servis par l'API (`options.legalForms`). */
export const LEGAL_FORM_LABELS: Record<LegalForm, string> = {
  entreprise_individuelle: 'Entreprise individuelle',
  sarl: 'SARL',
  sarlu: 'SARLU',
  sa: 'SA',
  sas: 'SAS',
  sasu: 'SASU',
  snc: 'SNC',
  scs: 'SCS',
  gie: 'GIE',
  cooperative: 'Coopérative',
  asbl: 'ASBL',
  etablissement_public: 'Établissement public',
  autre: 'Autre',
};

/**
 * NIF normalisé : majuscules, espaces et tirets retirés.
 *
 * Le contrôle est VOLONTAIREMENT souple (ADR-0021 §2) : le format exact n'est
 * publié dans aucune source que nous puissions citer. La seule validation qui
 * fait foi est la concordance avec le NIF renvoyé par la DGI lors du test d'un
 * jeton.
 */
export function normalizeNif(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, '');
}

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === null || v === '' ? null : v));

export const PutFiscalProfileSchema = z
  .object({
    legalName: trimmed(200).min(1),
    tradeName: optionalText(200),
    legalForm: z.enum(LEGAL_FORMS).nullable(),
    legalFormOther: optionalText(100),
    nif: z
      .string()
      .transform(normalizeNif)
      .pipe(z.string().regex(/^[A-Z0-9]{5,20}$/, 'NIF : 5 à 20 lettres ou chiffres')),
    rccm: optionalText(64),
    nationalId: optionalText(64),
    vatRegistered: z.boolean(),
    headOffice: z
      .object({
        line1: trimmed(200).min(1),
        line2: optionalText(200),
        commune: optionalText(100),
        city: trimmed(100).min(1),
        province: optionalText(100),
        // Facultatif dans le corps : vaut par défaut le pays de l'organisation.
        country: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{2}$/, 'code pays ISO-2 attendu')
          .optional(),
      })
      .strict(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9 .-]{6,19}$/, 'numéro de téléphone invalide'),
    email: z.string().trim().max(254).email('adresse e-mail invalide'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.legalForm === 'autre' && !v.legalFormOther) {
      ctx.addIssue({
        code: 'custom',
        path: ['legalFormOther'],
        message: 'Précisez la forme juridique.',
      });
    }
    if (v.legalForm !== 'autre' && v.legalFormOther !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['legalFormOther'],
        message: 'Réservé à la forme juridique « Autre ».',
      });
    }
  });
export type PutFiscalProfileInput = z.infer<typeof PutFiscalProfileSchema>;

const EnvironmentSchema = z.enum(['test', 'production']);

/** Motif d'une désactivation : 20 à 500 caractères (ADR-0021 R3). */
const ReasonSchema = z.string().trim().min(20, 'motif : 20 caractères au moins').max(500);

export const ActivateSchema = z.object({ environment: EnvironmentSchema }).strict();
export const DeactivateSchema = z.object({ reason: ReasonSchema }).strict();
export const ChangeEnvironmentSchema = z
  .object({ environment: EnvironmentSchema, reason: ReasonSchema.optional() })
  .strict();

/**
 * Jeton e-MCF : 20 à 4 096 caractères, `^[A-Za-z0-9._-]+$`. Il n'est ni décodé
 * ni interprété (ADR-0021 §4.1).
 */
const TokenSchema = z
  .string()
  .min(20, 'jeton trop court')
  .max(4096, 'jeton trop long')
  .regex(/^[A-Za-z0-9._-]+$/, 'caractères non admis dans le jeton');

const NimSchema = z.string().trim().min(1).max(32);

export const CreatePointOfSaleSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    environment: EnvironmentSchema,
    expectedNim: NimSchema.nullable().optional(),
    token: TokenSchema,
  })
  .strict();

export const PatchPointOfSaleSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    expectedNim: NimSchema.nullable().optional(),
  })
  .strict();

export const ReplaceTokenSchema = z.object({ token: TokenSchema }).strict();

export const DisablePointOfSaleSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();

/**
 * Problèmes de validation renvoyés au client — chemin, code et message SEULEMENT.
 *
 * Jamais l'objet d'erreur Zod brut : certains problèmes recopient la valeur reçue
 * (`received`), ce qui remettrait un jeton dans la réponse. Le code garde son nom
 * zod 3 (`invalid_string`, `invalid_enum_value`…) : voir `zod3Code`.
 */
export function issuesOf(
  error: z.ZodError,
): Array<{ path: string; code: string; message: string }> {
  return error.issues.map((i) => ({
    path: i.path.join('.'),
    code: zod3Code(i),
    message: i.message,
  }));
}
