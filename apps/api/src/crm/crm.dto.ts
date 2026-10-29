// Corps de requête et paramètres du CRM — ADR-0035 § 2 et § 4.
//
// Tous les corps sont `.strict()` (champ inconnu refusé). Le montant estimé
// d'une opportunité est TOUJOURS une chaîne décimale (`"1500.00"`) : un
// `number` JSON est refusé avec `DECIMAL_MUST_BE_STRING` (docs/26). Aucune
// opération arithmétique ici.

import { z } from 'zod';

import { parseDecimalInput } from '../sales/sales.dto.js';
import { isObjectIdHex } from '../sales/search.js';
import {
  ACTIVITY_KINDS,
  STAGE_KINDS,
  isCalendarDay,
  stageConfigIssues,
  type ActivityKind,
  type PipelineStage,
} from './crm-model.js';
import { fixedMessage, typeMessages } from '../validation/zod-compat.js';

type Ctx = z.RefinementCtx;

const PHONE_PATTERN = /^\+?[0-9][0-9 .-]{6,19}$/;

function issue(ctx: Ctx, path: (string | number)[], code: string, message: string): void {
  ctx.addIssue({ code: 'custom', path, message, params: { code } });
}

/** Texte facultatif : espaces de bord retirés, vide → `null`. */
export function text(
  ctx: Ctx,
  path: (string | number)[],
  raw: unknown,
  max: number,
): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') {
    issue(ctx, path, 'INVALID_TYPE', 'Texte attendu.');
    return null;
  }
  const t = raw.trim();
  if (t === '') return null;
  if (t.length > max) issue(ctx, path, 'TEXT_TOO_LONG', `${max} caractères au plus.`);
  return t;
}

function requiredText(
  ctx: Ctx,
  path: (string | number)[],
  raw: unknown,
  max: number,
  code: string,
  message: string,
): string {
  const t = text(ctx, path, raw, max);
  if (t === null) issue(ctx, path, code, message);
  return t ?? '';
}

function objectId(ctx: Ctx, path: (string | number)[], raw: unknown, code: string): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string' || !isObjectIdHex(raw)) {
    issue(ctx, path, code, 'Identifiant invalide.');
    return null;
  }
  return raw.toLowerCase();
}

export function email(ctx: Ctx, path: (string | number)[], raw: unknown): string | null {
  const e = text(ctx, path, raw, 254);
  if (e !== null && !z.email().safeParse(e).success) {
    issue(ctx, path, 'EMAIL_INVALID', 'Adresse e-mail invalide.');
  }
  return e === null ? null : e.toLowerCase();
}

export function phone(ctx: Ctx, path: (string | number)[], raw: unknown): string | null {
  const p = text(ctx, path, raw, 30);
  if (p !== null && !PHONE_PATTERN.test(p)) {
    issue(ctx, path, 'PHONE_INVALID', 'Numéro de téléphone invalide.');
  }
  return p;
}

/** Montant estimé : chaîne décimale > 0, 2 décimales au plus → canonique `"1500.00"`. */
export function estimatedAmount(ctx: Ctx, path: (string | number)[], raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const parsed = parseDecimalInput(raw, { maxIntegerDigits: 13, decimals: 2 });
  if (!parsed.ok) {
    if (parsed.reason === 'number') {
      issue(
        ctx,
        path,
        'DECIMAL_MUST_BE_STRING',
        'Montant attendu sous forme de chaîne (par exemple "1500.00"), jamais de nombre.',
      );
    } else if (parsed.reason === 'too_precise') {
      issue(ctx, path, 'AMOUNT_TOO_PRECISE', '2 décimales au plus.');
    } else {
      issue(ctx, path, 'AMOUNT_INVALID', 'Montant invalide : chiffres et point décimal seulement.');
    }
    return null;
  }
  if (parsed.isZero) {
    issue(ctx, path, 'AMOUNT_NOT_POSITIVE', 'Le montant estimé doit être strictement positif.');
    return null;
  }
  return parsed.canonical;
}

export function calendarDay(ctx: Ctx, path: (string | number)[], raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !isCalendarDay(raw)) {
    issue(ctx, path, 'DATE_INVALID', 'Date : AAAA-MM-JJ.');
    return null;
  }
  return raw;
}

const expectedRevision = z
  .number({
    error: typeMessages({
      required: 'Révision attendue obligatoire.',
      invalid: 'Révision attendue : un entier.',
    }),
  })
  .int()
  .min(1);

export const ExpectedRevisionSchema = z.object({ expectedRevision }).strict();

const limit = (max: number, fallback: string) =>
  z
    .string()
    .regex(/^\d{1,3}$/, `Limite : un entier de 1 à ${max}.`)
    .transform((v) => Number.parseInt(v, 10))
    .pipe(z.number().int().min(1).max(max))
    .prefault(fallback);

const idQuery = (message: string) => z.string().refine(isObjectIdHex, message).optional();

// ── Réglages ────────────────────────────────────────────────────────────────

export interface CrmSettingsInput {
  stages: PipelineStage[];
  autoWinOnQuoteAccepted: boolean;
  staleAfterDays: number;
}

export const PutCrmSettingsSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    stages: z
      .array(
        z
          .object({
            key: z.string(),
            label: z.string(),
            kind: z.enum(STAGE_KINDS, {
              error: fixedMessage('Nature : open, won ou lost.'),
            }),
          })
          .strict(),
      )
      .max(30),
    autoWinOnQuoteAccepted: z.boolean(),
    staleAfterDays: z.number().int().min(1).max(365),
  })
  .strict()
  .transform((raw, ctx) => {
    const stages = raw.stages.map((s) => ({
      key: s.key.trim(),
      label: s.label.trim(),
      kind: s.kind,
    }));
    for (const i of stageConfigIssues(stages)) {
      ctx.addIssue({
        code: 'custom',
        path: i.path.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)),
        message: i.message,
        params: { code: i.code },
      });
    }
    return {
      expectedRevision: raw.expectedRevision,
      settings: {
        stages,
        autoWinOnQuoteAccepted: raw.autoWinOnQuoteAccepted,
        staleAfterDays: raw.staleAfterDays,
      } satisfies CrmSettingsInput,
    };
  });

// ── Contacts ────────────────────────────────────────────────────────────────

export interface ContactInput {
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  /**
   * ADR-0040 — C1 (§ 2.2) : compte de la personne. `undefined` : non envoyé — le
   * service résout alors `customerId` / `companyName` (compatibilité N-1, une
   * version) ; `null` : personne sans entreprise.
   */
  accountId?: string | null;
  /** Déprécié en entrée (§ 2.2) : écrit par le service à partir du compte. */
  customerId: string | null;
  /** Déprécié en entrée (§ 2.2) : écrit par le service à partir du compte. */
  companyName: string | null;
  notes: string | null;
}

const ContactFields = {
  name: z.unknown().optional(),
  jobTitle: z.unknown().optional(),
  email: z.unknown().optional(),
  phone: z.unknown().optional(),
  // ADR-0040 — C1
  accountId: z.unknown().optional(),
  customerId: z.unknown().optional(),
  companyName: z.unknown().optional(),
  notes: z.unknown().optional(),
};

export function normalizeContact(raw: Record<string, unknown>, ctx: Ctx): ContactInput {
  const customerId = objectId(ctx, ['customerId'], raw['customerId'], 'CUSTOMER_INVALID');
  const companyName = text(ctx, ['companyName'], raw['companyName'], 200);
  // ADR-0040 — C1 : `accountId` absent ≠ `accountId: null` (voir `ContactInput`).
  const accountId =
    raw['accountId'] === undefined
      ? undefined
      : objectId(ctx, ['accountId'], raw['accountId'], 'ACCOUNT_INVALID');
  return {
    name: requiredText(ctx, ['name'], raw['name'], 200, 'NAME_REQUIRED', 'Le nom est obligatoire.'),
    jobTitle: text(ctx, ['jobTitle'], raw['jobTitle'], 100),
    email: email(ctx, ['email'], raw['email']),
    phone: phone(ctx, ['phone'], raw['phone']),
    ...(accountId === undefined ? {} : { accountId }),
    customerId,
    // Rattaché à un client : l'entreprise est celle du client.
    companyName: customerId === null ? companyName : null,
    notes: text(ctx, ['notes'], raw['notes'], 2000),
  };
}

export const CreateContactSchema = z
  .object(ContactFields)
  .strict()
  .transform((raw, ctx) => normalizeContact(raw, ctx));

export const PutContactSchema = z
  .object({ ...ContactFields, expectedRevision })
  .strict()
  .transform((raw, ctx) => {
    const { expectedRevision: rev, ...rest } = raw;
    return { expectedRevision: rev, contact: normalizeContact(rest, ctx) };
  });

export const ListContactsQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    customerId: idQuery('Identifiant de client invalide.'),
    // ADR-0040 — C1
    accountId: idQuery('Identifiant de compte invalide.'),
    kind: z.enum(['all', 'prospect', 'customer_contact']).default('all'),
    limit: limit(100, '50'),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type ListContactsQuery = z.output<typeof ListContactsQuerySchema>;

// ── Opportunités ────────────────────────────────────────────────────────────

export interface OpportunityInput {
  title: string;
  customerId: string | null;
  prospectName: string | null;
  contactId: string | null;
  amount: string | null;
  currency: 'CDF' | 'USD';
  expectedCloseDate: string | null;
}

const OpportunityFields = {
  title: z.unknown().optional(),
  customerId: z.unknown().optional(),
  prospectName: z.unknown().optional(),
  contactId: z.unknown().optional(),
  amount: z.unknown().optional(),
  currency: z.enum(['CDF', 'USD'], { error: fixedMessage('Devise : CDF ou USD.') }),
  expectedCloseDate: z.unknown().optional(),
};

export function normalizeOpportunity(raw: Record<string, unknown>, ctx: Ctx): OpportunityInput {
  const customerId = objectId(ctx, ['customerId'], raw['customerId'], 'CUSTOMER_INVALID');
  const prospectName = text(ctx, ['prospectName'], raw['prospectName'], 200);
  if (customerId === null && prospectName === null) {
    issue(
      ctx,
      ['customerId'],
      'CUSTOMER_OR_PROSPECT_REQUIRED',
      'Choisissez un client ou nommez le prospect.',
    );
  }
  return {
    title: requiredText(
      ctx,
      ['title'],
      raw['title'],
      200,
      'TITLE_REQUIRED',
      'Le titre est obligatoire.',
    ),
    customerId,
    prospectName: customerId === null ? prospectName : null,
    contactId: objectId(ctx, ['contactId'], raw['contactId'], 'CONTACT_INVALID'),
    amount: estimatedAmount(ctx, ['amount'], raw['amount']),
    currency: raw['currency'] as 'CDF' | 'USD',
    expectedCloseDate: calendarDay(ctx, ['expectedCloseDate'], raw['expectedCloseDate']),
  };
}

export const CreateOpportunitySchema = z
  .object({ ...OpportunityFields, stageKey: z.string().max(30).optional() })
  .strict()
  .transform((raw, ctx) => {
    const { stageKey, ...rest } = raw;
    return { stageKey: stageKey ?? null, opportunity: normalizeOpportunity(rest, ctx) };
  });

export const PutOpportunitySchema = z
  .object({ ...OpportunityFields, expectedRevision })
  .strict()
  .transform((raw, ctx) => {
    const { expectedRevision: rev, ...rest } = raw;
    return { expectedRevision: rev, opportunity: normalizeOpportunity(rest, ctx) };
  });

export const MoveOpportunitySchema = z
  .object({
    expectedRevision,
    stageKey: z.string().min(1).max(30),
    lostReason: z.unknown().optional(),
  })
  .strict()
  .transform((raw, ctx) => ({
    expectedRevision: raw.expectedRevision,
    stageKey: raw.stageKey,
    lostReason: text(ctx, ['lostReason'], raw.lostReason, 500),
  }));

export const ListOpportunitiesQuerySchema = z
  .object({
    status: z.enum(['open', 'won', 'lost', 'all']).default('all'),
    stageKey: z.string().min(1).max(30).optional(),
    customerId: idQuery('Identifiant de client invalide.'),
    contactId: idQuery('Identifiant de contact invalide.'),
    q: z.string().trim().min(1).max(100).optional(),
    limit: limit(100, '50'),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type ListOpportunitiesQuery = z.output<typeof ListOpportunitiesQuerySchema>;

// ── Activités ───────────────────────────────────────────────────────────────

export interface ActivityInput {
  kind: ActivityKind;
  subject: string;
  notes: string | null;
  dueAt: Date | null;
  opportunityId: string | null;
  contactId: string | null;
  customerId: string | null;
  /**
   * ADR-0040 — C4 § 2.4 : assigné. `undefined` (champ absent) : le créateur à la
   * création, l'assigné courant à la modification ; `null` : refusé pour une
   * activité à échéance non faite (`CRM_ASSIGNEE_REQUIRED`, contrôlé par le service).
   */
  assigneeUserId?: string | null;
}

const ActivityFields = {
  kind: z.enum(ACTIVITY_KINDS, {
    error: fixedMessage('Nature : call, meeting, note ou follow_up.'),
  }),
  subject: z.unknown().optional(),
  notes: z.unknown().optional(),
  dueAt: z.unknown().optional(),
  opportunityId: z.unknown().optional(),
  contactId: z.unknown().optional(),
  customerId: z.unknown().optional(),
  // ADR-0040 — C4
  assigneeUserId: z.unknown().optional(),
};

function dueAtOf(ctx: Ctx, raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') {
    issue(ctx, ['dueAt'], 'DUE_AT_INVALID', 'Échéance : date ISO 8601.');
    return null;
  }
  // Un jour seul s'entend en fin de journée à Kinshasa (UTC+1).
  const value = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? isCalendarDay(raw)
      ? `${raw}T23:59:59+01:00`
      : 'invalide'
    : raw;
  const d = new Date(value);
  if (raw.length > 40 || Number.isNaN(d.getTime())) {
    issue(ctx, ['dueAt'], 'DUE_AT_INVALID', 'Échéance : date ISO 8601.');
    return null;
  }
  return d;
}

export function normalizeActivity(
  raw: Record<string, unknown> & { kind: ActivityKind },
  ctx: Ctx,
): ActivityInput {
  const dueAt = dueAtOf(ctx, raw['dueAt']);
  if (raw.kind === 'note' && dueAt !== null) {
    issue(ctx, ['dueAt'], 'NOTE_HAS_NO_DUE_DATE', 'Une note n’a pas d’échéance.');
  }
  const absent = raw['dueAt'] === null || raw['dueAt'] === undefined || raw['dueAt'] === '';
  if (raw.kind === 'follow_up' && absent) {
    issue(ctx, ['dueAt'], 'FOLLOW_UP_DUE_REQUIRED', 'Une relance a une échéance.');
  }
  return {
    kind: raw.kind,
    subject: requiredText(
      ctx,
      ['subject'],
      raw['subject'],
      200,
      'SUBJECT_REQUIRED',
      'L’objet est obligatoire.',
    ),
    notes: text(ctx, ['notes'], raw['notes'], 2000),
    dueAt: raw.kind === 'note' ? null : dueAt,
    opportunityId: objectId(ctx, ['opportunityId'], raw['opportunityId'], 'OPPORTUNITY_INVALID'),
    contactId: objectId(ctx, ['contactId'], raw['contactId'], 'CONTACT_INVALID'),
    customerId: objectId(ctx, ['customerId'], raw['customerId'], 'CUSTOMER_INVALID'),
    // ADR-0040 — C4 : absent reste absent (défaut décidé par le service).
    ...(raw['assigneeUserId'] === undefined
      ? {}
      : {
          assigneeUserId: objectId(
            ctx,
            ['assigneeUserId'],
            raw['assigneeUserId'],
            'ASSIGNEE_INVALID',
          ),
        }),
  };
}

export const CreateActivitySchema = z
  .object(ActivityFields)
  .strict()
  .transform((raw, ctx) => normalizeActivity(raw, ctx));

export const PutActivitySchema = z
  .object({ ...ActivityFields, done: z.boolean(), expectedRevision })
  .strict()
  .transform((raw, ctx) => {
    const { expectedRevision: rev, done, ...rest } = raw;
    return { expectedRevision: rev, done, activity: normalizeActivity(rest, ctx) };
  });

export const ListActivitiesQuerySchema = z
  .object({
    status: z.enum(['open', 'overdue', 'done', 'all']).default('all'),
    opportunityId: idQuery('Identifiant d’opportunité invalide.'),
    contactId: idQuery('Identifiant de contact invalide.'),
    customerId: idQuery('Identifiant de client invalide.'),
    // ADR-0040 — C4 § 3.5 : assigné (`me` ou identifiant), compte, échéance (jours de Kinshasa).
    assignee: z
      .string()
      .refine((v) => v === 'me' || isObjectIdHex(v), 'Assigné : « me » ou un identifiant.')
      .optional(),
    accountId: idQuery('Identifiant de compte invalide.'),
    dueFrom: z.string().refine(isCalendarDay, 'Date : AAAA-MM-JJ.').optional(),
    dueTo: z.string().refine(isCalendarDay, 'Date : AAAA-MM-JJ.').optional(),
    limit: limit(200, '50'),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type ListActivitiesQuery = z.output<typeof ListActivitiesQuerySchema>;

// ── Import CSV ──────────────────────────────────────────────────────────────

/** Le corps JSON est borné par Express (100 Ko) ; 500 lignes au plus. */
export const MAX_IMPORT_ROWS = 500;

export const CsvImportSchema = z
  .object({
    csv: z.string().min(1, 'Fichier vide.').max(100_000, 'Fichier trop volumineux (100 Ko).'),
    dryRun: z.boolean().default(false),
  })
  .strict();
