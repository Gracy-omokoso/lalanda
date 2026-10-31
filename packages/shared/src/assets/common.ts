// Briques de schéma communes aux contrats des équipements (ADR-0046 § 1, § 3).
// ADR-0046 — S0.
//
// Mêmes règles que `@lalanda/shared/stock` : corps `.strict()`, codes métier dans
// `params.code`, identifiants Mongo ramenés en minuscules, montants en CHAÎNES
// décimales (deux décimales au plus), dates civiles `AAAA-MM-JJ` au jour de Kinshasa.
// Les liens (fournisseur, facture fournisseur, dépense, collaborateur, projet,
// emplacement, membre) sont vérifiés DANS L'ORGANISATION par les services (404 sinon).
// Les lots S5 et S7 RÉUTILISENT ces briques dans leurs propres fichiers.

import { z } from 'zod';

import {
  ASSET_COVERAGE_KINDS,
  ASSET_CURRENCIES,
  ASSET_LIMITS,
  ASSET_MAINTENANCE_KINDS,
  ASSET_STATUSES,
} from './constants.js';

type RawIssue = z.core.$ZodRawIssue;
type Ctx = z.RefinementCtx;

/** Message français d'un schéma (repose `received`, motif de `@lalanda/shared/work`). */
export function assetFr(message: string): { error: (iss: RawIssue) => string } {
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
export function assetIssue(ctx: Ctx, code: string, message: string, path?: PropertyKey[]): void {
  ctx.addIssue({
    code: 'custom',
    message,
    params: { code },
    ...(path === undefined ? {} : { path }),
  });
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Identifiant Mongo (24 hexadécimaux), ramené en minuscules. */
export const AssetId = z
  .string(assetFr('Identifiant attendu.'))
  .refine((v) => OBJECT_ID.test(v), {
    message: 'Identifiant invalide.',
    params: { code: 'ASSET_ID_INVALID' },
  })
  .transform((v) => v.toLowerCase());

/** Révision attendue (écriture concurrente → `409 STALE_REVISION`). */
export const AssetExpectedRevision = z
  .number(assetFr('Révision attendue : un entier.'))
  .int({ message: 'Révision attendue : un entier.' })
  .min(1);

export const AssetCurrencySchema = z.enum(
  ASSET_CURRENCIES,
  assetFr('Devise attendue : CDF ou USD.'),
);

export const AssetStatusSchema = z.enum(ASSET_STATUSES, assetFr('Statut d’équipement inconnu.'));

export const AssetMaintenanceKindSchema = z.enum(
  ASSET_MAINTENANCE_KINDS,
  assetFr('Nature attendue : preventive, corrective ou inspection.'),
);

export const AssetCoverageKindSchema = z.enum(
  ASSET_COVERAGE_KINDS,
  assetFr('Nature attendue : warranty, insurance ou service_contract.'),
);

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Vrai pour une date civile `AAAA-MM-JJ` qui existe au calendrier grégorien. */
export function isAssetCalendarDay(value: string): boolean {
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

/** Date civile au jour de Kinshasa (ADR-0027). */
export const AssetCalendarDay = z
  .string(assetFr('Date attendue au format AAAA-MM-JJ.'))
  .refine(isAssetCalendarDay, {
    message: 'Date attendue au format AAAA-MM-JJ.',
    params: { code: 'INVALID_DATE' },
  });

const AMOUNT = /^(\d{1,13})(?:\.(\d+))?$/;

/** Forme canonique d'un montant positif ou nul, deux décimales au plus, ou `null`. */
export function canonicalAssetAmount(raw: string): string | null {
  const m = AMOUNT.exec(raw);
  if (m === null) return null;
  const fraction = m[2] ?? '';
  if (fraction.length > ASSET_LIMITS.amountDecimals) return null;
  const integer = m[1]!.replace(/^0+(?=\d)/, '');
  return `${integer}.${fraction.padEnd(2, '0')}`;
}

/** Montant positif ou nul en chaîne (`"1200.00"`), jamais un `number` JSON. */
export const AssetAmount = z.unknown().transform((raw, ctx): string => {
  if (typeof raw === 'number') {
    assetIssue(
      ctx,
      'DECIMAL_MUST_BE_STRING',
      'Montant attendu sous forme de chaîne (par exemple "12.50"), jamais de nombre.',
    );
    return z.NEVER;
  }
  if (typeof raw !== 'string') {
    assetIssue(ctx, 'FIELD_REQUIRED', 'Montant obligatoire.');
    return z.NEVER;
  }
  const canonical = canonicalAssetAmount(raw.trim());
  if (canonical === null) {
    assetIssue(
      ctx,
      'INVALID_AMOUNT',
      'Montant invalide : chiffres et point décimal, deux décimales au plus.',
    );
    return z.NEVER;
  }
  return canonical;
});

/** Texte obligatoire : espaces de bord retirés, 1 à `max` caractères. */
export function assetRequiredText(max: number, what: string) {
  return z
    .string(assetFr(`${what} : texte attendu.`))
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
export function assetOptionalText(max: number) {
  return z
    .string(assetFr('Texte attendu.'))
    .trim()
    .refine((v) => v.length <= max, {
      message: `${max} caractères au plus.`,
      params: { code: 'TEXT_TOO_LONG' },
    })
    .transform((v) => (v === '' ? null : v))
    .nullable();
}

/** Délai de rappel en jours (0 à 365). */
export const AssetReminderDays = z
  .number(assetFr('Nombre de jours attendu.'))
  .int({ message: 'Nombre de jours entier attendu.' })
  .min(0)
  .max(ASSET_LIMITS.reminderDaysMax);

/** Bénéficiaire d'une affectation (§ 3.2) : un collaborateur, un projet, un emplacement, un membre. */
export const AssetAssigneeSchema = z.discriminatedUnion(
  'kind',
  [
    z.object({ kind: z.literal('employee'), employeeId: AssetId }).strict(),
    z.object({ kind: z.literal('project'), workProjectId: AssetId }).strict(),
    z.object({ kind: z.literal('location'), locationId: AssetId }).strict(),
    z.object({ kind: z.literal('member'), userId: z.string().min(1).max(64) }).strict(),
  ],
  assetFr('Bénéficiaire attendu : employee, project, location ou member.'),
);
export type AssetAssigneeInput = z.output<typeof AssetAssigneeSchema>;

/**
 * Paramètres de l'ESTIMATION DE GESTION (§ 3.1, O7) : durée de 1 à 50 ans, valeur
 * résiduelle, mois de départ. Aucune valeur par défaut : sans ces paramètres, aucune
 * estimation n'est calculée.
 */
export const AssetManagementDepreciationSchema = z
  .object({
    years: z
      .number(assetFr('Durée en années attendue.'))
      .int({ message: 'Durée entière attendue.' })
      .min(ASSET_LIMITS.depreciationYearsMin)
      .max(ASSET_LIMITS.depreciationYearsMax),
    residualValue: AssetAmount,
    startOn: AssetCalendarDay,
  })
  .strict();
export type AssetManagementDepreciationInput = z.output<typeof AssetManagementDepreciationSchema>;

/** Récurrence d'une maintenance préventive : tous les 1 à 60 mois (§ 3.3). */
export const AssetMaintenanceRecurrenceSchema = z
  .object({
    everyMonths: z
      .number(assetFr('Nombre de mois attendu.'))
      .int({ message: 'Nombre de mois entier attendu.' })
      .min(ASSET_LIMITS.maintenanceEveryMonthsMin)
      .max(ASSET_LIMITS.maintenanceEveryMonthsMax),
  })
  .strict();
