// Formulaire public de prospects (web-to-lead) — ADR-0048.
//
// Contrat commun à l'API (réglages authentifiés, routes publiques) et au web
// (page `/f/[token]`, panneau de réglages). La liste des champs est FERMÉE ;
// les règles qui exigent la base (responsable détenant `crm.manage`, jeton
// existant et actif) sont vérifiées par le service. Aucune règle financière.

import { z } from 'zod';

import { CRM_PHONE_PATTERN } from './constants.js';

/** Liste fermée des champs (ADR-0048 § 2.1), dans l'ordre d'affichage. */
export const LEAD_FORM_FIELD_KEYS = [
  'name',
  'company',
  'email',
  'phone',
  'message',
  'source',
] as const;
export type LeadFormFieldKey = (typeof LEAD_FORM_FIELD_KEYS)[number];

/** Libellés par défaut (affichés quand `label` est `null`). */
export const LEAD_FORM_DEFAULT_LABELS: Readonly<Record<LeadFormFieldKey, string>> = Object.freeze({
  name: 'Nom et prénom',
  company: 'Entreprise',
  email: 'Adresse e-mail',
  phone: 'Téléphone',
  message: 'Votre message',
  source: 'Comment nous avez-vous connus ?',
});

/** Tailles maximales des valeurs saisies par le visiteur (ADR-0048 § 6). */
export const LEAD_FORM_FIELD_MAX: Readonly<Record<LeadFormFieldKey, number>> = Object.freeze({
  name: 120,
  company: 200,
  email: 254,
  phone: 30,
  message: 2_000,
  source: 120,
});

/** Bornes des réglages. */
export const LEAD_FORM_LIMITS = Object.freeze({
  title: 120,
  intro: 500,
  label: 80,
  consentTextMin: 20,
  consentTextMax: 1_000,
  privacyPolicyUrl: 500,
  successMessage: 300,
});

/** Jeton du lien public : 24 octets aléatoires en base64url (ADR-0048 O3). */
export const LEAD_FORM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

/** Champ piège (ADR-0048 O4) : jamais affiché à un humain. */
export const LEAD_FORM_HONEYPOT_FIELD = 'website' as const;

/** Délai minimal de remplissage et durée de vie du ticket (ADR-0048 § 6). */
export const LEAD_FORM_MIN_FILL_MS = 3_000;
export const LEAD_FORM_TICKET_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/** Origine écrite sur le compte prospect créé (ADR-0040 « lot C-F »). */
export const LEAD_FORM_ACCOUNT_ORIGIN = 'formulaire';

export const LEAD_FORM_DEFAULT_TITLE = 'Contactez-nous';
export const LEAD_FORM_DEFAULT_CONSENT =
  "J'accepte que les informations saisies soient utilisées pour me recontacter au sujet de ma " +
  'demande. Elles ne sont ni vendues ni cédées à des tiers.';
export const LEAD_FORM_DEFAULT_SUCCESS =
  'Merci, votre demande a bien été reçue. Nous vous recontactons rapidement.';

export const LEAD_FORM_CURRENCIES = ['USD', 'CDF'] as const;
export type LeadFormCurrency = (typeof LEAD_FORM_CURRENCIES)[number];

/** Codes d'erreur stables (le web les traduit, les tests les citent). */
export const LEAD_FORM_ERROR_CODES = [
  'LEAD_FORM_NOT_FOUND',
  'LEAD_FORM_EXISTS',
  'LEAD_FORM_NAME_REQUIRED',
  'LEAD_FORM_CONTACT_REQUIRED',
  'LEAD_FORM_POLICY_REQUIRED',
  'LEAD_FORM_ASSIGNEE_REQUIRED',
  'LEAD_FORM_CONSENT_REQUIRED',
  'LEAD_FORM_TICKET_INVALID',
  'LEAD_FORM_TOO_FAST',
  'LEAD_FORM_RATE_LIMITED',
  'LEAD_FORM_FIELD_NOT_ENABLED',
] as const;
export type LeadFormErrorCode = (typeof LEAD_FORM_ERROR_CODES)[number];

// ── Réglages ────────────────────────────────────────────────────────────────

export interface LeadFormFieldConfig {
  key: LeadFormFieldKey;
  enabled: boolean;
  required: boolean;
  /** `null` : libellé par défaut. */
  label: string | null;
}

/** Champs par défaut : nom, e-mail obligatoires ; entreprise, téléphone, message facultatifs. */
export function defaultLeadFormFields(): LeadFormFieldConfig[] {
  return LEAD_FORM_FIELD_KEYS.map((key) => ({
    key,
    enabled: key !== 'source',
    required: key === 'name' || key === 'email',
    label: null,
  }));
}

function issue(ctx: z.RefinementCtx, path: (string | number)[], code: string, message: string) {
  ctx.addIssue({ code: 'custom', path, message, params: { code } });
}

const optionalText = (max: number) =>
  z
    .string({ error: 'Texte attendu.' })
    .trim()
    .max(max, { message: `${max} caractères au plus.` })
    .transform((v) => (v === '' ? null : v))
    .nullable();

const FieldConfigSchema = z
  .object({
    key: z.enum(LEAD_FORM_FIELD_KEYS),
    enabled: z.boolean(),
    required: z.boolean(),
    label: optionalText(LEAD_FORM_LIMITS.label),
  })
  .strict();

/** Règles des champs (ADR-0048 § 2.1), communes au web et à l'API. */
export function leadFormFieldIssues(
  fields: readonly LeadFormFieldConfig[],
): { path: (string | number)[]; code: string; message: string }[] {
  const out: { path: (string | number)[]; code: string; message: string }[] = [];
  const keys = fields.map((f) => f.key);
  if (keys.length !== LEAD_FORM_FIELD_KEYS.length || new Set(keys).size !== keys.length) {
    out.push({
      path: ['fields'],
      code: 'LEAD_FORM_FIELDS_INVALID',
      message: 'Les six champs de la liste sont attendus, une fois chacun.',
    });
    return out;
  }
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const name = byKey.get('name')!;
  if (!name.enabled || !name.required) {
    out.push({
      path: ['fields'],
      code: 'LEAD_FORM_NAME_REQUIRED',
      message: 'Le nom est toujours affiché et obligatoire.',
    });
  }
  const reachable = (['email', 'phone'] as const).some(
    (k) => byKey.get(k)!.enabled && byKey.get(k)!.required,
  );
  if (!reachable) {
    out.push({
      path: ['fields'],
      code: 'LEAD_FORM_CONTACT_REQUIRED',
      message: 'L’e-mail ou le téléphone doit être affiché et obligatoire, pour recontacter.',
    });
  }
  fields.forEach((f, i) => {
    if (f.required && !f.enabled) {
      out.push({
        path: ['fields', i, 'required'],
        code: 'LEAD_FORM_FIELD_NOT_ENABLED',
        message: 'Un champ masqué ne peut pas être obligatoire.',
      });
    }
  });
  return out;
}

const httpsUrl = z
  .string({ error: 'Adresse attendue.' })
  .trim()
  .max(LEAD_FORM_LIMITS.privacyPolicyUrl, {
    message: `${LEAD_FORM_LIMITS.privacyPolicyUrl} caractères au plus.`,
  })
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .superRefine((v, ctx) => {
    if (v === null) return;
    let ok = false;
    try {
      ok = new URL(v).protocol === 'https:';
    } catch {
      ok = false;
    }
    if (!ok) {
      ctx.addIssue({
        code: 'custom',
        message: 'Adresse https:// attendue.',
        params: { code: 'URL_INVALID' },
      });
    }
  });

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const memberId = z
  .string()
  .refine((v) => OBJECT_ID.test(v), {
    message: 'Identifiant de membre invalide.',
    params: { code: 'CRM_ID_INVALID' },
  })
  .transform((v) => v.toLowerCase())
  .nullable();

const settingsFields = {
  title: z
    .string({ error: 'Titre attendu.' })
    .trim()
    .min(1, { message: 'Titre obligatoire.' })
    .max(LEAD_FORM_LIMITS.title, { message: `${LEAD_FORM_LIMITS.title} caractères au plus.` }),
  intro: optionalText(LEAD_FORM_LIMITS.intro),
  fields: z.array(FieldConfigSchema).length(LEAD_FORM_FIELD_KEYS.length),
  consentText: z
    .string({ error: 'Texte attendu.' })
    .trim()
    .min(LEAD_FORM_LIMITS.consentTextMin, {
      message: `${LEAD_FORM_LIMITS.consentTextMin} caractères au moins.`,
    })
    .max(LEAD_FORM_LIMITS.consentTextMax, {
      message: `${LEAD_FORM_LIMITS.consentTextMax} caractères au plus.`,
    }),
  privacyPolicyUrl: httpsUrl,
  successMessage: z
    .string({ error: 'Texte attendu.' })
    .trim()
    .min(1, { message: 'Message obligatoire.' })
    .max(LEAD_FORM_LIMITS.successMessage, {
      message: `${LEAD_FORM_LIMITS.successMessage} caractères au plus.`,
    }),
  assigneeUserId: memberId,
  createOpportunity: z.boolean(),
  opportunityCurrency: z.enum(LEAD_FORM_CURRENCIES),
  showBranding: z.boolean(),
};

/**
 * `POST /crm/lead-form` — création depuis la fenêtre modale. Le formulaire
 * naît DÉSACTIVÉ ; les champs non envoyés prennent leur valeur par défaut.
 */
export const CreateLeadFormBody = z
  .object({
    title: settingsFields.title.default(LEAD_FORM_DEFAULT_TITLE),
    consentText: settingsFields.consentText.default(LEAD_FORM_DEFAULT_CONSENT),
    privacyPolicyUrl: httpsUrl.default(null),
    assigneeUserId: memberId.default(null),
  })
  .strict();
export type CreateLeadFormBody = z.infer<typeof CreateLeadFormBody>;

/** `PUT /crm/lead-form` — réglages complets ; activer exige le § 2.3. */
export const UpdateLeadFormBody = z
  .object({
    expectedRevision: z.number().int().min(1),
    enabled: z.boolean(),
    ...settingsFields,
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const i of leadFormFieldIssues(v.fields)) issue(ctx, i.path, i.code, i.message);
    if (v.enabled && v.privacyPolicyUrl === null) {
      issue(
        ctx,
        ['privacyPolicyUrl'],
        'LEAD_FORM_POLICY_REQUIRED',
        'Indiquez le lien de votre politique de confidentialité avant d’activer le formulaire.',
      );
    }
    if (v.enabled && v.assigneeUserId === null) {
      issue(
        ctx,
        ['assigneeUserId'],
        'LEAD_FORM_ASSIGNEE_REQUIRED',
        'Choisissez le responsable des demandes avant d’activer le formulaire.',
      );
    }
  });
export type UpdateLeadFormBody = z.infer<typeof UpdateLeadFormBody>;

export const RotateLeadFormTokenBody = z
  .object({ expectedRevision: z.number().int().min(1) })
  .strict();
export type RotateLeadFormTokenBody = z.infer<typeof RotateLeadFormTokenBody>;

/** Vue des réglages (`GET /crm/lead-form`). */
export interface CrmLeadFormView {
  id: string;
  enabled: boolean;
  token: string;
  /** Chemin de la page publique, relatif au site web : `/f/<jeton>`. */
  publicPath: string;
  tokenRotatedAt: string | null;
  title: string;
  intro: string | null;
  fields: LeadFormFieldConfig[];
  consentText: string;
  privacyPolicyUrl: string | null;
  successMessage: string;
  assigneeUserId: string | null;
  createOpportunity: boolean;
  opportunityCurrency: LeadFormCurrency;
  showBranding: boolean;
  stats: { submissions: number; lastSubmissionAt: string | null };
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrmLeadFormEnvelope {
  form: CrmLeadFormView | null;
}

export function leadFormPublicPath(token: string): string {
  return `/f/${token}`;
}

// ── Page publique ────────────────────────────────────────────────────────────

export interface PublicLeadFormField {
  key: LeadFormFieldKey;
  label: string;
  required: boolean;
  maxLength: number;
}

/** `GET /public/lead-forms/:token` — rien d'autre que ce qui s'affiche. */
export interface PublicLeadFormView {
  title: string;
  intro: string | null;
  fields: PublicLeadFormField[];
  consent: { text: string; policyUrl: string | null };
  successMessage: string;
  branding: { logoUrl: string | null; color: string | null } | null;
  /** Ticket signé de remplissage, à renvoyer tel quel avec la soumission. */
  ticket: string;
}

export interface PublicLeadSubmissionResult {
  status: 'received';
  message: string;
}

const visitorText = (key: LeadFormFieldKey) =>
  z
    .string({ error: 'Texte attendu.' })
    .trim()
    .max(LEAD_FORM_FIELD_MAX[key], { message: `${LEAD_FORM_FIELD_MAX[key]} caractères au plus.` })
    .optional();

/** `POST /public/lead-forms/:token/submissions` — forme ; les champs obligatoires dépendent du formulaire. */
export const PublicLeadSubmissionBody = z
  .object({
    ticket: z.string().min(1).max(200),
    consent: z.boolean(),
    name: visitorText('name'),
    company: visitorText('company'),
    email: visitorText('email'),
    phone: visitorText('phone'),
    message: visitorText('message'),
    source: visitorText('source'),
    [LEAD_FORM_HONEYPOT_FIELD]: z.string().max(500).optional(),
  })
  .strict();
export type PublicLeadSubmissionBody = z.infer<typeof PublicLeadSubmissionBody>;

/** Valeurs retenues d'une soumission, champs vides ramenés à `null`, e-mail en minuscules. */
export type LeadSubmissionValues = Record<LeadFormFieldKey, string | null>;

export interface LeadSubmissionIssue {
  path: string;
  code: string;
  message: string;
}

const EMAIL = z.email();

/**
 * Valide une soumission contre les champs AFFICHÉS du formulaire (web et API) :
 * obligatoires, formats e-mail et téléphone, champ masqué rempli refusé,
 * consentement. Le champ piège et le ticket sont traités par l'appelant.
 */
export function validateLeadSubmission(
  fields: readonly { key: LeadFormFieldKey; required: boolean }[],
  body: Partial<Record<LeadFormFieldKey, string | undefined>> & { consent?: boolean },
): { values: LeadSubmissionValues; issues: LeadSubmissionIssue[] } {
  const issues: LeadSubmissionIssue[] = [];
  const shown = new Map(fields.map((f) => [f.key, f]));
  const values = {} as LeadSubmissionValues;
  for (const key of LEAD_FORM_FIELD_KEYS) {
    const raw = (body[key] ?? '').trim();
    const field = shown.get(key);
    if (!field) {
      if (raw !== '') {
        issues.push({
          path: key,
          code: 'LEAD_FORM_FIELD_NOT_ENABLED',
          message: 'Ce champ ne fait pas partie du formulaire.',
        });
      }
      values[key] = null;
      continue;
    }
    if (raw.length > LEAD_FORM_FIELD_MAX[key]) {
      issues.push({
        path: key,
        code: 'TEXT_TOO_LONG',
        message: `${LEAD_FORM_FIELD_MAX[key]} caractères au plus.`,
      });
    }
    if (raw === '') {
      if (field.required) {
        issues.push({ path: key, code: 'FIELD_REQUIRED', message: 'Ce champ est obligatoire.' });
      }
      values[key] = null;
      continue;
    }
    if (key === 'email' && !EMAIL.safeParse(raw).success) {
      issues.push({ path: key, code: 'EMAIL_INVALID', message: 'Adresse e-mail invalide.' });
    }
    if (key === 'phone' && !CRM_PHONE_PATTERN.test(raw)) {
      issues.push({ path: key, code: 'PHONE_INVALID', message: 'Numéro de téléphone invalide.' });
    }
    values[key] = key === 'email' ? raw.toLowerCase() : raw;
  }
  if (body.consent !== true) {
    issues.push({
      path: 'consent',
      code: 'LEAD_FORM_CONSENT_REQUIRED',
      message: 'Votre accord est nécessaire pour envoyer la demande.',
    });
  }
  return { values, issues };
}
