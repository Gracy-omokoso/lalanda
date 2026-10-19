// Corps de requête et paramètres de liste du module ventes — ADR-0022 § S25c.2,
// § S25c.3, § S25c.5.
//
// Tous les corps sont `.strict()` : un champ inconnu est refusé (400), jamais
// ignoré en silence. Les règles métier posent leur propre code de problème
// (`params.code`), lu par `issuesOf()` : l'interface affiche l'erreur champ par
// champ sans analyser un message.
//
// Montants : TOUJOURS des chaînes décimales (docs/26 : pas de nombre flottant
// pour un montant officiel). Un `number` JSON est refusé avec
// `DECIMAL_MUST_BE_STRING` ; aucune conversion par `Number()` n'a lieu ici.

import {
  ITEM_TYPES,
  OUT_OF_SCOPE_ITEM_CODE,
  isItemTypeAllowed,
  isTaxGroupLetter,
  type ItemType,
  type PriceMode,
  type SpecificTax,
  type TaxGroupLetter,
} from '@lalanda/engine';
import { z } from 'zod';

import { normalizeNif } from '../fiscal/fiscal.dto.js';

// ── Clients ──────────────────────────────────────────────────────────────────

export const CUSTOMER_TYPES = ['PP', 'PM', 'PC', 'PL', 'AO'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

/** Libellés des cinq types DGI (`ClientTypeEnum` de la spécification e-DEF v2.0). */
export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  PP: 'Personne physique',
  PM: 'Personne morale',
  PC: 'Personne physique commerçante',
  PL: 'Profession libérale',
  AO: 'Ambassade, organisation internationale',
};

/** Types pour lesquels la DGI exige le NIF (ADR-0022 § Règles DGI). */
const NIF_REQUIRED: ReadonlySet<CustomerType> = new Set(['PM', 'PC', 'PL']);

const NIF_PATTERN = /^[A-Z0-9]{5,20}$/;
const PHONE_PATTERN = /^\+?[0-9][0-9 .-]{6,19}$/;

type Ctx = z.RefinementCtx;

function issue(ctx: Ctx, path: string, code: string, message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message, params: { code } });
}

/** Chaîne facultative : absente, `null` ou vide après `trim` → `null`. */
function optionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const t = value.trim();
  return t === '' ? null : t;
}

const nullableString = z.string().nullable().optional();

const CustomerFields = {
  type: z.enum(CUSTOMER_TYPES, {
    errorMap: () => ({ message: 'Type de client : PP, PM, PC, PL ou AO.' }),
  }),
  name: nullableString,
  nif: nullableString,
  exemptionReference: nullableString,
  phone: nullableString,
  email: nullableString,
  address: nullableString,
};

export interface CustomerInput {
  type: CustomerType;
  name: string;
  nif: string | null;
  exemptionReference: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

const CustomerShape = z.object(CustomerFields).strict();
type RawCustomer = z.output<typeof CustomerShape>;

function normalizeCustomer(raw: RawCustomer, ctx: Ctx): CustomerInput {
  const name = optionalText(raw.name);
  if (name === null) {
    issue(
      ctx,
      'name',
      'NAME_REQUIRED',
      raw.type === 'PM' ? 'La dénomination est obligatoire.' : 'Le nom est obligatoire.',
    );
  } else if (name.length > 200) {
    issue(ctx, 'name', 'NAME_TOO_LONG', '200 caractères au plus.');
  }

  let nif: string | null = null;
  const rawNif = optionalText(raw.nif);
  if (rawNif !== null) {
    nif = normalizeNif(rawNif);
    if (!NIF_PATTERN.test(nif)) {
      issue(ctx, 'nif', 'NIF_INVALID', 'NIF : 5 à 20 lettres ou chiffres.');
    }
  } else if (NIF_REQUIRED.has(raw.type)) {
    issue(
      ctx,
      'nif',
      'NIF_REQUIRED_FOR_TYPE',
      `Le NIF est obligatoire pour le type « ${CUSTOMER_TYPE_LABELS[raw.type]} ».`,
    );
  }

  const exemptionReference = optionalText(raw.exemptionReference);
  if (raw.type === 'AO') {
    if (exemptionReference === null) {
      issue(
        ctx,
        'exemptionReference',
        'EXEMPTION_REFERENCE_REQUIRED',
        'La référence du document d’exonération est obligatoire pour une ambassade ou une organisation internationale.',
      );
    } else if (exemptionReference.length > 200) {
      issue(ctx, 'exemptionReference', 'EXEMPTION_REFERENCE_TOO_LONG', '200 caractères au plus.');
    }
  } else if (exemptionReference !== null) {
    issue(
      ctx,
      'exemptionReference',
      'EXEMPTION_REFERENCE_NOT_ALLOWED',
      'Une référence d’exonération n’est admise que pour une ambassade ou une organisation internationale.',
    );
  }

  const phone = optionalText(raw.phone);
  if (phone !== null && !PHONE_PATTERN.test(phone)) {
    issue(ctx, 'phone', 'PHONE_INVALID', 'Numéro de téléphone invalide.');
  }

  const email = optionalText(raw.email);
  if (email !== null && (email.length > 254 || !z.string().email().safeParse(email).success)) {
    issue(ctx, 'email', 'EMAIL_INVALID', 'Adresse e-mail invalide.');
  }

  const address = optionalText(raw.address);
  if (address !== null && address.length > 255) {
    issue(ctx, 'address', 'ADDRESS_TOO_LONG', '255 caractères au plus.');
  }

  return {
    type: raw.type,
    name: name ?? '',
    nif,
    exemptionReference: raw.type === 'AO' ? exemptionReference : null,
    phone,
    email,
    address,
  };
}

/** `POST /sales/customers`. Un champ facultatif absent vaut `null`. */
export const CreateCustomerSchema = CustomerShape.transform((raw, ctx) =>
  normalizeCustomer(raw, ctx),
);

const expectedRevision = z
  .number({ invalid_type_error: 'Révision attendue : un entier.' })
  .int()
  .min(1);

/**
 * `PUT /sales/customers/:customerId` : la fiche ENTIÈRE est remplacée. Un champ
 * facultatif absent vaut `null` (effacé), comme s'il était envoyé à `null`.
 */
export const PutCustomerSchema = z
  .object({ ...CustomerFields, expectedRevision })
  .strict()
  .transform((raw, ctx) => {
    const { expectedRevision: rev, ...rest } = raw;
    return { expectedRevision: rev, customer: normalizeCustomer(rest, ctx) };
  });

// ── Montants ─────────────────────────────────────────────────────────────────

/** Résultat de l'analyse d'un décimal reçu en entrée. */
type DecimalParse =
  | { ok: true; canonical: string; integerPart: string; isZero: boolean }
  | { ok: false; reason: 'not_string' | 'number' | 'format' | 'too_precise' | 'too_large' };

/**
 * Chaîne décimale positive → forme canonique à exactement `decimals` décimales
 * (`"464"` → `"464.00"`, `"0464.5"` → `"464.50"`). Manipulation de chaînes
 * seulement : aucune conversion en `number`.
 */
export function parseDecimalInput(
  value: unknown,
  opts: { maxIntegerDigits: number; decimals: number },
): DecimalParse {
  if (typeof value === 'number') return { ok: false, reason: 'number' };
  if (typeof value !== 'string') return { ok: false, reason: 'not_string' };
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) return { ok: false, reason: 'format' };
  const fraction = m[2] ?? '';
  if (fraction.length > opts.decimals) return { ok: false, reason: 'too_precise' };
  const integerPart = m[1]!.replace(/^0+(?=\d)/, '');
  if (integerPart.length > opts.maxIntegerDigits) return { ok: false, reason: 'too_large' };
  const paddedFraction = fraction.padEnd(opts.decimals, '0');
  const canonical = opts.decimals > 0 ? `${integerPart}.${paddedFraction}` : integerPart;
  const isZero = /^0+$/.test(integerPart) && /^0*$/.test(paddedFraction);
  return { ok: true, canonical, integerPart, isZero };
}

// ── Catalogue ────────────────────────────────────────────────────────────────

const CODE_PATTERN = /^[A-Za-z0-9._/-]+$/;

/**
 * Vrai pour toute écriture de « HORS CHAMP », quelle que soit la casse ou le
 * séparateur (« hors champ », « HORS-CHAMP », « hors_champ ») : la valeur
 * exigée par la DGI est posée par la case « hors champ », jamais saisie.
 */
export function isReservedItemCode(code: string): boolean {
  const folded = code
    .toUpperCase()
    .replace(/[\s._/-]+/g, ' ')
    .trim();
  return folded === OUT_OF_SCOPE_ITEM_CODE;
}

export interface CatalogItemInput {
  code: string | null;
  name: string;
  itemType: ItemType;
  taxGroup: TaxGroupLetter;
  outOfScope: boolean;
  unitPrice: string;
  priceMode: PriceMode;
  currency: 'CDF';
  unit: string;
  specificTax: SpecificTax | null;
}

const CatalogFields = {
  code: z.unknown().optional(),
  name: z.unknown().optional(),
  itemType: z.unknown().optional(),
  taxGroup: z.unknown().optional(),
  outOfScope: z.unknown().optional(),
  unitPrice: z.unknown().optional(),
  priceMode: z.unknown().optional(),
  currency: z.unknown().optional(),
  unit: z.unknown().optional(),
  specificTax: z.unknown().optional(),
};

type RawCatalogItem = { [K in keyof typeof CatalogFields]?: unknown };

function decimalIssue(
  ctx: Ctx,
  path: string,
  reason: Exclude<DecimalParse, { ok: true }>['reason'],
  invalidCode: string,
  tooPreciseCode: string,
): void {
  if (reason === 'number') {
    issue(
      ctx,
      path,
      'DECIMAL_MUST_BE_STRING',
      'Montant attendu sous forme de chaîne (par exemple "464.00"), jamais de nombre.',
    );
  } else if (reason === 'too_precise') {
    issue(ctx, path, tooPreciseCode, 'Deux décimales au plus.');
  } else if (reason === 'too_large') {
    issue(ctx, path, invalidCode, 'Montant trop élevé : treize chiffres au plus avant la virgule.');
  } else {
    issue(ctx, path, invalidCode, 'Montant invalide : chiffres et point décimal seulement.');
  }
}

function normalizeSpecificTax(raw: unknown, ctx: Ctx): SpecificTax | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issue(ctx, 'specificTax', 'SPECIFIC_TAX_INVALID', 'Taxe spécifique invalide.');
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const kind = obj['kind'];
  const field = kind === 'per_unit' ? 'amount' : kind === 'percent' ? 'rate' : null;
  if (field === null) {
    issue(
      ctx,
      'specificTax.kind',
      'SPECIFIC_TAX_INVALID',
      'Nature de la taxe spécifique : "per_unit" ou "percent".',
    );
    return null;
  }
  const extra = Object.keys(obj).filter((k) => k !== 'kind' && k !== field);
  if (extra.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.unrecognized_keys,
      keys: extra,
      path: ['specificTax'],
      message: `Champ(s) inconnu(s) : ${extra.join(', ')}.`,
    });
    return null;
  }
  const parsed = parseDecimalInput(obj[field], { maxIntegerDigits: 13, decimals: 2 });
  const path = `specificTax.${field}`;
  if (!parsed.ok) {
    decimalIssue(ctx, path, parsed.reason, 'SPECIFIC_TAX_INVALID', 'SPECIFIC_TAX_INVALID');
    return null;
  }
  if (parsed.isZero) {
    issue(ctx, path, 'SPECIFIC_TAX_INVALID', 'La taxe spécifique doit être strictement positive.');
    return null;
  }
  if (kind === 'percent') {
    // Strictement inférieur à 100 : au plus deux chiffres avant la virgule.
    if (parsed.integerPart.length > 2) {
      issue(ctx, path, 'SPECIFIC_TAX_INVALID', 'Un taux est strictement inférieur à 100 %.');
      return null;
    }
    return { kind: 'percent', rate: parsed.canonical };
  }
  return { kind: 'per_unit', amount: parsed.canonical };
}

function normalizeCatalogItem(raw: RawCatalogItem, ctx: Ctx): CatalogItemInput {
  // Code interne (facultatif).
  let code: string | null = null;
  if (raw.code !== null && raw.code !== undefined) {
    if (typeof raw.code !== 'string') {
      issue(ctx, 'code', 'CODE_INVALID', 'Code attendu sous forme de chaîne.');
    } else {
      const t = raw.code.trim();
      if (t !== '') {
        if (isReservedItemCode(t)) {
          issue(
            ctx,
            'code',
            'CODE_RESERVED',
            `« ${OUT_OF_SCOPE_ITEM_CODE} » est réservé : cochez « opération hors champ » au lieu de le saisir.`,
          );
        } else if (t.length > 50 || !CODE_PATTERN.test(t)) {
          issue(
            ctx,
            'code',
            'CODE_INVALID',
            'Code : 1 à 50 lettres, chiffres, points, tirets, soulignés ou barres obliques.',
          );
        }
        code = t;
      }
    }
  }

  // Désignation.
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (raw.name !== undefined && raw.name !== null && typeof raw.name !== 'string') {
    issue(ctx, 'name', 'NAME_REQUIRED', 'Désignation attendue sous forme de chaîne.');
  } else if (name === '') {
    issue(ctx, 'name', 'NAME_REQUIRED', 'La désignation est obligatoire.');
  } else if (name.length > 200) {
    issue(ctx, 'name', 'NAME_TOO_LONG', '200 caractères au plus.');
  }

  // Groupe de taxation : A à P seulement ; Q à Z ne sont définis par aucun document.
  const taxGroup = isTaxGroupLetter(raw.taxGroup) ? raw.taxGroup : null;
  if (taxGroup === null) {
    issue(
      ctx,
      'taxGroup',
      'UNKNOWN_TAX_GROUP',
      'Groupe de taxation inconnu : une lettre de A à P.',
    );
  }

  // Type d'article.
  const itemTypes: readonly string[] = ITEM_TYPES;
  const itemType =
    typeof raw.itemType === 'string' && itemTypes.includes(raw.itemType)
      ? (raw.itemType as ItemType)
      : null;
  if (itemType === null) {
    issue(ctx, 'itemType', 'ITEM_TYPE_INVALID', 'Type d’article : BIE, SER ou TAX.');
  } else if (taxGroup !== null && !isItemTypeAllowed(taxGroup, itemType)) {
    issue(
      ctx,
      'itemType',
      'ITEM_TYPE_NOT_ALLOWED_FOR_GROUP',
      taxGroup === 'L' || taxGroup === 'N'
        ? `Le groupe ${taxGroup} n’admet que le type TAX.`
        : `Le type TAX est réservé aux groupes L et N.`,
    );
  }

  // Hors champ : groupe A seulement.
  let outOfScope = false;
  if (raw.outOfScope !== undefined && raw.outOfScope !== null) {
    if (typeof raw.outOfScope !== 'boolean') {
      issue(ctx, 'outOfScope', 'INVALID_TYPE', 'Valeur attendue : true ou false.');
    } else {
      outOfScope = raw.outOfScope;
    }
  }
  if (outOfScope && taxGroup !== null && taxGroup !== 'A') {
    issue(
      ctx,
      'outOfScope',
      'OUT_OF_SCOPE_ONLY_GROUP_A',
      'Une opération hors champ relève du groupe A seulement.',
    );
  }

  // Prix unitaire.
  let unitPrice = '';
  const price = parseDecimalInput(raw.unitPrice, { maxIntegerDigits: 13, decimals: 2 });
  if (!price.ok) {
    if (raw.unitPrice === undefined || raw.unitPrice === null) {
      issue(ctx, 'unitPrice', 'FIELD_REQUIRED', 'Le prix unitaire est obligatoire.');
    } else {
      decimalIssue(ctx, 'unitPrice', price.reason, 'PRICE_INVALID', 'PRICE_TOO_PRECISE');
    }
  } else if (price.isZero) {
    issue(
      ctx,
      'unitPrice',
      'PRICE_NOT_POSITIVE',
      'Le prix unitaire doit être strictement positif.',
    );
  } else {
    unitPrice = price.canonical;
  }

  // Mode de prix.
  const priceMode = raw.priceMode === 'ttc' || raw.priceMode === 'ht' ? raw.priceMode : null;
  if (priceMode === null) {
    issue(ctx, 'priceMode', 'PRICE_MODE_INVALID', 'Mode de prix : "ttc" ou "ht".');
  }

  // Devise : CDF seulement dans ce lot (décision ouverte n° 2).
  if (raw.currency !== undefined && raw.currency !== 'CDF') {
    issue(
      ctx,
      'currency',
      'CURRENCY_NOT_SUPPORTED',
      'Seul le franc congolais (CDF) est admis : la facture normalisée est libellée en CDF.',
    );
  }

  // Unité de mesure.
  const unit = typeof raw.unit === 'string' ? raw.unit.trim() : '';
  if (unit === '') {
    issue(ctx, 'unit', 'UNIT_REQUIRED', 'L’unité de mesure est obligatoire.');
  } else if (unit.length > 20) {
    issue(ctx, 'unit', 'UNIT_TOO_LONG', '20 caractères au plus.');
  }

  // Taxe spécifique : interdite en L et N.
  const specificTax = normalizeSpecificTax(raw.specificTax, ctx);
  if (specificTax !== null && (taxGroup === 'L' || taxGroup === 'N')) {
    issue(
      ctx,
      'specificTax',
      'SPECIFIC_TAX_NOT_ALLOWED',
      `Une taxe spécifique n’est pas admise en groupe ${taxGroup}.`,
    );
  }

  return {
    code,
    name,
    itemType: itemType ?? 'BIE',
    taxGroup: taxGroup ?? 'A',
    outOfScope,
    unitPrice,
    priceMode: priceMode ?? 'ttc',
    currency: 'CDF',
    unit,
    specificTax,
  };
}

/** `POST /sales/catalog-items`. */
export const CreateCatalogItemSchema = z
  .object(CatalogFields)
  .strict()
  .transform((raw, ctx) => normalizeCatalogItem(raw, ctx));

/** `PUT /sales/catalog-items/:itemId` : article entier + révision attendue. */
export const PutCatalogItemSchema = z
  .object({ ...CatalogFields, expectedRevision })
  .strict()
  .transform((raw, ctx) => {
    const { expectedRevision: rev, ...rest } = raw;
    return { expectedRevision: rev, item: normalizeCatalogItem(rest, ctx) };
  });

// ── Paramètres de liste ──────────────────────────────────────────────────────

export const LIST_STATUSES = ['active', 'inactive', 'all'] as const;
export type ListStatus = (typeof LIST_STATUSES)[number];

const ListBase = {
  q: z
    .string()
    .trim()
    .min(1, 'Recherche : 1 à 100 caractères.')
    .max(100, 'Recherche : 1 à 100 caractères.')
    .optional(),
  status: z.enum(LIST_STATUSES).default('active'),
  limit: z
    .string()
    .regex(/^\d{1,3}$/, 'Limite : un entier de 1 à 100.')
    .transform((v) => Number.parseInt(v, 10))
    .pipe(z.number().int().min(1).max(100))
    .default('50'),
  cursor: z.string().min(1).max(512).optional(),
};

export const ListCustomersQuerySchema = z
  .object({ ...ListBase, type: z.enum(CUSTOMER_TYPES).optional() })
  .strict();
export type ListCustomersQuery = z.output<typeof ListCustomersQuerySchema>;

export const ListCatalogItemsQuerySchema = z
  .object({
    ...ListBase,
    taxGroup: z
      .string()
      .refine(isTaxGroupLetter, 'Groupe de taxation : une lettre de A à P.')
      .optional(),
    itemType: z.enum(ITEM_TYPES).optional(),
  })
  .strict();
export type ListCatalogItemsQuery = z.output<typeof ListCatalogItemsQuerySchema>;
