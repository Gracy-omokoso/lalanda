// Schéma d'un pack de plan comptable — ADR-0049 § 2.1 (lot K1).
//
// Le pack est une DONNÉE (YAML versionné), seule origine des numéros de compte :
// aucun numéro n'est créé par le code. Ce schéma vérifie la forme ; la cohérence
// (références croisées, cycle de version, exigences du statut `approved`) est
// vérifiée par `validateChartPack` (validate.ts).

import { z } from 'zod';

/** Mention exigée sur tout élément `to_confirm` (ADR-0049 § 2.1.1). */
export const TO_CONFIRM_MENTION = "à confirmer par l'expert-comptable";

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date attendue au format AAAA-MM-JJ');

const SlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, 'slug invalide (attendu : ^[a-z][a-z0-9-]*$)');

const IdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/, 'identifiant invalide (attendu : ^[a-z][a-z0-9_-]*$)');

/** Numéro de compte : chaîne de chiffres, jamais un nombre (les zéros comptent). */
const AccountNumberSchema = z.string().regex(/^\d{1,12}$/, 'numéro de compte : chiffres seulement');

/** Cycle de docs/09 § Modèle de version. */
export const CHART_PACK_STATUSES = ['draft', 'review', 'approved', 'active', 'retired'] as const;
export type ChartPackStatus = (typeof CHART_PACK_STATUSES)[number];

/** Même énumération que `systeme_comptable` des packs pays (parameter-packs/schema.ts). */
export const CHART_FRAMEWORKS = ['syscohada-revise-2017'] as const;

export const CONFIRMATIONS = ['sourced', 'to_confirm'] as const;
export type Confirmation = (typeof CONFIRMATIONS)[number];

export const ACCOUNT_NATURES = [
  'asset',
  'liability',
  'equity',
  'expense',
  'income',
  'off_balance',
  'mixed',
] as const;

/** Jetons résolus à l'exécution dans une règle (ADR-0049 § 2.4). */
export const RULE_TOKENS = ['{customer}', '{supplier}', '{treasuryAccount}'] as const;

const SourceSchema = z
  .object({
    id: IdSchema,
    issuer: z.string().min(1),
    title: z.string().min(1),
    reference: z.string().min(1).nullable(),
    adoptedOn: IsoDateSchema.nullable(),
    publishedOn: IsoDateSchema.nullable(),
    effectiveFrom: IsoDateSchema.nullable(),
    url: z.url().nullable(),
    verifiedOn: IsoDateSchema.nullable(),
    verifiedBy: z.string().min(1).nullable(),
    note: z.string().min(1).optional(),
  })
  .strict();

const ClassSchema = z
  .object({
    number: z.string().regex(/^[1-9]$/, 'classe : un chiffre de 1 à 9'),
    label: z.string().min(1),
    sourceId: IdSchema.nullable(),
    confirmation: z.enum(CONFIRMATIONS),
    note: z.string().min(1).optional(),
  })
  .strict();

const AccountSchema = z
  .object({
    number: AccountNumberSchema,
    label: z.string().min(1),
    classNumber: z.string().regex(/^[1-9]$/),
    parent: AccountNumberSchema.nullable(),
    /** Nul tant que l'expert ne l'a pas fournie ; exigée pour `approved`. */
    nature: z.enum(ACCOUNT_NATURES).nullable(),
    collective: z.boolean(),
    auxiliaryKind: z.enum(['customer', 'supplier']).nullable(),
    sourceId: IdSchema.nullable(),
    confirmation: z.enum(CONFIRMATIONS),
    note: z.string().min(1).optional(),
  })
  .strict();

/** Compte que l'ADR dit « à fournir par l'expert » : aucun numéro, seulement le besoin. */
const ExpectedAccountSchema = z
  .object({
    id: IdSchema,
    need: z.string().min(1),
    classHint: z
      .string()
      .regex(/^\d+(-\d+)?$/)
      .nullable(),
    hint: z.string().min(1),
    questions: z.array(z.string().regex(/^[EJ]\d+(\.\d+)?$/)).min(1),
  })
  .strict();

const RubricSchema = z
  .object({
    code: IdSchema,
    label: z.string().min(1),
    accountPrefixes: z.array(AccountNumberSchema).min(1),
    confirmation: z.enum(CONFIRMATIONS),
    sourceId: IdSchema.nullable(),
    note: z.string().min(1).optional(),
  })
  .strict();

const TemplateSchema = z.array(RubricSchema).min(1).nullable();

const AccountRefSchema = z.union([AccountNumberSchema, z.enum(RULE_TOKENS)]);

const ProposedRuleSchema = z
  .object({
    // Lettres capitales admises : groupes de taxation (`…vat.B`) et moyens de règlement
    // (`receipt.VIREMENT`) du catalogue des clés (rules/operation-keys.ts).
    key: z.string().regex(/^[a-z_]+(\.[A-Za-z0-9_<>|]+)+$/, "clé d'opération invalide"),
    debit: z.array(AccountRefSchema),
    credit: z.array(AccountRefSchema),
    requiresReview: z.boolean(),
    confirmation: z.enum(CONFIRMATIONS),
    sourceId: IdSchema.nullable(),
    note: z.string().min(1).optional(),
  })
  .strict();

const ReviewSchema = z
  .object({
    reviewerName: z.string().min(1),
    reviewerCapacity: z.string().min(1),
    reviewedOn: IsoDateSchema,
    scope: z.string().min(1),
    reportDocumentKey: z.string().min(1),
  })
  .strict();

export const ChartPackSchema = z
  .object({
    schemaVersion: z.literal(1),
    slug: SlugSchema,
    version: z.number().int().min(1),
    framework: z.enum(CHART_FRAMEWORKS),
    countries: z.array(z.string().regex(/^[A-Z]{2}$/, 'code pays ISO-2')).min(1),
    status: z.enum(CHART_PACK_STATUSES),
    label: z.string().min(1),
    sources: z.array(SourceSchema).min(1),
    classes: z.array(ClassSchema).min(1),
    accounts: z.array(AccountSchema),
    expectedAccounts: z.array(ExpectedAccountSchema),
    statementTemplates: z
      .object({
        balanceSheet: TemplateSchema,
        incomeStatement: TemplateSchema,
        cashFlow: TemplateSchema,
      })
      .strict(),
    proposedRules: z.array(ProposedRuleSchema),
    /**
     * Compte d'attente désigné par le pack (§ 6.0), qui remplace le compte technique
     * `ATTENTE` quand le pack est relu (`approved` ou `active`). Absent ou nul : aucun
     * compte désigné (pack v1). Amendement du 3 nov. 2026 (pack v2).
     */
    suspenseAccount: AccountNumberSchema.nullable().optional(),
    review: ReviewSchema.nullable(),
    warnings: z.array(z.string().min(1)),
  })
  .strict();

export type ChartPack = z.infer<typeof ChartPackSchema>;
export type ChartPackSource = ChartPack['sources'][number];
export type ChartPackClass = ChartPack['classes'][number];
export type ChartPackAccount = ChartPack['accounts'][number];
export type ChartPackExpectedAccount = ChartPack['expectedAccounts'][number];
export type ChartPackRule = ChartPack['proposedRules'][number];
