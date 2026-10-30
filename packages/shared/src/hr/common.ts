// Briques de schéma communes aux contrats des ressources humaines (ADR-0045 § 1).
// ADR-0045 — H0.
//
// Mêmes règles que `@lalanda/shared/purchases` : corps `.strict()`, codes métier dans
// `params.code`, identifiants Mongo ramenés en minuscules, montants et durées en
// CHAÎNES décimales (jamais un `number` JSON), dates civiles `AAAA-MM-JJ` au jour de
// Kinshasa. Les règles qui exigent la base (ressource d'une autre organisation → 404,
// collaborateur actif, membre de l'organisation) sont vérifiées par les services, pas
// ici. Les lots H2 à H5 RÉUTILISENT ces briques dans leurs propres fichiers.

import { z } from 'zod';

import {
  HR_CONTRACT_TYPE_KEY_PATTERN,
  HR_CURRENCIES,
  HR_LIMITS,
  HR_WEEKDAYS,
  HR_WORK_FRACTIONS,
  LEAVE_HALVES,
  type HrWorkPattern,
} from './constants.js';

type RawIssue = z.core.$ZodRawIssue;
type Ctx = z.RefinementCtx;

/**
 * Message français d'un schéma. Repose `received` comme `fr()` de
 * `@lalanda/shared/work` : un champ absent reste reconnu `FIELD_REQUIRED` par l'API.
 */
export function hrFr(message: string): { error: (iss: RawIssue) => string } {
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
export function hrIssue(ctx: Ctx, code: string, message: string, path?: PropertyKey[]): void {
  ctx.addIssue({
    code: 'custom',
    message,
    params: { code },
    ...(path === undefined ? {} : { path }),
  });
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Identifiant Mongo (24 hexadécimaux), ramené en minuscules. */
export const HrId = z
  .string(hrFr('Identifiant attendu.'))
  .refine((v) => OBJECT_ID.test(v), {
    message: 'Identifiant invalide.',
    params: { code: 'HR_ID_INVALID' },
  })
  .transform((v) => v.toLowerCase());

/** Révision attendue (écriture concurrente → `409 STALE_REVISION`). */
export const HrExpectedRevision = z
  .number(hrFr('Révision attendue : un entier.'))
  .int({ message: 'Révision attendue : un entier.' })
  .min(1);

/** Devise d'un salaire déclaré : `CDF` ou `USD`, jamais convertie. */
export const HrCurrencySchema = z.enum(HR_CURRENCIES, hrFr('Devise attendue : CDF ou USD.'));

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

/** Vrai pour une date civile `AAAA-MM-JJ` qui existe au calendrier grégorien. */
export function isHrCalendarDay(value: string): boolean {
  const m = CALENDAR_DAY.exec(value);
  if (m === null) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(Number(m[1]), month);
}

/** Date civile au jour de Kinshasa (ADR-0027). */
export const HrCalendarDay = z
  .string(hrFr('Date attendue au format AAAA-MM-JJ.'))
  .refine(isHrCalendarDay, {
    message: 'Date attendue au format AAAA-MM-JJ.',
    params: { code: 'INVALID_DATE' },
  });

const MONTH_DAY = /^(\d{2})-(\d{2})$/;

/**
 * Vrai pour un jour de l'année `MM-JJ` (début de l'année de congé, § 2.2). Le 29 février
 * est refusé : une année de congé doit commencer chaque année.
 */
export function isHrMonthDay(value: string): boolean {
  const m = MONTH_DAY.exec(value);
  if (m === null) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(2025, month);
}

export const HrMonthDay = z.string(hrFr('Jour attendu au format MM-JJ.')).refine(isHrMonthDay, {
  message: 'Jour attendu au format MM-JJ.',
  params: { code: 'INVALID_MONTH_DAY' },
});

const AMOUNT = /^(\d{1,13})(?:\.(\d+))?$/;

/**
 * Forme canonique d'un montant décimal positif ou nul, deux décimales au plus
 * (`"12.5"` → `"12.50"`), ou `null`. Forme seulement : aucun calcul.
 */
export function canonicalHrAmount(raw: string): string | null {
  const m = AMOUNT.exec(raw);
  if (m === null) return null;
  const fraction = m[2] ?? '';
  if (fraction.length > 2) return null;
  const integer = m[1]!.replace(/^0+(?=\d)/, '');
  return `${integer}.${fraction.padEnd(2, '0')}`;
}

/** Montant strictement positif (salaire de base déclaré), canonique (`"450000.00"`). */
export const HrPositiveAmount = z.unknown().transform((raw, ctx): string => {
  if (typeof raw === 'number') {
    hrIssue(
      ctx,
      'DECIMAL_MUST_BE_STRING',
      'Montant attendu sous forme de chaîne (par exemple "12.50"), jamais de nombre.',
    );
    return z.NEVER;
  }
  if (typeof raw !== 'string') {
    hrIssue(ctx, 'FIELD_REQUIRED', 'Montant obligatoire.');
    return z.NEVER;
  }
  const canonical = canonicalHrAmount(raw.trim());
  if (canonical === null) {
    hrIssue(
      ctx,
      'INVALID_AMOUNT',
      'Montant invalide : chiffres et point décimal, deux décimales au plus.',
    );
    return z.NEVER;
  }
  if (canonical === '0.00') {
    hrIssue(ctx, 'AMOUNT_NOT_POSITIVE', 'Le montant doit être strictement positif.');
    return z.NEVER;
  }
  return canonical;
});

const DAYS = /^(-)?(\d{1,4})(?:\.(\d+))?$/;

/**
 * Forme canonique d'une durée en jours (`"2.5"` → `"2.50"`, `"-1"` → `"-1.00"`), deux
 * décimales au plus, ou `null`. Le moteur calcule en centièmes de jour (`bigint`) ;
 * ces chaînes en sont la forme d'échange.
 */
export function canonicalHrDays(raw: string): string | null {
  const m = DAYS.exec(raw);
  if (m === null) return null;
  const fraction = m[3] ?? '';
  if (fraction.length > 2) return null;
  const integer = m[2]!.replace(/^0+(?=\d)/, '');
  const value = `${integer}.${fraction.padEnd(2, '0')}`;
  if (m[1] === '-' && value !== '0.00') return `-${value}`;
  return value;
}

interface DaysOptions {
  /** Accepte une valeur négative (ajustement du grand livre). */
  readonly signed?: boolean;
  /** Refuse zéro. */
  readonly nonZero?: boolean;
  /** Borne absolue (inclusive), en jours entiers. */
  readonly maxAbs?: number;
}

/** Durée en jours, en chaîne, deux décimales au plus (acquisition, ajustement, § 1). */
export function hrDaysSchema(options: DaysOptions = {}) {
  return z.unknown().transform((raw, ctx): string => {
    if (typeof raw === 'number') {
      hrIssue(
        ctx,
        'DECIMAL_MUST_BE_STRING',
        'Durée attendue sous forme de chaîne (par exemple "2.50"), jamais de nombre.',
      );
      return z.NEVER;
    }
    if (typeof raw !== 'string') {
      hrIssue(ctx, 'FIELD_REQUIRED', 'Durée obligatoire.');
      return z.NEVER;
    }
    const canonical = canonicalHrDays(raw.trim());
    if (canonical === null) {
      hrIssue(ctx, 'INVALID_DAYS', 'Durée invalide : jours, deux décimales au plus.');
      return z.NEVER;
    }
    if (options.signed !== true && canonical.startsWith('-')) {
      hrIssue(ctx, 'DAYS_NEGATIVE', 'La durée ne peut pas être négative.');
      return z.NEVER;
    }
    if (options.nonZero === true && canonical === '0.00') {
      hrIssue(ctx, 'DAYS_ZERO', 'La durée ne peut pas être nulle.');
      return z.NEVER;
    }
    if (options.maxAbs !== undefined) {
      const abs = canonical.replace('-', '');
      const [int, frac] = abs.split('.') as [string, string];
      if (Number(int) > options.maxAbs || (Number(int) === options.maxAbs && frac !== '00')) {
        hrIssue(ctx, 'DAYS_TOO_LARGE', `${options.maxAbs} jours au plus.`);
        return z.NEVER;
      }
    }
    return canonical;
  });
}

/** Texte obligatoire : espaces de bord retirés, 1 à `max` caractères. */
export function hrRequiredText(max: number, what: string) {
  return z
    .string(hrFr(`${what} : texte attendu.`))
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
export function hrOptionalText(max: number) {
  return z
    .string(hrFr('Texte attendu.'))
    .trim()
    .refine((v) => v.length <= max, {
      message: `${max} caractères au plus.`,
      params: { code: 'TEXT_TOO_LONG' },
    })
    .transform((v) => (v === '' ? null : v))
    .nullable();
}

/** Paramètre booléen de requête (`true` | `false`). */
export const hrBooleanParam = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Fraction travaillée d'un jour : 0, 0,5 ou 1 (§ 2.1, `workPattern`). */
export const HrWorkFractionSchema = z
  .number(hrFr('Fraction attendue : 0, 0.5 ou 1.'))
  .refine((v) => (HR_WORK_FRACTIONS as readonly number[]).includes(v), {
    message: 'Fraction attendue : 0, 0.5 ou 1.',
    params: { code: 'WORK_FRACTION_INVALID' },
  });

/**
 * Jours travaillés d'une semaine (`{ mon…sun }`). Une semaine sans aucun jour
 * travaillé est refusée : aucune absence ne pourrait s'y décompter.
 */
export const HrWorkPatternSchema = z
  .object(
    Object.fromEntries(HR_WEEKDAYS.map((d) => [d, HrWorkFractionSchema])) as Record<
      (typeof HR_WEEKDAYS)[number],
      typeof HrWorkFractionSchema
    >,
  )
  .strict()
  .superRefine((pattern, ctx) => {
    if (HR_WEEKDAYS.every((d) => pattern[d] === 0)) {
      hrIssue(ctx, 'WORK_PATTERN_EMPTY', 'Au moins un jour travaillé est attendu.');
    }
  })
  .transform((p) => p as HrWorkPattern);

/** Borne d'une demande d'absence : `{ date, half: 'full' | 'am' | 'pm' }` (§ 2.7). */
export const LeaveBoundarySchema = z
  .object({
    date: HrCalendarDay,
    half: z.enum(LEAVE_HALVES, hrFr('Demi-journée attendue : full, am ou pm.')),
  })
  .strict();
export type LeaveBoundary = z.output<typeof LeaveBoundarySchema>;

/** Type de contrat de l'organisation (§ 2.2) : libellé libre, aucun effet légal calculé. */
export const HrContractTypeSchema = z
  .object({
    key: z.string(hrFr('Clé attendue.')).refine((v) => HR_CONTRACT_TYPE_KEY_PATTERN.test(v), {
      message: 'Clé : minuscules, chiffres et tirets bas, 40 caractères au plus.',
      params: { code: 'CONTRACT_TYPE_KEY_INVALID' },
    }),
    label: hrRequiredText(HR_LIMITS.contractTypeLabel, 'Libellé'),
    hasEndDate: z.boolean(hrFr('Booléen attendu.')),
    active: z.boolean(hrFr('Booléen attendu.')),
  })
  .strict();
export type HrContractTypeInput = z.output<typeof HrContractTypeSchema>;
