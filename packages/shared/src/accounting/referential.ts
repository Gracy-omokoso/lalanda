// Contrats du référentiel et des réglages de la comptabilité (ADR-0049 §§ 2.1 à 2.5, 2.7,
// 3.1, 11). ADR-0049 — K4.
//
// Réglages, activation, packs de plan comptable (lecture organisation, chargement et cycle
// de version côté plateforme), plan de l'organisation, règles de correspondance, journaux,
// taux saisis, exercices et périodes (STRUCTURE seulement : les clôtures relèvent de K6).
//
// AUCUN numéro de compte, AUCUNE règle comptable ici : les comptes viennent du pack YAML
// et des règles validées par l'organisation ; un taux est toujours SAISI (jamais implicite).

import { z } from 'zod';

import {
  ACCOUNTING_CHART_PACK_STATUSES,
  ACCOUNTING_LIMITS,
  ACCOUNTING_MODES,
  ACCOUNTING_STOCK_POSTING_MODES,
  type AccountingAccountNature,
  type AccountingAccountOrigin,
  type AccountingActivationMissingCode,
  type AccountingAuxiliaryKind,
  type AccountingBookCurrency,
  type AccountingChartPackStatus,
  type AccountingConfirmation,
  type AccountingFiscalYearStatus,
  type AccountingJournalKind,
  type AccountingMode,
  type AccountingPeriodStatus,
  type AccountingRuleSetStatus,
  type AccountingStockPostingMode,
} from './constants.js';
import {
  AccountingAccountNumber,
  AccountingCalendarDay,
  AccountingCurrencySchema,
  AccountingExpectedRevision,
  AccountingFiscalYearStartMonth,
  AccountingJournalCode,
  AccountingRate,
  accountingFr,
  accountingIssue,
  accountingOptionalText,
  accountingRequiredText,
} from './common.js';

// ── Réglages (§ 2.2, § 3.1) ─────────────────────────────────────────────────

/** Référence d'un pack : `slug` + `version` (unique, § 2.1). */
export const AccountingChartPackRefSchema = z
  .object({
    slug: z
      .string(accountingFr('Identifiant de pack attendu.'))
      .regex(/^[a-z][a-z0-9-]{0,63}$/, { message: 'Identifiant de pack invalide.' }),
    version: z
      .number(accountingFr('Version de pack : un entier.'))
      .int({ message: 'Version de pack : un entier.' })
      .min(1),
  })
  .strict();
export type AccountingChartPackRef = z.output<typeof AccountingChartPackRefSchema>;

/**
 * `PUT /accounting/settings`. Le mode `active` ne se pose JAMAIS ici : il passe par
 * `POST /accounting/activate`, qui vérifie toutes les conditions (§ 3.1).
 */
export const UpdateAccountingSettingsBody = z
  .object({
    expectedRevision: AccountingExpectedRevision,
    mode: z
      .enum(ACCOUNTING_MODES, accountingFr('Mode attendu : off ou simulation.'))
      .superRefine((v, ctx) => {
        if (v === 'active') {
          accountingIssue(
            ctx,
            'ACTIVATION_ROUTE_REQUIRED',
            'Le mode actif s’obtient par l’activation, qui vérifie chaque condition.',
          );
        }
      })
      .optional(),
    chartPack: AccountingChartPackRefSchema.nullable().optional(),
    bookCurrency: AccountingCurrencySchema.nullable().optional(),
    cutoverDate: AccountingCalendarDay.nullable().optional(),
    fiscalYearStartMonth: AccountingFiscalYearStartMonth.optional(),
    stockPosting: z
      .enum(ACCOUNTING_STOCK_POSTING_MODES, accountingFr('Option attendue : off ou perpetual.'))
      .optional(),
    depreciationPosting: z
      .literal('off', accountingFr('Amortissements : seule la valeur off est admise.'))
      .optional(),
  })
  .strict();
export type UpdateAccountingSettingsBody = z.output<typeof UpdateAccountingSettingsBody>;

/** `POST /accounting/activate` et `POST /accounting/deactivate`. */
export const AccountingActivationBody = z
  .object({ expectedRevision: AccountingExpectedRevision })
  .strict();
export type AccountingActivationBody = z.output<typeof AccountingActivationBody>;

export interface AccountingChartPackSummaryRef {
  slug: string;
  version: number;
  label: string;
  status: AccountingChartPackStatus;
  warnings: string[];
}

export interface AccountingSettingsView {
  mode: AccountingMode;
  /** Bandeau du mode (§ 3.1), `null` en mode `off`. */
  banner: string | null;
  /** Pack choisi, `null` si aucun ; son statut décide de l'activation (n° 5). */
  chartPack: AccountingChartPackSummaryRef | null;
  bookCurrency: AccountingBookCurrency | null;
  cutoverDate: string | null;
  fiscalYearStartMonth: number;
  stockPosting: AccountingStockPostingMode;
  depreciationPosting: 'off';
  /** Version validée en vigueur des règles de correspondance (§ 2.4). */
  ruleSetVersion: number | null;
  activatedAt: string | null;
  activatedBy: string | null;
  /** Conditions manquantes de l'activation, calculées par le serveur (§ 3.1). */
  activation: { possible: boolean; missing: AccountingActivationMissingCode[] };
  /** Champs verrouillés (première écriture validée, premier exercice créé). */
  locks: { bookCurrency: boolean; cutoverDate: boolean; fiscalYearStartMonth: boolean };
  revision: number;
  updatedAt: string;
}

// ── Packs de plan comptable (§ 2.1) ─────────────────────────────────────────

export interface AccountingChartPackSummary {
  slug: string;
  version: number;
  framework: string;
  countries: string[];
  label: string;
  status: AccountingChartPackStatus;
  /** Le mode `active` est possible avec ce pack (`approved` ou `active`, n° 5). */
  activatable: boolean;
  warnings: string[];
  /** Empreinte SHA-256 du contenu lu (`chartPackFingerprint`). */
  fingerprint: string;
  counts: {
    classes: number;
    accounts: number;
    toConfirm: number;
    expectedAccounts: number;
    proposedRules: number;
  };
  loadedAt: string;
  revision: number;
}

export interface AccountingChartPackHistoryEvent {
  action: 'loaded' | 'reloaded' | 'transition';
  from: AccountingChartPackStatus | null;
  to: AccountingChartPackStatus;
  by: string;
  at: string;
}

/** Détail d'un pack : contenu du YAML tel que lu, statut de la plateforme. */
export interface AccountingChartPackDetail extends AccountingChartPackSummary {
  sources: Record<string, unknown>[];
  classes: {
    number: string;
    label: string;
    sourceId: string | null;
    confirmation: AccountingConfirmation;
    mention: string | null;
  }[];
  accounts: {
    number: string;
    label: string;
    classNumber: string;
    parent: string | null;
    nature: AccountingAccountNature | null;
    collective: boolean;
    auxiliaryKind: AccountingAuxiliaryKind | null;
    sourceId: string | null;
    confirmation: AccountingConfirmation;
    mention: string | null;
  }[];
  expectedAccounts: Record<string, unknown>[];
  statementTemplates: Record<string, unknown>;
  proposedRules: Record<string, unknown>[];
  review: Record<string, unknown> | null;
  history: AccountingChartPackHistoryEvent[];
}

/** Plateforme : charge un pack livré avec le moteur (`accounting/packs/<slug>-v<version>.yaml`). */
export const LoadAccountingChartPackBody = AccountingChartPackRefSchema;
export type LoadAccountingChartPackBody = AccountingChartPackRef;

/** Plateforme : cycle de docs/09 (`draft → review → approved → active → retired`). */
export const TransitionAccountingChartPackBody = z
  .object({
    to: z.enum(
      ACCOUNTING_CHART_PACK_STATUSES,
      accountingFr('Statut attendu : draft, review, approved, active ou retired.'),
    ),
    expectedRevision: AccountingExpectedRevision,
  })
  .strict();
export type TransitionAccountingChartPackBody = z.output<typeof TransitionAccountingChartPackBody>;

// ── Plan de l'organisation (§ 2.3) ──────────────────────────────────────────

export interface AccountingAccountView {
  number: string;
  /** Libellé affiché : précision de l'organisation, sinon libellé du pack. */
  label: string;
  /** Libellé du pack, toujours affiché pour un compte du pack (jamais remplacé). */
  packLabel: string | null;
  origin: AccountingAccountOrigin;
  classNumber: string;
  /** Compte du pack que prolonge un compte propre ; parent du pack sinon. */
  parent: string | null;
  nature: AccountingAccountNature | null;
  /** Statut du compte du pack (un compte propre hérite de son compte du pack). */
  confirmation: AccountingConfirmation;
  /** « À confirmer par l'expert-comptable » quand `confirmation = to_confirm`. */
  mention: string | null;
  collective: boolean;
  auxiliaryKind: AccountingAuxiliaryKind | null;
  active: boolean;
  /** `null` : compte du pack jamais précisé ni archivé par l'organisation. */
  revision: number | null;
}

/** `POST /accounting/accounts` : un compte propre prolonge un compte du pack (§ 2.3). */
export const CreateAccountingAccountBody = z
  .object({
    number: AccountingAccountNumber,
    label: accountingRequiredText(ACCOUNTING_LIMITS.accountLabel, 'Libellé'),
  })
  .strict();
export type CreateAccountingAccountBody = z.output<typeof CreateAccountingAccountBody>;

/** Révision attendue, `null` pour un compte du pack encore jamais modifié. */
const AccountRevision = AccountingExpectedRevision.nullable();

/** `PUT /accounting/accounts/:number` : libellé (précision pour un compte du pack). */
export const UpdateAccountingAccountBody = z
  .object({
    expectedRevision: AccountRevision,
    label: accountingRequiredText(ACCOUNTING_LIMITS.accountLabel, 'Libellé'),
  })
  .strict();
export type UpdateAccountingAccountBody = z.output<typeof UpdateAccountingAccountBody>;

/** `POST /accounting/accounts/:number/archive` (ou désarchivage, `active: true`). */
export const ArchiveAccountingAccountBody = z
  .object({ expectedRevision: AccountRevision, active: z.boolean().optional() })
  .strict();
export type ArchiveAccountingAccountBody = z.output<typeof ArchiveAccountingAccountBody>;

// ── Règles de correspondance (§ 2.4) ────────────────────────────────────────

const RuleAccountRef = z
  .string(accountingFr('Compte attendu : numéro ou jeton.'))
  .trim()
  .min(1)
  .max(40);

export const AccountingRuleInputSchema = z
  .object({
    key: z.string(accountingFr('Clé d’opération attendue.')).trim().min(1).max(120),
    debit: z.array(RuleAccountRef).max(5),
    credit: z.array(RuleAccountRef).max(5),
    requiresReview: z.boolean(accountingFr('requiresReview : vrai ou faux.')),
  })
  .strict();
export type AccountingRuleInput = z.output<typeof AccountingRuleInputSchema>;

/** `POST /accounting/rule-sets` : brouillon né des règles proposées du pack (ou de la version validée). */
export const CreateAccountingRuleSetBody = z.object({}).strict();

/** `PUT /accounting/rule-sets/:version` : remplace les règles d'un brouillon. */
export const UpdateAccountingRuleSetBody = z
  .object({
    expectedRevision: AccountingExpectedRevision,
    rules: z.array(AccountingRuleInputSchema).max(500),
  })
  .strict();
export type UpdateAccountingRuleSetBody = z.output<typeof UpdateAccountingRuleSetBody>;

/**
 * `POST /accounting/rule-sets/:version/validate`. La case « relu par notre
 * expert-comptable » (nom, date) est exigée (décision ouverte n° 6) : c'est une
 * DÉCLARATION de l'organisation, que Lalanda ne vérifie pas.
 */
export const ValidateAccountingRuleSetBody = z
  .object({
    expectedRevision: AccountingExpectedRevision,
    expertReview: z
      .object({
        declared: z.boolean(accountingFr('declared : vrai ou faux.')),
        name: accountingOptionalText(120).optional(),
        date: AccountingCalendarDay.nullable().optional(),
        note: accountingOptionalText(ACCOUNTING_LIMITS.reason).optional(),
      })
      .strict(),
  })
  .strict();
export type ValidateAccountingRuleSetBody = z.output<typeof ValidateAccountingRuleSetBody>;

export interface AccountingRuleSetView {
  version: number;
  status: AccountingRuleSetStatus;
  rules: AccountingRuleInput[];
  basedOn: { packSlug: string; packVersion: number } | null;
  validation: {
    by: string;
    at: string;
    soleApprover: boolean;
    expertReview: {
      declared: boolean;
      name: string | null;
      date: string | null;
      note: string | null;
    };
  } | null;
  revision: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

// ── Journaux (§ 2.5) ────────────────────────────────────────────────────────

export interface AccountingJournalView {
  code: string;
  label: string;
  kind: AccountingJournalKind;
  treasuryAccountId: string | null;
  active: boolean;
  revision: number;
}

/**
 * `POST /accounting/journals`. Les journaux de trésorerie naissent des comptes de
 * trésorerie (un par compte, § 2.5), jamais à la main.
 */
export const CreateAccountingJournalBody = z
  .object({
    code: AccountingJournalCode,
    label: accountingRequiredText(ACCOUNTING_LIMITS.journalLabel, 'Libellé'),
    kind: z.enum(
      ['sales', 'purchases', 'misc', 'opening'],
      accountingFr('Nature attendue : sales, purchases, misc ou opening.'),
    ),
  })
  .strict();
export type CreateAccountingJournalBody = z.output<typeof CreateAccountingJournalBody>;

/** `PUT /accounting/journals/:code` : le code ne change pas (numérotation par journal). */
export const UpdateAccountingJournalBody = z
  .object({
    expectedRevision: AccountingExpectedRevision,
    label: accountingRequiredText(ACCOUNTING_LIMITS.journalLabel, 'Libellé').optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateAccountingJournalBody = z.output<typeof UpdateAccountingJournalBody>;

// ── Taux saisis (§ 2.7, § 5) ────────────────────────────────────────────────

/**
 * `PUT /accounting/exchange-rates/:date/:from/:to` : 1 `from` = `rate` `to`, à la date.
 * Saisi par un humain, source déclarée ; jamais importé d'office ni déduit.
 */
export const PutAccountingExchangeRateBody = z
  .object({
    rate: AccountingRate,
    sourceText: accountingRequiredText(ACCOUNTING_LIMITS.rateSourceText, 'Source du taux'),
    /** `null` : création ; sinon révision du taux déjà saisi. */
    expectedRevision: AccountingExpectedRevision.nullable(),
  })
  .strict();
export type PutAccountingExchangeRateBody = z.output<typeof PutAccountingExchangeRateBody>;

export interface AccountingExchangeRateView {
  date: string;
  from: AccountingBookCurrency;
  to: AccountingBookCurrency;
  rate: string;
  sourceText: string;
  enteredBy: string;
  revision: number;
  updatedAt: string;
}

// ── Exercices et périodes (§ 2.7) — structure ───────────────────────────────

/** `POST /accounting/fiscal-years` : exercice de douze mois à partir du mois de début. */
export const CreateAccountingFiscalYearBody = z
  .object({
    year: z
      .number(accountingFr('Année attendue : un entier.'))
      .int({ message: 'Année attendue : un entier.' })
      .min(2000)
      .max(2999),
  })
  .strict();
export type CreateAccountingFiscalYearBody = z.output<typeof CreateAccountingFiscalYearBody>;

export interface AccountingPeriodView {
  year: number;
  month: number;
  start: string;
  end: string;
  status: AccountingPeriodStatus;
}

export interface AccountingFiscalYearView {
  year: number;
  start: string;
  end: string;
  status: AccountingFiscalYearStatus;
  periods: AccountingPeriodView[];
  revision: number;
}
