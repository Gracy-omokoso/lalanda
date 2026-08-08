import { z } from 'zod';

/**
 * Validation des entrées de l'espace compte (S20b).
 *
 * TOUS les schémas sont `.strict()`. Ce n'est pas une coquetterie : c'est la
 * garantie mécanique que `userId` (ou `organizationId`, ou `role`) ne peut pas
 * être injecté depuis le corps d'une requête. Le propriétaire des données lues et
 * écrites est TOUJOURS celui de la session — voir `account.controller.ts`, qui
 * n'utilise que `@CurrentUser()`. Une clé inconnue produit un 400, jamais un
 * silence.
 */

/**
 * Langues réellement servies par l'interface. docs/04 § Langues : le français est
 * la langue initiale. Ajouter une langue ici est le seul changement nécessaire
 * côté contrat — mais il doit suivre la traduction effective des libellés, pas la
 * précéder. Annoncer une langue non traduite serait un mensonge d'interface.
 */
export const SUPPORTED_LOCALES = ['fr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Même énumération que `projects.dto.ts` — cohérence des devises d'affichage. */
export const DISPLAY_CURRENCIES = ['USD', 'CDF', 'XOF', 'XAF', 'EUR'] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Fuseau IANA valide. On ne maintient pas une liste en dur (elle se périme) :
 * on demande à l'ICU embarqué dans Node de résoudre le fuseau. Un identifiant
 * inconnu fait lever `Intl.DateTimeFormat`, ce qui est exactement le test voulu.
 */
export function isValidTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const timezoneSchema = z
  .string()
  .trim()
  .refine(isValidTimeZone, { message: 'Fuseau horaire IANA inconnu' });

/**
 * Email : normalisation lowercase + trim AVANT toute comparaison.
 * Sans cela, `Alice@X.com` et `alice@x.com` seraient deux comptes distincts alors
 * que la plupart des fournisseurs les traitent comme une seule boîte.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: 'Adresse email invalide' })
  .max(254);

/** PUT /account/profile — nom affiché, langue et fuseau. */
export const PutProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    locale: z.enum(SUPPORTED_LOCALES),
    timezone: timezoneSchema,
  })
  .strict();
export type PutProfileInput = z.infer<typeof PutProfileSchema>;

/** PUT /account/preferences — thème, devise par défaut, notifications. */
export const PutPreferencesSchema = z
  .object({
    theme: z.enum(THEMES),
    displayCurrency: z.enum(DISPLAY_CURRENCIES),
    notifications: z
      .object({
        securite: z.boolean(),
        produit: z.boolean(),
        projet: z.boolean(),
        resumeHebdomadaire: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type PutPreferencesInput = z.infer<typeof PutPreferencesSchema>;

/**
 * POST /account/email/change — demande de changement d'adresse.
 * Le mot de passe courant est exigé : une session volée ne doit pas suffire à
 * déplacer un compte (docs/17 § Menaces prioritaires — « prise de compte »).
 */
export const RequestEmailChangeSchema = z
  .object({
    newEmail: emailSchema,
    currentPassword: z.string().min(1).max(256),
  })
  .strict();
export type RequestEmailChangeInput = z.infer<typeof RequestEmailChangeSchema>;

/** POST /account/email/verify — application du changement via le token reçu. */
export const VerifyEmailChangeSchema = z
  .object({
    token: z.string().trim().min(16).max(128),
  })
  .strict();
export type VerifyEmailChangeInput = z.infer<typeof VerifyEmailChangeSchema>;

/**
 * POST /account/delete — suppression définitive du compte.
 *
 * Double confirmation (docs/04 § Conventions : « les actions irréversibles exigent
 * confirmation et indiquent leur portée ») : saisie de l'adresse exacte du compte
 * ET mot de passe courant. La saisie de l'email empêche le clic réflexe ; le mot
 * de passe empêche l'exploitation d'une session laissée ouverte.
 */
export const DeleteAccountSchema = z
  .object({
    confirmEmail: emailSchema,
    currentPassword: z.string().min(1).max(256),
  })
  .strict();
export type DeleteAccountInput = z.infer<typeof DeleteAccountSchema>;
