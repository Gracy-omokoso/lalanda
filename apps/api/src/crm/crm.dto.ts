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
  // ADR-0040 — C2
  AMOUNT_SOURCES,
  LOST_REASON_KEY_PATTERN,
  MAX_LOST_REASONS,
  MAX_OPPORTUNITY_LINES,
  lostReasonIssues,
  type AmountSource,
  type LostReason,
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
  /** ADR-0040 — C2 : `undefined` : inchangés (corps d'ADR-0035 toujours accepté). */
  lostReasons?: LostReason[];
  lostReasonRequired?: boolean;
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
    // ADR-0040 — C2 (§ 2.5)
    lostReasons: z
      .array(
        z
          .object({ key: z.string(), label: z.string(), active: z.boolean().default(true) })
          .strict(),
      )
      .max(MAX_LOST_REASONS)
      .optional(),
    lostReasonRequired: z.boolean().optional(),
  })
  .strict()
  .transform((raw, ctx) => {
    const lostReasons = raw.lostReasons?.map((r) => ({
      key: r.key.trim(),
      label: r.label.trim(),
      active: r.active,
    }));
    for (const i of lostReasonIssues(lostReasons ?? [])) {
      ctx.addIssue({
        code: 'custom',
        path: i.path.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)),
        message: i.message,
        params: { code: i.code },
      });
    }
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
        ...(lostReasons === undefined ? {} : { lostReasons }),
        ...(raw.lostReasonRequired === undefined
          ? {}
          : { lostReasonRequired: raw.lostReasonRequired }),
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

/** ADR-0040 — C2 (§ 2.3) : ligne d'opportunité en entrée. */
export interface OpportunityLineInput {
  catalogItemId: string | null;
  /** `null` : recopié de l'article (ligne de catalogue). */
  label: string | null;
  quantity: string;
  /** `undefined` : recopiée de l'article. */
  unit?: string | null;
  /** Prix unitaire HT ; `undefined` : recopié de l'article (si son prix est HT). */
  unitPrice?: string | null;
  discountPercent: string | null;
}

export interface OpportunityInput {
  title: string;
  customerId: string | null;
  prospectName: string | null;
  contactId: string | null;
  amount: string | null;
  currency: 'CDF' | 'USD';
  expectedCloseDate: string | null;
  // ADR-0040 — C2 : `undefined` = non envoyé (création : défaut ; modification : inchangé).
  accountId?: string | null;
  ownerId?: string;
  lines?: OpportunityLineInput[];
  amountSource?: AmountSource;
}

const OpportunityFields = {
  title: z.unknown().optional(),
  customerId: z.unknown().optional(),
  prospectName: z.unknown().optional(),
  contactId: z.unknown().optional(),
  amount: z.unknown().optional(),
  currency: z.enum(['CDF', 'USD'], { error: fixedMessage('Devise : CDF ou USD.') }),
  expectedCloseDate: z.unknown().optional(),
  // ADR-0040 — C2
  accountId: z.unknown().optional(),
  ownerId: z.unknown().optional(),
  lines: z.unknown().optional(),
  amountSource: z.unknown().optional(),
};

/** Décimal > 0 (quantité, 3 décimales) ou ≥ 0 (prix, 2 décimales), canonique. */
function decimalField(
  ctx: Ctx,
  path: (string | number)[],
  raw: unknown,
  decimals: 2 | 3,
  allowZero: boolean,
  code: string,
): string | null {
  const parsed = parseDecimalInput(raw, { maxIntegerDigits: 13, decimals });
  if (!parsed.ok) {
    issue(
      ctx,
      path,
      parsed.reason === 'number' ? 'DECIMAL_MUST_BE_STRING' : code,
      parsed.reason === 'number'
        ? 'Valeur attendue sous forme de chaîne (par exemple "2"), jamais de nombre.'
        : `Décimal invalide (${decimals} décimales au plus).`,
    );
    return null;
  }
  if (parsed.isZero && !allowZero) {
    issue(ctx, path, code, 'La valeur doit être strictement positive.');
    return null;
  }
  return decimals === 3 ? parsed.canonical.replace(/\.?0+$/, '') : parsed.canonical;
}

const LINE_KEYS = [
  'catalogItemId',
  'label',
  'quantity',
  'unit',
  'unitPrice',
  'discountPercent',
] as const;

function normalizeLines(ctx: Ctx, raw: unknown): OpportunityLineInput[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    issue(ctx, ['lines'], 'INVALID_TYPE', 'Liste de lignes attendue.');
    return [];
  }
  if (raw.length > MAX_OPPORTUNITY_LINES) {
    issue(ctx, ['lines'], 'TOO_MANY_LINES', `${MAX_OPPORTUNITY_LINES} lignes au plus.`);
    return [];
  }
  return raw.map((l: unknown, i): OpportunityLineInput => {
    const at = (f: string) => ['lines', i, f];
    if (l === null || typeof l !== 'object' || Array.isArray(l)) {
      issue(ctx, ['lines', i], 'INVALID_TYPE', 'Objet attendu.');
      return { catalogItemId: null, label: null, quantity: '1', discountPercent: null };
    }
    const o = l as Record<string, unknown>;
    const extra = Object.keys(o).filter((k) => !(LINE_KEYS as readonly string[]).includes(k));
    if (extra.length > 0) {
      ctx.addIssue({
        code: 'unrecognized_keys',
        keys: extra,
        path: ['lines', i],
        message: `Champ(s) inconnu(s) : ${extra.join(', ')}.`,
      });
    }
    const catalogItemId = objectId(
      ctx,
      at('catalogItemId'),
      o['catalogItemId'],
      'CATALOG_ITEM_INVALID',
    );
    const label = text(ctx, at('label'), o['label'], 200);
    if (label === null && catalogItemId === null) {
      issue(ctx, at('label'), 'LABEL_REQUIRED', 'Le libellé est obligatoire (ligne libre).');
    }
    let discountPercent: string | null = null;
    if (o['discountPercent'] !== undefined && o['discountPercent'] !== null) {
      discountPercent = decimalField(
        ctx,
        at('discountPercent'),
        o['discountPercent'],
        2,
        true,
        'DISCOUNT_INVALID',
      );
      // Une remise de 100 % annulerait le prix : même règle que les devis.
      if (discountPercent !== null && !/^\d{1,2}\./.test(discountPercent)) {
        issue(ctx, at('discountPercent'), 'DISCOUNT_INVALID', 'Remise : 0 à moins de 100 %.');
        discountPercent = null;
      }
    }
    const line: OpportunityLineInput = {
      catalogItemId,
      label,
      quantity:
        decimalField(ctx, at('quantity'), o['quantity'], 3, false, 'QUANTITY_INVALID') ?? '1',
      discountPercent,
    };
    if (o['unit'] !== undefined) line.unit = text(ctx, at('unit'), o['unit'], 20);
    if (o['unitPrice'] !== undefined) {
      line.unitPrice =
        o['unitPrice'] === null
          ? null
          : decimalField(ctx, at('unitPrice'), o['unitPrice'], 2, true, 'PRICE_INVALID');
    }
    return line;
  });
}

export function normalizeOpportunity(raw: Record<string, unknown>, ctx: Ctx): OpportunityInput {
  const customerId = objectId(ctx, ['customerId'], raw['customerId'], 'CUSTOMER_INVALID');
  const prospectName = text(ctx, ['prospectName'], raw['prospectName'], 200);
  // ADR-0040 — C2 : le compte remplace client et prospect ; les deux restent
  // acceptés une version (compatibilité N-1, résolus par le service).
  const accountId =
    raw['accountId'] === undefined || raw['accountId'] === null
      ? undefined
      : (objectId(ctx, ['accountId'], raw['accountId'], 'ACCOUNT_INVALID') ?? undefined);
  if (customerId === null && prospectName === null && raw['accountId'] == null) {
    issue(
      ctx,
      ['customerId'],
      'CUSTOMER_OR_PROSPECT_REQUIRED',
      'Choisissez un compte, un client ou nommez le prospect.',
    );
  }
  let ownerId: string | undefined;
  if (raw['ownerId'] !== undefined) {
    ownerId = objectId(ctx, ['ownerId'], raw['ownerId'], 'OWNER_INVALID') ?? undefined;
    if (raw['ownerId'] === null) {
      issue(ctx, ['ownerId'], 'OWNER_REQUIRED', 'Une opportunité a toujours un responsable.');
    }
  }
  let amountSource: AmountSource | undefined;
  if (raw['amountSource'] !== undefined) {
    if ((AMOUNT_SOURCES as readonly unknown[]).includes(raw['amountSource'])) {
      amountSource = raw['amountSource'] as AmountSource;
    } else {
      issue(
        ctx,
        ['amountSource'],
        'AMOUNT_SOURCE_INVALID',
        'Origine du montant : manual ou lines.',
      );
    }
  }
  const lines = normalizeLines(ctx, raw['lines']);
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
    // Montant tiré des lignes : calculé par le service, la saisie est ignorée.
    amount: amountSource === 'lines' ? null : estimatedAmount(ctx, ['amount'], raw['amount']),
    currency: raw['currency'] as 'CDF' | 'USD',
    expectedCloseDate: calendarDay(ctx, ['expectedCloseDate'], raw['expectedCloseDate']),
    ...(accountId === undefined ? {} : { accountId }),
    ...(ownerId === undefined ? {} : { ownerId }),
    ...(lines === undefined ? {} : { lines }),
    ...(amountSource === undefined ? {} : { amountSource }),
  };
}

/** ADR-0040 — C2 : motif de perte (clé des réglages) et détail libre. */
function lostReasonOf(
  ctx: Ctx,
  raw: { lostReasonKey?: unknown; lostReasonDetail?: unknown; lostReason?: unknown },
): { lostReasonKey: string | null; lostReasonDetail: string | null } {
  let lostReasonKey: string | null = null;
  if (raw.lostReasonKey !== undefined && raw.lostReasonKey !== null) {
    if (typeof raw.lostReasonKey !== 'string' || !LOST_REASON_KEY_PATTERN.test(raw.lostReasonKey)) {
      issue(ctx, ['lostReasonKey'], 'LOST_REASON_KEY_INVALID', 'Motif de perte invalide.');
    } else lostReasonKey = raw.lostReasonKey;
  }
  // `lostReason` (ADR-0035) reste accepté : c'est le détail.
  const detailRaw = raw.lostReasonDetail !== undefined ? raw.lostReasonDetail : raw.lostReason;
  const path = raw.lostReasonDetail !== undefined ? 'lostReasonDetail' : 'lostReason';
  return { lostReasonKey, lostReasonDetail: text(ctx, [path], detailRaw, 500) };
}

export const CreateOpportunitySchema = z
  .object({
    ...OpportunityFields,
    stageKey: z.string().max(30).optional(),
    // ADR-0040 — C2 : création directe dans une étape « perdue ».
    lostReasonKey: z.unknown().optional(),
    lostReasonDetail: z.unknown().optional(),
  })
  .strict()
  .transform((raw, ctx) => {
    const { stageKey, lostReasonKey, lostReasonDetail, ...rest } = raw;
    return {
      stageKey: stageKey ?? null,
      opportunity: normalizeOpportunity(rest, ctx),
      lost: lostReasonOf(ctx, { lostReasonKey, lostReasonDetail }),
    };
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
    // ADR-0040 — C2
    lostReasonKey: z.unknown().optional(),
    lostReasonDetail: z.unknown().optional(),
  })
  .strict()
  .transform((raw, ctx) => ({
    expectedRevision: raw.expectedRevision,
    stageKey: raw.stageKey,
    ...lostReasonOf(ctx, raw),
  }));

/** `ownerId=me|<id>` (ADR-0040 § 3.2). */
const ownerQuery = z
  .string()
  .refine((v) => v === 'me' || isObjectIdHex(v), 'Responsable : « me » ou un identifiant.')
  .transform((v) => (v === 'me' ? v : v.toLowerCase()))
  .optional();

export const ListOpportunitiesQuerySchema = z
  .object({
    status: z.enum(['open', 'won', 'lost', 'all']).default('all'),
    stageKey: z.string().min(1).max(30).optional(),
    customerId: idQuery('Identifiant de client invalide.'),
    contactId: idQuery('Identifiant de contact invalide.'),
    q: z.string().trim().min(1).max(100).optional(),
    limit: limit(100, '50'),
    cursor: z.string().min(1).max(512).optional(),
    // ADR-0040 — C2
    ownerId: ownerQuery,
    accountId: idQuery('Identifiant de compte invalide.'),
  })
  .strict();
export type ListOpportunitiesQuery = z.output<typeof ListOpportunitiesQuerySchema>;

/** `GET /crm/pipeline?ownerId=me|<id>` (ADR-0040 § 3.4). */
export const PipelineQuerySchema = z.object({ ownerId: ownerQuery }).strict();

/** `POST /crm/opportunities/reassign` (ADR-0040 § 3.2). */
export const ReassignOpportunitiesSchema = z
  .object({
    fromOwnerId: z.string().refine(isObjectIdHex, 'Identifiant de responsable invalide.'),
    toOwnerId: z.string().refine(isObjectIdHex, 'Identifiant de responsable invalide.'),
    onlyOpen: z.boolean().default(true),
  })
  .strict()
  .transform((raw) => ({
    fromOwnerId: raw.fromOwnerId.toLowerCase(),
    toOwnerId: raw.toOwnerId.toLowerCase(),
    onlyOpen: raw.onlyOpen,
  }));

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
