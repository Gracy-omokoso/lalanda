// Corps de requête et paramètres des documents de vente — ADR-0023 § S25e.14.
//
// Tous les corps sont `.strict()`. Montants et quantités : TOUJOURS des chaînes
// décimales ; un `number` JSON est refusé avec `DECIMAL_MUST_BE_STRING` (docs/26).
// Aucune opération arithmétique ici : seulement de la validation de forme et de
// la mise en forme canonique de chaînes (`parseDecimalInput`).

import {
  DOCUMENT_CURRENCIES,
  ITEM_TYPES,
  OUT_OF_SCOPE_ITEM_CODE,
  PAYMENT_METHODS,
  isItemTypeAllowed,
  isTaxGroupLetter,
  type DecimalString,
  type DocumentCurrency,
  type ItemType,
  type LineDiscount,
  type PaymentInput,
  type PriceMode,
  type SpecificTax,
  type TaxGroupLetter,
} from '@lalanda/engine';
import { z } from 'zod';

import { isReservedItemCode, parseDecimalInput } from '../sales.dto.js';
import { isObjectIdHex } from '../search.js';
import {
  COMMENT_LINES,
  CREDIT_NOTE_NATURES,
  CREDIT_NOTE_SCOPES,
  CREDIT_NOTE_TYPES,
  INVOICE_LIST_STATUSES,
  INVOICE_TYPES,
  type CreditNoteNature,
  type InvoiceType,
} from './invoice.contract.js';

/** Au plus 200 lignes par document (§ S25e.2). */
export const MAX_LINES = 200;
const MAX_PAYMENTS = 20;
const CODE_PATTERN = /^[A-Za-z0-9._/-]+$/;

type Ctx = z.RefinementCtx;

function issue(ctx: Ctx, path: (string | number)[], code: string, message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message, params: { code } });
}

type DecimalKind = 'price' | 'quantity' | 'percent' | 'rate';

const DECIMALS: Record<DecimalKind, number> = { price: 2, quantity: 3, percent: 2, rate: 8 };

/**
 * Décimal strictement positif → chaîne canonique (`"464"` → `"464.00"` pour un
 * prix ; une quantité ou un taux perd ses zéros finaux : `"1.500"` → `"1.5"`).
 * `null` après avoir signalé le problème.
 */
function positiveDecimal(
  ctx: Ctx,
  path: (string | number)[],
  value: unknown,
  kind: DecimalKind,
  invalidCode: string,
): DecimalString | null {
  const parsed = parseDecimalInput(value, { maxIntegerDigits: 13, decimals: DECIMALS[kind] });
  if (!parsed.ok) {
    if (parsed.reason === 'number') {
      issue(
        ctx,
        path,
        'DECIMAL_MUST_BE_STRING',
        'Montant attendu sous forme de chaîne (par exemple "464.00"), jamais de nombre.',
      );
    } else if (value === undefined || value === null) {
      issue(ctx, path, 'FIELD_REQUIRED', 'Valeur obligatoire.');
    } else if (parsed.reason === 'too_precise') {
      issue(ctx, path, invalidCode, `${DECIMALS[kind]} décimales au plus.`);
    } else {
      issue(ctx, path, invalidCode, 'Valeur invalide : chiffres et point décimal seulement.');
    }
    return null;
  }
  if (parsed.isZero) {
    issue(ctx, path, invalidCode, 'La valeur doit être strictement positive.');
    return null;
  }
  return kind === 'price' ? parsed.canonical : parsed.canonical.replace(/\.?0+$/, '');
}

function unknownKeys(
  ctx: Ctx,
  path: (string | number)[],
  obj: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length === 0) return false;
  ctx.addIssue({
    code: z.ZodIssueCode.unrecognized_keys,
    keys: extra,
    path,
    message: `Champ(s) inconnu(s) : ${extra.join(', ')}.`,
  });
  return true;
}

function asObject(
  ctx: Ctx,
  path: (string | number)[],
  value: unknown,
): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    issue(ctx, path, 'INVALID_TYPE', 'Objet attendu.');
    return null;
  }
  return value as Record<string, unknown>;
}

// ── Lignes ───────────────────────────────────────────────────────────────────

export interface CatalogLineInput {
  source: 'catalog';
  catalogItemId: string;
  quantity: DecimalString;
  unitPrice: DecimalString | null;
  discount: LineDiscount | null;
}

export interface FreeLineInput {
  source: 'free';
  code: string | null;
  name: string;
  itemType: ItemType;
  taxGroup: TaxGroupLetter;
  outOfScope: boolean;
  unit: string | null;
  quantity: DecimalString;
  unitPrice: DecimalString;
  specificTax: SpecificTax | null;
  discount: LineDiscount | null;
}

export interface OriginLineInput {
  source: 'origin';
  originLineIndex: number;
  quantity: DecimalString;
}

export type LineInput = CatalogLineInput | FreeLineInput | OriginLineInput;

function parseDiscount(ctx: Ctx, path: (string | number)[], raw: unknown): LineDiscount | null {
  if (raw === null || raw === undefined) return null;
  const obj = asObject(ctx, path, raw);
  if (obj === null || unknownKeys(ctx, path, obj, ['kind', 'value'])) return null;
  const kind = obj['kind'];
  if (kind !== 'percent' && kind !== 'total_amount') {
    issue(ctx, [...path, 'kind'], 'DISCOUNT_INVALID', 'Remise : "percent" ou "total_amount".');
    return null;
  }
  const value = positiveDecimal(ctx, [...path, 'value'], obj['value'], 'price', 'DISCOUNT_INVALID');
  if (value === null) return null;
  if (kind === 'percent' && !/^\d{1,2}\./.test(value)) {
    issue(
      ctx,
      [...path, 'value'],
      'DISCOUNT_INVALID',
      'Une remise est strictement inférieure à 100 %.',
    );
    return null;
  }
  return { kind, value };
}

function parseSpecificTax(ctx: Ctx, path: (string | number)[], raw: unknown): SpecificTax | null {
  if (raw === null || raw === undefined) return null;
  const obj = asObject(ctx, path, raw);
  if (obj === null) return null;
  const kind = obj['kind'];
  const field = kind === 'per_unit' ? 'amount' : kind === 'percent' ? 'rate' : null;
  if (field === null) {
    issue(
      ctx,
      [...path, 'kind'],
      'SPECIFIC_TAX_INVALID',
      'Taxe spécifique : "per_unit" ou "percent".',
    );
    return null;
  }
  if (unknownKeys(ctx, path, obj, ['kind', field])) return null;
  const value = positiveDecimal(ctx, [...path, field], obj[field], 'price', 'SPECIFIC_TAX_INVALID');
  if (value === null) return null;
  if (kind === 'percent') {
    if (!/^\d{1,2}\./.test(value)) {
      issue(
        ctx,
        [...path, field],
        'SPECIFIC_TAX_INVALID',
        'Un taux est strictement inférieur à 100 %.',
      );
      return null;
    }
    return { kind: 'percent', rate: value };
  }
  return { kind: 'per_unit', amount: value };
}

function optionalText(
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

function parseLine(ctx: Ctx, index: number, raw: unknown): LineInput | null {
  const path: (string | number)[] = ['lines', index];
  const obj = asObject(ctx, path, raw);
  if (obj === null) return null;
  const source = obj['source'];

  if (source === 'origin') {
    if (unknownKeys(ctx, path, obj, ['source', 'originLineIndex', 'quantity'])) return null;
    const idx = obj['originLineIndex'];
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= MAX_LINES) {
      issue(
        ctx,
        [...path, 'originLineIndex'],
        'CREDIT_NOTE_LINE_NOT_IN_ORIGIN',
        'Ligne d’origine invalide.',
      );
      return null;
    }
    const quantity = positiveDecimal(
      ctx,
      [...path, 'quantity'],
      obj['quantity'],
      'quantity',
      'QUANTITY_INVALID',
    );
    return quantity === null ? null : { source, originLineIndex: idx, quantity };
  }

  if (source === 'catalog') {
    if (
      unknownKeys(ctx, path, obj, ['source', 'catalogItemId', 'quantity', 'unitPrice', 'discount'])
    ) {
      return null;
    }
    const id = obj['catalogItemId'];
    if (typeof id !== 'string' || !isObjectIdHex(id)) {
      issue(
        ctx,
        [...path, 'catalogItemId'],
        'CATALOG_ITEM_INVALID',
        'Identifiant d’article invalide.',
      );
      return null;
    }
    const quantity = positiveDecimal(
      ctx,
      [...path, 'quantity'],
      obj['quantity'],
      'quantity',
      'QUANTITY_INVALID',
    );
    const unitPrice =
      obj['unitPrice'] === null || obj['unitPrice'] === undefined
        ? null
        : positiveDecimal(ctx, [...path, 'unitPrice'], obj['unitPrice'], 'price', 'PRICE_INVALID');
    const discount = parseDiscount(ctx, [...path, 'discount'], obj['discount']);
    if (quantity === null) return null;
    return { source, catalogItemId: id.toLowerCase(), quantity, unitPrice, discount };
  }

  if (source === 'free') {
    const allowed = [
      'source',
      'code',
      'name',
      'itemType',
      'taxGroup',
      'outOfScope',
      'unit',
      'quantity',
      'unitPrice',
      'specificTax',
      'discount',
    ];
    if (unknownKeys(ctx, path, obj, allowed)) return null;
    const code = optionalText(ctx, [...path, 'code'], obj['code'], 50);
    if (code !== null) {
      if (isReservedItemCode(code)) {
        issue(
          ctx,
          [...path, 'code'],
          'CODE_RESERVED',
          `« ${OUT_OF_SCOPE_ITEM_CODE} » est réservé : cochez « opération hors champ ».`,
        );
      } else if (!CODE_PATTERN.test(code)) {
        issue(
          ctx,
          [...path, 'code'],
          'CODE_INVALID',
          'Code : lettres, chiffres, . _ / - seulement.',
        );
      }
    }
    const name = optionalText(ctx, [...path, 'name'], obj['name'], 200);
    if (name === null)
      issue(ctx, [...path, 'name'], 'NAME_REQUIRED', 'La désignation est obligatoire.');
    const taxGroup = isTaxGroupLetter(obj['taxGroup']) ? obj['taxGroup'] : null;
    if (taxGroup === null) {
      issue(
        ctx,
        [...path, 'taxGroup'],
        'UNKNOWN_TAX_GROUP',
        'Groupe de taxation inconnu : une lettre de A à P.',
      );
    }
    const types: readonly string[] = ITEM_TYPES;
    const itemType =
      typeof obj['itemType'] === 'string' && types.includes(obj['itemType'])
        ? (obj['itemType'] as ItemType)
        : null;
    if (itemType === null) {
      issue(ctx, [...path, 'itemType'], 'ITEM_TYPE_INVALID', 'Type d’article : BIE, SER ou TAX.');
    } else if (taxGroup !== null && !isItemTypeAllowed(taxGroup, itemType)) {
      issue(
        ctx,
        [...path, 'itemType'],
        'ITEM_TYPE_NOT_ALLOWED_FOR_GROUP',
        taxGroup === 'L' || taxGroup === 'N'
          ? `Le groupe ${taxGroup} n’admet que le type TAX.`
          : 'Le type TAX est réservé aux groupes L et N.',
      );
    }
    const outOfScope = obj['outOfScope'] === true;
    if (obj['outOfScope'] !== undefined && typeof obj['outOfScope'] !== 'boolean') {
      issue(ctx, [...path, 'outOfScope'], 'INVALID_TYPE', 'Valeur attendue : true ou false.');
    }
    if (outOfScope && taxGroup !== null && taxGroup !== 'A') {
      issue(
        ctx,
        [...path, 'outOfScope'],
        'OUT_OF_SCOPE_ONLY_GROUP_A',
        'Une opération hors champ relève du groupe A seulement.',
      );
    }
    const unit = optionalText(ctx, [...path, 'unit'], obj['unit'], 20);
    const quantity = positiveDecimal(
      ctx,
      [...path, 'quantity'],
      obj['quantity'],
      'quantity',
      'QUANTITY_INVALID',
    );
    const unitPrice = positiveDecimal(
      ctx,
      [...path, 'unitPrice'],
      obj['unitPrice'],
      'price',
      'PRICE_INVALID',
    );
    const specificTax = parseSpecificTax(ctx, [...path, 'specificTax'], obj['specificTax']);
    if (specificTax !== null && (taxGroup === 'L' || taxGroup === 'N')) {
      issue(
        ctx,
        [...path, 'specificTax'],
        'SPECIFIC_TAX_NOT_ALLOWED',
        `Pas de taxe spécifique en groupe ${taxGroup}.`,
      );
    }
    const discount = parseDiscount(ctx, [...path, 'discount'], obj['discount']);
    if (
      name === null ||
      taxGroup === null ||
      itemType === null ||
      quantity === null ||
      unitPrice === null
    ) {
      return null;
    }
    return {
      source,
      code,
      name,
      itemType,
      taxGroup,
      outOfScope,
      unit,
      quantity,
      unitPrice,
      specificTax,
      discount,
    };
  }

  issue(
    ctx,
    [...path, 'source'],
    'LINE_SOURCE_INVALID',
    'Origine de ligne : "catalog", "free" ou "origin".',
  );
  return null;
}

// ── Corps du brouillon ───────────────────────────────────────────────────────

export type CustomerInput =
  | { customerId: string; printContactDetails: boolean }
  | { customerId: null; walkInName: string | null };

export interface InvoiceDraftInput {
  type: InvoiceType;
  currency: DocumentCurrency;
  priceMode: PriceMode;
  customer: CustomerInput;
  pointOfSaleId: string | null;
  lines: LineInput[];
  payments: PaymentInput[];
  comments: { A: string | null; C: string | null };
  creditNote: { nature: CreditNoteNature; originInvoiceId: string | null } | null;
  showUsdCounterValue: boolean;
}

const DraftShape = {
  type: z.enum(INVOICE_TYPES, {
    errorMap: () => ({ message: 'Type : FV, FT, FA, EV, ET ou EA.' }),
  }),
  currency: z.enum(DOCUMENT_CURRENCIES, {
    errorMap: () => ({ message: 'Devise : CDF ou USD.' }),
  }),
  priceMode: z.enum(['ttc', 'ht'], {
    errorMap: () => ({ message: 'Mode de prix : "ttc" ou "ht".' }),
  }),
  customer: z.unknown(),
  pointOfSaleId: z.unknown().optional(),
  lines: z.unknown().optional(),
  payments: z.unknown().optional(),
  comments: z.unknown().optional(),
  creditNote: z.unknown().optional(),
  showUsdCounterValue: z.boolean().optional(),
};

type RawDraft = { [K in keyof typeof DraftShape]?: unknown } & {
  type: InvoiceType;
  currency: DocumentCurrency;
  priceMode: PriceMode;
};

function parseCustomer(ctx: Ctx, raw: unknown): CustomerInput | null {
  const obj = asObject(ctx, ['customer'], raw);
  if (obj === null) return null;
  if (obj['customerId'] === null) {
    if (unknownKeys(ctx, ['customer'], obj, ['customerId', 'walkIn'])) return null;
    const walkIn = asObject(ctx, ['customer', 'walkIn'], obj['walkIn'] ?? {});
    if (walkIn === null || unknownKeys(ctx, ['customer', 'walkIn'], walkIn, ['name', 'type'])) {
      return null;
    }
    if (walkIn['type'] !== undefined && walkIn['type'] !== 'PP') {
      issue(
        ctx,
        ['customer', 'walkIn', 'type'],
        'WALK_IN_MUST_BE_PP',
        'Une vente de comptoir sans fiche est faite à une personne physique (type PP).',
      );
      return null;
    }
    return {
      customerId: null,
      walkInName: optionalText(ctx, ['customer', 'walkIn', 'name'], walkIn['name'], 200),
    };
  }
  if (unknownKeys(ctx, ['customer'], obj, ['customerId', 'printContactDetails'])) return null;
  const id = obj['customerId'];
  if (typeof id !== 'string' || !isObjectIdHex(id)) {
    issue(ctx, ['customer', 'customerId'], 'CUSTOMER_INVALID', 'Identifiant de client invalide.');
    return null;
  }
  const print = obj['printContactDetails'];
  if (print !== undefined && typeof print !== 'boolean') {
    issue(
      ctx,
      ['customer', 'printContactDetails'],
      'INVALID_TYPE',
      'Valeur attendue : true ou false.',
    );
  }
  return { customerId: id.toLowerCase(), printContactDetails: print === true };
}

function parsePayments(ctx: Ctx, raw: unknown): PaymentInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    issue(ctx, ['payments'], 'INVALID_TYPE', 'Liste de paiements attendue.');
    return [];
  }
  if (raw.length > MAX_PAYMENTS) {
    issue(ctx, ['payments'], 'PAYMENT_LIMIT_EXCEEDED', `${MAX_PAYMENTS} paiements au plus.`);
    return [];
  }
  const methods: readonly string[] = PAYMENT_METHODS;
  const out: PaymentInput[] = [];
  raw.forEach((p, i) => {
    const obj = asObject(ctx, ['payments', i], p);
    if (obj === null || unknownKeys(ctx, ['payments', i], obj, ['method', 'amount'])) return;
    const method = obj['method'];
    if (typeof method !== 'string' || !methods.includes(method)) {
      issue(
        ctx,
        ['payments', i, 'method'],
        'PAYMENT_METHOD_INVALID',
        `Mode de paiement : ${PAYMENT_METHODS.join(', ')}.`,
      );
      return;
    }
    const amount = positiveDecimal(
      ctx,
      ['payments', i, 'amount'],
      obj['amount'],
      'price',
      'PAYMENT_AMOUNT_INVALID',
    );
    if (amount !== null) out.push({ method: method as PaymentInput['method'], amount });
  });
  return out;
}

function parseComments(ctx: Ctx, raw: unknown): { A: string | null; C: string | null } {
  if (raw === undefined || raw === null) return { A: null, C: null };
  const obj = asObject(ctx, ['comments'], raw);
  if (obj === null) return { A: null, C: null };
  const lines: readonly string[] = COMMENT_LINES;
  for (const key of Object.keys(obj)) {
    if (key === 'A' || key === 'C') continue;
    if (lines.includes(key)) {
      issue(
        ctx,
        ['comments', key],
        'COMMENT_LINE_RESERVED',
        `La ligne de commentaire ${key} est réservée : seules A et C sont saisissables.`,
      );
    } else {
      unknownKeys(ctx, ['comments'], { [key]: obj[key] }, []);
    }
  }
  return {
    A: optionalText(ctx, ['comments', 'A'], obj['A'], 255),
    C: optionalText(ctx, ['comments', 'C'], obj['C'], 255),
  };
}

function parseCreditNote(
  ctx: Ctx,
  type: InvoiceType,
  raw: unknown,
): InvoiceDraftInput['creditNote'] {
  const isCreditType = (CREDIT_NOTE_TYPES as readonly string[]).includes(type);
  if (raw === null || raw === undefined) {
    if (isCreditType) {
      issue(
        ctx,
        ['creditNote'],
        'CREDIT_NOTE_REQUIRED_FOR_TYPE',
        `Un document ${type} est un avoir : sa nature est obligatoire.`,
      );
    }
    return null;
  }
  if (!isCreditType) {
    issue(
      ctx,
      ['creditNote'],
      'CREDIT_NOTE_NOT_ALLOWED_FOR_TYPE',
      `Un document ${type} n’est pas un avoir.`,
    );
    return null;
  }
  const obj = asObject(ctx, ['creditNote'], raw);
  if (obj === null || unknownKeys(ctx, ['creditNote'], obj, ['nature', 'originInvoiceId']))
    return null;
  const nature = obj['nature'];
  if (typeof nature !== 'string' || !(CREDIT_NOTE_NATURES as readonly string[]).includes(nature)) {
    issue(
      ctx,
      ['creditNote', 'nature'],
      'CREDIT_NOTE_NATURE_INVALID',
      'Nature : COR, RAN, RAM ou RRR.',
    );
    return null;
  }
  const origin = obj['originInvoiceId'] ?? null;
  if (origin !== null && (typeof origin !== 'string' || !isObjectIdHex(origin))) {
    issue(
      ctx,
      ['creditNote', 'originInvoiceId'],
      'CREDIT_NOTE_ORIGIN_INVALID',
      'Identifiant de facture d’origine invalide.',
    );
    return null;
  }
  if (origin === null && nature !== 'RRR') {
    issue(
      ctx,
      ['creditNote', 'originInvoiceId'],
      'CREDIT_NOTE_ORIGIN_REQUIRED',
      'Hors remise, ristourne ou rabais (RRR), un avoir se rattache à une facture d’origine.',
    );
    return null;
  }
  return {
    nature: nature as CreditNoteNature,
    originInvoiceId: origin === null ? null : (origin as string).toLowerCase(),
  };
}

function normalizeDraft(raw: RawDraft, ctx: Ctx): InvoiceDraftInput {
  const customer = parseCustomer(ctx, raw.customer);

  let pointOfSaleId: string | null = null;
  if (raw.pointOfSaleId !== undefined && raw.pointOfSaleId !== null) {
    if (typeof raw.pointOfSaleId !== 'string' || !isObjectIdHex(raw.pointOfSaleId)) {
      issue(
        ctx,
        ['pointOfSaleId'],
        'POINT_OF_SALE_INVALID',
        'Identifiant de point de vente invalide.',
      );
    } else {
      pointOfSaleId = raw.pointOfSaleId.toLowerCase();
    }
  }

  const lines: LineInput[] = [];
  if (raw.lines !== undefined && raw.lines !== null) {
    if (!Array.isArray(raw.lines)) {
      issue(ctx, ['lines'], 'INVALID_TYPE', 'Liste de lignes attendue.');
    } else if (raw.lines.length > MAX_LINES) {
      issue(ctx, ['lines'], 'LINE_LIMIT_EXCEEDED', `${MAX_LINES} lignes au plus par document.`);
    } else {
      raw.lines.forEach((l, i) => {
        const parsed = parseLine(ctx, i, l);
        if (parsed !== null) lines.push(parsed);
      });
    }
  }

  return {
    type: raw.type,
    currency: raw.currency,
    priceMode: raw.priceMode,
    customer: customer ?? { customerId: null, walkInName: null },
    pointOfSaleId,
    lines,
    payments: parsePayments(ctx, raw.payments),
    comments: parseComments(ctx, raw.comments),
    creditNote: parseCreditNote(ctx, raw.type, raw.creditNote),
    showUsdCounterValue: raw.showUsdCounterValue === true,
  };
}

/** `POST /sales/invoices`. */
export const CreateInvoiceSchema = z
  .object(DraftShape)
  .strict()
  .transform((raw, ctx) => normalizeDraft(raw as RawDraft, ctx));

const expectedRevision = z
  .number({
    required_error: 'Révision attendue obligatoire.',
    invalid_type_error: 'Révision attendue : un entier.',
  })
  .int()
  .min(1);

/** `PUT /sales/invoices/:invoiceId` : corps COMPLET + révision attendue. */
export const PutInvoiceSchema = z
  .object({ ...DraftShape, expectedRevision })
  .strict()
  .transform((raw, ctx) => {
    const { expectedRevision: rev, ...rest } = raw;
    return { expectedRevision: rev, draft: normalizeDraft(rest as RawDraft, ctx) };
  });

export const CreateCreditNoteSchema = z
  .object({
    nature: z.enum(CREDIT_NOTE_NATURES, {
      errorMap: () => ({ message: 'Nature : COR, RAN, RAM ou RRR.' }),
    }),
    scope: z.enum(CREDIT_NOTE_SCOPES).default('remaining'),
  })
  .strict();

export const IssueInvoiceSchema = z.object({ expectedRevision }).strict();
export const BackToDraftSchema = z.object({ expectedRevision }).strict();

export const NormalizeInvoiceSchema = z
  .object({
    expectedRevision,
    exchangeRate: z.unknown().optional(),
  })
  .strict()
  .transform((raw, ctx) => {
    let exchangeRate: { rate: DecimalString; date: string } | null = null;
    if (raw.exchangeRate !== undefined && raw.exchangeRate !== null) {
      const obj = asObject(ctx, ['exchangeRate'], raw.exchangeRate);
      if (obj !== null && !unknownKeys(ctx, ['exchangeRate'], obj, ['rate', 'date'])) {
        const rate = positiveDecimal(
          ctx,
          ['exchangeRate', 'rate'],
          obj['rate'],
          'rate',
          'EXCHANGE_RATE_INVALID',
        );
        const date = obj['date'];
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(date) || date.length > 40) {
          issue(
            ctx,
            ['exchangeRate', 'date'],
            'EXCHANGE_RATE_DATE_INVALID',
            'Date du taux : AAAA-MM-JJ.',
          );
        } else if (rate !== null) {
          exchangeRate = { rate, date };
        }
      }
    }
    return { expectedRevision: raw.expectedRevision, exchangeRate };
  });

const limit = (max: number, fallback: string) =>
  z
    .string()
    .regex(/^\d{1,3}$/, `Limite : un entier de 1 à ${max}.`)
    .transform((v) => Number.parseInt(v, 10))
    .pipe(z.number().int().min(1).max(max))
    .default(fallback);

export const ListInvoicesQuerySchema = z
  .object({
    status: z.enum(INVOICE_LIST_STATUSES).default('all'),
    type: z.enum(INVOICE_TYPES).optional(),
    currency: z.enum(DOCUMENT_CURRENCIES).optional(),
    customerId: z.string().refine(isObjectIdHex, 'Identifiant de client invalide.').optional(),
    year: z
      .string()
      .regex(/^\d{4}$/, 'Année : AAAA.')
      .transform((v) => Number.parseInt(v, 10))
      .optional(),
    q: z.string().trim().min(1).max(100).optional(),
    limit: limit(100, '50'),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type ListInvoicesQuery = z.output<typeof ListInvoicesQuerySchema>;

export const ListJournalQuerySchema = z
  .object({
    limit: limit(200, '100'),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

/** Jour civil `AAAA-MM-JJ` réel (le 31 février est refusé). */
const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date : AAAA-MM-JJ.')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Date inexistante.');

/** `GET /sales/journal/export` — ADR-0026 § 6.3. */
export const JournalExportQuerySchema = z
  .object({
    from: calendarDay,
    to: calendarDay,
    format: z.enum(['json', 'csv']).default('json'),
    /** CSV seulement : `ventes` (lignes et groupes des factures) ou `echanges` (e-MCF). */
    dataset: z.enum(['ventes', 'echanges']).default('ventes'),
  })
  .strict()
  .refine((q) => q.from <= q.to, {
    path: ['to'],
    message: 'La fin de la période précède son début.',
    params: { code: 'INVALID_PERIOD' },
  });
