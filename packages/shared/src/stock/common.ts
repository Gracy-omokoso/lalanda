// Briques de schéma communes aux contrats des stocks (ADR-0046 § 1). ADR-0046 — S0.
//
// Mêmes règles que `@lalanda/shared/purchases` et `@lalanda/shared/hr` : corps
// `.strict()`, codes métier dans `params.code`, identifiants Mongo ramenés en minuscules,
// montants, quantités et coûts en CHAÎNES décimales (jamais un `number` JSON), dates
// civiles `AAAA-MM-JJ` au jour de Kinshasa. Les règles qui exigent la base (ressource
// d'une autre organisation → 404, unité verrouillée, disponible) sont vérifiées par les
// services. Les lots S3 à S7 RÉUTILISENT ces briques dans leurs propres fichiers.

import { z } from 'zod';

import {
  STOCK_CURRENCIES,
  STOCK_ITEM_KINDS,
  STOCK_LIMITS,
  STOCK_LOCATION_KINDS,
  STOCK_MOVEMENT_KINDS,
} from './constants.js';

type RawIssue = z.core.$ZodRawIssue;
type Ctx = z.RefinementCtx;

/**
 * Message français d'un schéma. Repose `received` comme `fr()` de
 * `@lalanda/shared/work` : un champ absent reste reconnu `FIELD_REQUIRED` par l'API.
 */
export function stockFr(message: string): { error: (iss: RawIssue) => string } {
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

/** Ajoute une erreur portant un code métier stable (`params.code`). */
export function stockIssue(ctx: Ctx, code: string, message: string, path?: PropertyKey[]): void {
  ctx.addIssue({
    code: 'custom',
    message,
    params: { code },
    ...(path === undefined ? {} : { path }),
  });
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Identifiant Mongo (24 hexadécimaux), ramené en minuscules. */
export const StockId = z
  .string(stockFr('Identifiant attendu.'))
  .refine((v) => OBJECT_ID.test(v), {
    message: 'Identifiant invalide.',
    params: { code: 'STOCK_ID_INVALID' },
  })
  .transform((v) => v.toLowerCase());

/** Révision attendue (écriture concurrente → `409 STALE_REVISION`). */
export const StockExpectedRevision = z
  .number(stockFr('Révision attendue : un entier.'))
  .int({ message: 'Révision attendue : un entier.' })
  .min(1);

/** Devise de valorisation : `CDF` ou `USD`, jamais convertie. */
export const StockCurrencySchema = z.enum(
  STOCK_CURRENCIES,
  stockFr('Devise attendue : CDF ou USD.'),
);

export const StockItemKindSchema = z.enum(
  STOCK_ITEM_KINDS,
  stockFr('Nature attendue : goods, consumable ou material.'),
);

export const StockLocationKindSchema = z.enum(
  STOCK_LOCATION_KINDS,
  stockFr('Type d’emplacement attendu : warehouse, shop, vehicle, site ou other.'),
);

export const StockMovementKindSchema = z.enum(
  STOCK_MOVEMENT_KINDS,
  stockFr('Nature de mouvement inconnue.'),
);

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Vrai pour une date civile `AAAA-MM-JJ` qui existe au calendrier grégorien. */
export function isStockCalendarDay(value: string): boolean {
  const m = CALENDAR_DAY.exec(value);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= lengths[month - 1]!;
}

/**
 * Date civile au jour de Kinshasa (ADR-0027). « Jamais future » dépend de l'horloge :
 * c'est le service qui le vérifie, avec le jour de référence du serveur.
 */
export const StockCalendarDay = z
  .string(stockFr('Date attendue au format AAAA-MM-JJ.'))
  .refine(isStockCalendarDay, {
    message: 'Date attendue au format AAAA-MM-JJ.',
    params: { code: 'INVALID_DATE' },
  });

const DECIMAL = /^(-)?(\d{1,13})(?:\.(\d+))?$/;

/**
 * Forme canonique d'un décimal à `decimals` décimales au plus (`"2.5"`, 3 → `"2.500"`),
 * signé si `signed`, ou `null` si la chaîne n'en est pas un. Forme seulement : aucun
 * calcul (le moteur calcule en `bigint`).
 */
export function canonicalStockDecimal(
  raw: string,
  decimals: number,
  signed = false,
): string | null {
  const m = DECIMAL.exec(raw);
  if (m === null) return null;
  if (m[1] === '-' && !signed) return null;
  const fraction = m[3] ?? '';
  if (fraction.length > decimals) return null;
  const integer = m[2]!.replace(/^0+(?=\d)/, '');
  const body = decimals === 0 ? integer : `${integer}.${fraction.padEnd(decimals, '0')}`;
  const isZero = /^[0.]+$/.test(body);
  return m[1] === '-' && !isZero ? `-${body}` : body;
}

interface DecimalOptions {
  readonly decimals: number;
  readonly what: string;
  readonly invalidCode: string;
  /** Accepte une valeur négative. */
  readonly signed?: boolean;
  /** Refuse zéro. */
  readonly nonZero?: boolean;
}

function decimalSchema(options: DecimalOptions) {
  return z.unknown().transform((raw, ctx): string => {
    if (typeof raw === 'number') {
      stockIssue(
        ctx,
        'DECIMAL_MUST_BE_STRING',
        `${options.what} attendu sous forme de chaîne (par exemple "12.5"), jamais de nombre.`,
      );
      return z.NEVER;
    }
    if (typeof raw !== 'string') {
      stockIssue(ctx, 'FIELD_REQUIRED', `${options.what} obligatoire.`);
      return z.NEVER;
    }
    const canonical = canonicalStockDecimal(raw.trim(), options.decimals, options.signed === true);
    if (canonical === null) {
      stockIssue(
        ctx,
        options.invalidCode,
        `${options.what} invalide : chiffres et point décimal, ${options.decimals} décimales au plus.`,
      );
      return z.NEVER;
    }
    if (options.nonZero === true && /^-?[0.]+$/.test(canonical)) {
      stockIssue(ctx, 'QUANTITY_ZERO', `${options.what} ne peut pas être nul.`);
      return z.NEVER;
    }
    return canonical;
  });
}

/** Quantité strictement positive en unité de stock (ligne de bon, § 2.4), `"4.000"`. */
export const StockPositiveQuantity = decimalSchema({
  decimals: STOCK_LIMITS.quantityDecimals,
  what: 'Quantité',
  invalidCode: 'INVALID_QUANTITY',
  nonZero: true,
});

/** Quantité positive ou nulle (quantité comptée d'une ligne d'inventaire, seuils). */
export const StockQuantity = decimalSchema({
  decimals: STOCK_LIMITS.quantityDecimals,
  what: 'Quantité',
  invalidCode: 'INVALID_QUANTITY',
});

/** Quantité signée non nulle d'un mouvement (entrées > 0, sorties < 0, § 2.3). */
export const StockSignedQuantity = decimalSchema({
  decimals: STOCK_LIMITS.quantityDecimals,
  what: 'Quantité',
  invalidCode: 'INVALID_QUANTITY',
  signed: true,
  nonZero: true,
});

/** Coût unitaire positif ou nul, six décimales au plus, dans `costCurrency` de l'article. */
export const StockUnitCost = decimalSchema({
  decimals: STOCK_LIMITS.unitCostDecimals,
  what: 'Coût unitaire',
  invalidCode: 'INVALID_UNIT_COST',
});

/** Facteur de conversion d'unité, strictement positif, six décimales au plus (§ 2.1). */
export const StockConversionFactor = decimalSchema({
  decimals: STOCK_LIMITS.conversionFactorDecimals,
  what: 'Facteur',
  invalidCode: 'INVALID_CONVERSION_FACTOR',
  nonZero: true,
});

/** Texte obligatoire : espaces de bord retirés, 1 à `max` caractères. */
export function stockRequiredText(max: number, what: string) {
  return z
    .string(stockFr(`${what} : texte attendu.`))
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
export function stockOptionalText(max: number) {
  return z
    .string(stockFr('Texte attendu.'))
    .trim()
    .refine((v) => v.length <= max, {
      message: `${max} caractères au plus.`,
      params: { code: 'TEXT_TOO_LONG' },
    })
    .transform((v) => (v === '' ? null : v))
    .nullable();
}

/** Unité : 1 à 20 caractères (`pièce`, `kg`, `carton`…). */
export const StockUnitSchema = stockRequiredText(STOCK_LIMITS.unit, 'Unité');

/** Conversion `{ unit, factor }` : 1 `unit` = `factor` unités de stock (§ 2.1). */
export const StockUnitConversionSchema = z
  .object({ unit: StockUnitSchema, factor: StockConversionFactor })
  .strict();
export type StockUnitConversionInput = z.output<typeof StockUnitConversionSchema>;

/**
 * 0 à 5 conversions, unités distinctes (casse ignorée). Que l'unité de stock elle-même
 * n'y figure pas est vérifié par le service (elle vit sur l'article).
 */
export const StockUnitConversionsSchema = z
  .array(StockUnitConversionSchema, stockFr('Liste de conversions attendue.'))
  .max(STOCK_LIMITS.unitConversions, {
    message: `${STOCK_LIMITS.unitConversions} conversions au plus.`,
  })
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((c, i) => {
      const key = c.unit.toLowerCase();
      if (seen.has(key)) {
        stockIssue(ctx, 'UNIT_CONVERSION_DUPLICATE', 'Unité en double.', [i, 'unit']);
      }
      seen.add(key);
    });
  });

/** Seuil de réapprovisionnement `{ minQuantity, targetQuantity?, locationId | null }`. */
export const StockReorderSchema = z
  .object({
    minQuantity: StockQuantity,
    targetQuantity: StockQuantity.nullable().optional(),
    locationId: StockId.nullable(),
  })
  .strict();
export type StockReorderInput = z.output<typeof StockReorderSchema>;

/** Paramètre booléen de requête (`true` | `false`). */
export const stockBooleanParam = z.enum(['true', 'false']).transform((v) => v === 'true');

/**
 * Enveloppe des réponses qui portent des VALEURS (§ 5) : sans `purchase.read` ni
 * `treasury.read`, chaque champ de valeur vaut `null` et `valuesHidden` est `true`.
 */
export interface StockValuesVisibility {
  readonly valuesHidden: boolean;
}
