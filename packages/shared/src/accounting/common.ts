// Briques de schéma communes aux contrats de la comptabilité (ADR-0049 O8). ADR-0049 — K0.
//
// Mêmes règles que `@lalanda/shared/stock` et `@lalanda/shared/hr` : corps `.strict()`,
// codes métier dans `params.code`, identifiants Mongo ramenés en minuscules, montants et
// taux en CHAÎNES décimales (jamais un `number` JSON : le moteur calcule en `bigint`),
// dates civiles `AAAA-MM-JJ` au jour de Kinshasa (ADR-0027). Aucune donnée comptable dans
// l'URL au-delà des identifiants et des périodes (§ 11) : les recherches passent en corps.
// Les lots K4 à K7 RÉUTILISENT ces briques dans leurs propres fichiers.

import { z } from 'zod';

import {
  ACCOUNTING_BOOK_CURRENCIES,
  ACCOUNTING_JOURNAL_KINDS,
  ACCOUNTING_LIMITS,
  ACCOUNTING_MODES,
  ACCOUNTING_STATEMENT_KINDS,
  type AccountingReserve,
  type AccountingStatementStatus,
} from './constants.js';

type RawIssue = z.core.$ZodRawIssue;
type Ctx = z.RefinementCtx;

/**
 * Message français d'un schéma. Repose `received` comme `fr()` de
 * `@lalanda/shared/work` : un champ absent reste reconnu `FIELD_REQUIRED` par l'API.
 */
export function accountingFr(message: string): { error: (iss: RawIssue) => string } {
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
export function accountingIssue(
  ctx: Ctx,
  code: string,
  message: string,
  path?: PropertyKey[],
): void {
  ctx.addIssue({
    code: 'custom',
    message,
    params: { code },
    ...(path === undefined ? {} : { path }),
  });
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Identifiant Mongo (24 hexadécimaux), ramené en minuscules. */
export const AccountingId = z
  .string(accountingFr('Identifiant attendu.'))
  .refine((v) => OBJECT_ID.test(v), {
    message: 'Identifiant invalide.',
    params: { code: 'ACCOUNTING_ID_INVALID' },
  })
  .transform((v) => v.toLowerCase());

/** Révision attendue (écriture concurrente → `409 STALE_REVISION`). */
export const AccountingExpectedRevision = z
  .number(accountingFr('Révision attendue : un entier.'))
  .int({ message: 'Révision attendue : un entier.' })
  .min(1);

/** Monnaie de tenue ou devise d'une pièce : `CDF` ou `USD`, jamais convertie en silence. */
export const AccountingCurrencySchema = z.enum(
  ACCOUNTING_BOOK_CURRENCIES,
  accountingFr('Devise attendue : CDF ou USD.'),
);

export const AccountingModeSchema = z.enum(
  ACCOUNTING_MODES,
  accountingFr('Mode attendu : off, simulation ou active.'),
);

export const AccountingJournalKindSchema = z.enum(
  ACCOUNTING_JOURNAL_KINDS,
  accountingFr('Nature de journal attendue : sales, purchases, treasury, misc ou opening.'),
);

export const AccountingStatementKindSchema = z.enum(
  ACCOUNTING_STATEMENT_KINDS,
  accountingFr('État attendu : balance-sheet, income-statement ou cash-flow.'),
);

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Vrai pour une date civile `AAAA-MM-JJ` qui existe au calendrier grégorien. */
export function isAccountingCalendarDay(value: string): boolean {
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

/** Date civile au jour de Kinshasa (ADR-0027) : pièce, bascule, taux saisi. */
export const AccountingCalendarDay = z
  .string(accountingFr('Date attendue au format AAAA-MM-JJ.'))
  .refine(isAccountingCalendarDay, {
    message: 'Date attendue au format AAAA-MM-JJ.',
    params: { code: 'INVALID_DATE' },
  });

/** Année d'exercice (chemin `/:year`), de 2000 à 2999. */
export const AccountingYearParam = z
  .string(accountingFr('Année attendue.'))
  .regex(/^2\d{3}$/, { message: 'Année attendue sur quatre chiffres.' })
  .transform((v) => Number(v));

/** Mois (chemin `/:month`), de 1 à 12. */
export const AccountingMonthParam = z
  .string(accountingFr('Mois attendu.'))
  .regex(/^(?:[1-9]|0[1-9]|1[0-2])$/, { message: 'Mois attendu entre 1 et 12.' })
  .transform((v) => Number(v));

/** Mois de début d'exercice (1 à 12) ; défaut janvier, à confirmer par l'expert (E6). */
export const AccountingFiscalYearStartMonth = z
  .number(accountingFr('Mois attendu : un entier de 1 à 12.'))
  .int({ message: 'Mois attendu : un entier de 1 à 12.' })
  .min(1, { message: 'Mois attendu : un entier de 1 à 12.' })
  .max(12, { message: 'Mois attendu : un entier de 1 à 12.' });

/**
 * Numéro de compte : chiffres seulement, 1 à 20. FORME seulement — l'existence du compte
 * dans le plan, et le rattachement d'un compte propre à un compte du pack
 * (`409 ACCOUNT_OUTSIDE_PACK`), sont vérifiés par le service. Aucun numéro n'est connu ici.
 */
export const AccountingAccountNumber = z
  .string(accountingFr('Numéro de compte attendu.'))
  .trim()
  .refine((v) => new RegExp(`^\\d{1,${ACCOUNTING_LIMITS.accountNumberMaxDigits}}$`).test(v), {
    message: `Numéro de compte : chiffres seulement, ${ACCOUNTING_LIMITS.accountNumberMaxDigits} au plus.`,
    params: { code: 'ACCOUNT_NUMBER_INVALID' },
  });

/** Code de journal : lettres majuscules et chiffres, 1 à 10 (`VE`, `OD`, `T01`). */
export const AccountingJournalCode = z
  .string(accountingFr('Code de journal attendu.'))
  .trim()
  .refine((v) => new RegExp(`^[A-Z0-9]{1,${ACCOUNTING_LIMITS.journalCode}}$`).test(v), {
    message: `Code de journal : lettres majuscules et chiffres, ${ACCOUNTING_LIMITS.journalCode} au plus.`,
    params: { code: 'JOURNAL_CODE_INVALID' },
  });

const DECIMAL = /^(-)?(\d{1,15})(?:\.(\d+))?$/;

/**
 * Forme canonique d'un décimal positif ou nul à `decimals` décimales au plus (`"2.5"`, 2 →
 * `"2.50"`), ou `null` si la chaîne n'en est pas un. Forme seulement : aucun calcul.
 */
export function canonicalAccountingDecimal(raw: string, decimals: number): string | null {
  const m = DECIMAL.exec(raw);
  if (m === null || m[1] === '-') return null;
  const fraction = m[3] ?? '';
  if (fraction.length > decimals) return null;
  const integer = m[2]!.replace(/^0+(?=\d)/, '');
  return decimals === 0 ? integer : `${integer}.${fraction.padEnd(decimals, '0')}`;
}

function positiveDecimal(decimals: number, what: string, invalidCode: string) {
  return z.unknown().transform((raw, ctx): string => {
    if (typeof raw === 'number') {
      accountingIssue(
        ctx,
        'DECIMAL_MUST_BE_STRING',
        `${what} attendu sous forme de chaîne (par exemple "1250.00"), jamais de nombre.`,
      );
      return z.NEVER;
    }
    if (typeof raw !== 'string') {
      accountingIssue(ctx, 'FIELD_REQUIRED', `${what} obligatoire.`);
      return z.NEVER;
    }
    const canonical = canonicalAccountingDecimal(raw.trim(), decimals);
    if (canonical === null) {
      accountingIssue(
        ctx,
        invalidCode,
        `${what} invalide : chiffres et point décimal, ${decimals} décimales au plus, jamais négatif.`,
      );
      return z.NEVER;
    }
    if (/^[0.]+$/.test(canonical)) {
      accountingIssue(ctx, 'AMOUNT_ZERO', `${what} doit être strictement positif.`);
      return z.NEVER;
    }
    return canonical;
  });
}

/**
 * Montant d'une ligne (débit OU crédit), strictement positif, deux décimales au plus
 * (§ 2.6 : « chaque ligne a soit un débit soit un crédit, strictement positif »).
 */
export const AccountingAmount = positiveDecimal(
  ACCOUNTING_LIMITS.amountDecimals,
  'Montant',
  'INVALID_AMOUNT',
);

/**
 * Taux de change saisi (`accounting_exchange_rates`, § 5) : strictement positif, dix
 * décimales au plus. Jamais importé d'office, jamais déduit d'un autre document.
 */
export const AccountingRate = positiveDecimal(
  ACCOUNTING_LIMITS.rateDecimals,
  'Taux',
  'INVALID_RATE',
);

/** Texte obligatoire : espaces de bord retirés, 1 à `max` caractères. */
export function accountingRequiredText(max: number, what: string) {
  return z
    .string(accountingFr(`${what} : texte attendu.`))
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
export function accountingOptionalText(max: number) {
  return z
    .string(accountingFr('Texte attendu.'))
    .trim()
    .refine((v) => v.length <= max, {
      message: `${max} caractères au plus.`,
      params: { code: 'TEXT_TOO_LONG' },
    })
    .transform((v) => (v === '' ? null : v))
    .nullable();
}

/** Motif obligatoire : opération diverse, réouverture, acceptation d'un solde d'attente. */
export const AccountingReason = accountingRequiredText(ACCOUNTING_LIMITS.reason, 'Motif');

/** Corps d'une réouverture de mois ou d'exercice (Propriétaire seul, § 4). */
export const AccountingReopenSchema = z.object({ reason: AccountingReason }).strict();
export type AccountingReopenInput = z.output<typeof AccountingReopenSchema>;

/**
 * Enveloppe commune des projets d'états (§ 10) : `status` toujours `draft_unverified`,
 * bandeau `disclaimer` et réserves, sur CHAQUE réponse.
 */
export interface AccountingDraftEnvelope {
  readonly status: AccountingStatementStatus;
  readonly disclaimer: string;
  readonly reserves: readonly AccountingReserve[];
}
