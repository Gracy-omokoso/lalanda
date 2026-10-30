// Briques de schéma communes aux contrats des achats (ADR-0044 § 1). ADR-0044 — P0.
//
// Mêmes règles que `@lalanda/shared/crm` et `@lalanda/shared/work` : corps `.strict()`,
// codes métier dans `params.code`, identifiants Mongo ramenés en minuscules, montants
// en CHAÎNES décimales (deux décimales au plus, jamais un `number` JSON), dates civiles
// `AAAA-MM-JJ`. Les règles qui exigent la base (ressource d'une autre organisation →
// 404, fiche active, même devise) sont vérifiées par les services, pas ici. Les lots
// P2 à P6 RÉUTILISENT ces briques dans leurs propres fichiers.

import { z } from 'zod';

import { PURCHASE_CURRENCIES } from './constants.js';

type RawIssue = z.core.$ZodRawIssue;
type Ctx = z.RefinementCtx;

/**
 * Message français d'un schéma. Repose `received` comme `fr()` de
 * `@lalanda/shared/work` : un champ absent reste reconnu `FIELD_REQUIRED` par l'API.
 */
export function purchaseFr(message: string): { error: (iss: RawIssue) => string } {
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
export function purchaseIssue(ctx: Ctx, code: string, message: string, path?: PropertyKey[]): void {
  ctx.addIssue({
    code: 'custom',
    message,
    params: { code },
    ...(path === undefined ? {} : { path }),
  });
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Identifiant Mongo (24 hexadécimaux), ramené en minuscules. */
export const PurchaseId = z
  .string(purchaseFr('Identifiant attendu.'))
  .refine((v) => OBJECT_ID.test(v), {
    message: 'Identifiant invalide.',
    params: { code: 'PURCHASE_ID_INVALID' },
  })
  .transform((v) => v.toLowerCase());

/** Révision attendue (écriture concurrente → `409 STALE_REVISION`). */
export const PurchaseExpectedRevision = z
  .number(purchaseFr('Révision attendue : un entier.'))
  .int({ message: 'Révision attendue : un entier.' })
  .min(1);

/** Devise d'un achat : `CDF` ou `USD`, jamais convertie. */
export const PurchaseCurrencySchema = z.enum(
  PURCHASE_CURRENCIES,
  purchaseFr('Devise attendue : CDF ou USD.'),
);

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Vrai pour une date civile `AAAA-MM-JJ` qui existe au calendrier grégorien. */
export function isPurchaseCalendarDay(value: string): boolean {
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
export const PurchaseCalendarDay = z
  .string(purchaseFr('Date attendue au format AAAA-MM-JJ.'))
  .refine(isPurchaseCalendarDay, {
    message: 'Date attendue au format AAAA-MM-JJ.',
    params: { code: 'INVALID_DATE' },
  });

const DECIMAL = /^(\d{1,13})(?:\.(\d+))?$/;

/**
 * Forme canonique d'un montant décimal positif ou nul, deux décimales au plus
 * (`"12.5"` → `"12.50"`), ou `null` si la chaîne n'est pas un montant. Forme
 * seulement : aucun calcul (le moteur calcule en `bigint`).
 */
export function canonicalPurchaseAmount(raw: string): string | null {
  const m = DECIMAL.exec(raw);
  if (m === null) return null;
  const fraction = m[2] ?? '';
  if (fraction.length > 2) return null;
  const integer = m[1]!.replace(/^0+(?=\d)/, '');
  return `${integer}.${fraction.padEnd(2, '0')}`;
}

function amountSchema(allowZero: boolean) {
  return z.unknown().transform((raw, ctx): string => {
    if (typeof raw === 'number') {
      purchaseIssue(
        ctx,
        'DECIMAL_MUST_BE_STRING',
        'Montant attendu sous forme de chaîne (par exemple "12.50"), jamais de nombre.',
      );
      return z.NEVER;
    }
    if (typeof raw !== 'string') {
      purchaseIssue(ctx, 'FIELD_REQUIRED', 'Montant obligatoire.');
      return z.NEVER;
    }
    const canonical = canonicalPurchaseAmount(raw.trim());
    if (canonical === null) {
      purchaseIssue(
        ctx,
        'INVALID_AMOUNT',
        'Montant invalide : chiffres et point décimal, deux décimales au plus.',
      );
      return z.NEVER;
    }
    if (!allowZero && canonical === '0.00') {
      purchaseIssue(ctx, 'AMOUNT_NOT_POSITIVE', 'Le montant doit être strictement positif.');
      return z.NEVER;
    }
    return canonical;
  });
}

/** Montant strictement positif, canonique (`"12.50"`). */
export const PurchasePositiveAmount = amountSchema(false);
/** Montant positif ou nul (prix unitaire, seuil d'un palier, tolérance absolue). */
export const PurchaseAmount = amountSchema(true);

const QUANTITY = /^(\d{1,9})(?:\.(\d{1,3}))?$/;

/** Quantité strictement positive, trois décimales au plus, en chaîne (§ 2.3). */
export const PurchaseQuantity = z.unknown().transform((raw, ctx): string => {
  if (typeof raw !== 'string') {
    purchaseIssue(ctx, 'QUANTITY_INVALID', 'Quantité attendue sous forme de chaîne.');
    return z.NEVER;
  }
  const m = QUANTITY.exec(raw.trim());
  if (m === null) {
    purchaseIssue(ctx, 'QUANTITY_INVALID', 'Quantité : trois décimales au plus.');
    return z.NEVER;
  }
  const integer = m[1]!.replace(/^0+(?=\d)/, '');
  const fraction = (m[2] ?? '').replace(/0+$/, '');
  const canonical = fraction === '' ? integer : `${integer}.${fraction}`;
  if (/^0(\.0*)?$/.test(canonical)) {
    purchaseIssue(ctx, 'QUANTITY_NOT_POSITIVE', 'La quantité doit être strictement positive.');
    return z.NEVER;
  }
  return canonical;
});

/** Texte obligatoire : espaces de bord retirés, 1 à `max` caractères. */
export function purchaseRequiredText(max: number, what: string) {
  return z
    .string(purchaseFr(`${what} : texte attendu.`))
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
export function purchaseOptionalText(max: number) {
  return z
    .string(purchaseFr('Texte attendu.'))
    .trim()
    .refine((v) => v.length <= max, {
      message: `${max} caractères au plus.`,
      params: { code: 'TEXT_TOO_LONG' },
    })
    .transform((v) => (v === '' ? null : v))
    .nullable();
}

/** Paramètre booléen de requête (`true` | `false`). */
export const purchaseBooleanParam = z.enum(['true', 'false']).transform((v) => v === 'true');
