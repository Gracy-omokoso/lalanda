// Contrats de la restitution, des clôtures et des exports (ADR-0049 §§ 4, 6.10, 6.11, 7,
// 9, 10, 11). ADR-0049 — K6.
//
// Grand livre, balances, auxiliaires, projets d'états (toujours `draft_unverified`, bandeau
// et réserves), clôtures et réouvertures de mois et d'exercice, rapprochement avec le
// réalisé (AFFICHÉ, jamais corrigé), exports pour l'expert-comptable.
//
// AUCUN numéro de compte, AUCUN calcul ici : les montants sont des CHAÎNES décimales
// rendues par le moteur (`@lalanda/engine`, module `accounting`, lot K3). Critères des
// livres en corps `POST` (§ 11) : aucune donnée comptable dans l'URL au-delà des
// identifiants et des périodes.

import { z } from 'zod';

import {
  ACCOUNTING_AUXILIARY_KINDS,
  ACCOUNTING_LIMITS,
  type AccountingAuxiliaryKind,
  type AccountingBookCurrency,
  type AccountingConfirmation,
  type AccountingMode,
  type AccountingReconciliationCause,
  type AccountingStatementKind,
  type AccountingStatementStatus,
} from './constants.js';
import {
  AccountingAccountNumber,
  AccountingCalendarDay,
  accountingFr,
  accountingIssue,
} from './common.js';
import type { AccountingFiscalYearView } from './referential.js';

// ── Codes d'erreur propres au lot ───────────────────────────────────────────

export const ACCOUNTING_REPORTING_ERROR_CODES = [
  'ACCOUNTING_OFF',
  'ACCOUNTING_NOT_ACTIVE',
  'ACCOUNTING_SETTINGS_INCOMPLETE',
  'STATEMENT_NOT_AVAILABLE',
  'PERIOD_NOT_FOUND',
  'PERIOD_ALREADY_CLOSED',
  'PERIOD_NOT_CLOSED',
  'PERIOD_HAS_DRAFTS',
  'FISCAL_YEAR_NOT_FOUND',
  'FISCAL_YEAR_CLOSED',
  'FISCAL_YEAR_NOT_CLOSED',
  'FISCAL_YEAR_NOT_CLOSABLE',
  'FISCAL_YEAR_BUSY',
  'REOPEN_OWNER_ONLY',
  'REOPEN_REASON_REQUIRED',
  'ACCOUNTING_EXPORT_FORMAT_UNSUPPORTED',
  'ACCOUNTING_EXPORT_NOT_FOUND',
  'ACCOUNTING_EXPORT_EXPIRED',
  'ACCOUNTING_EXPORT_RATE_LIMITED',
] as const;
export type AccountingReportingErrorCode = (typeof ACCOUNTING_REPORTING_ERROR_CODES)[number];

// ── Enveloppe commune ───────────────────────────────────────────────────────

/** Réserve (§ 6.10) : code stable, phrase prête à afficher et à imprimer, détails. */
export interface AccountingReserveView {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

/** Ce que porte chaque restitution : mode, bandeau, réserves (jamais masquées). */
export interface AccountingReportEnvelope {
  mode: Exclude<AccountingMode, 'off'>;
  simulation: boolean;
  /** « Projet — à valider par un expert-comptable » ou bandeau de simulation. */
  banner: string;
  bookCurrency: AccountingBookCurrency;
  from: string;
  to: string;
  reserves: AccountingReserveView[];
}

// ── Critères des livres (§ 11 : en corps) ───────────────────────────────────

const AuxiliaryKindSchema = z.enum(
  ACCOUNTING_AUXILIARY_KINDS,
  accountingFr('Nature attendue : customer ou supplier.'),
);

/** Corps de `POST /accounting/ledger`, `/trial-balance`, `/auxiliary-balance`. */
export const AccountingPeriodCriteriaBody = z
  .object({
    from: AccountingCalendarDay,
    to: AccountingCalendarDay,
    /** Grand livre : restreint aux comptes qui commencent par ce numéro. */
    accountNumber: AccountingAccountNumber.optional(),
    /** Grand livre : `general` (défaut) ou `auxiliary` (un compte par client ou fournisseur). */
    level: z.enum(['general', 'auxiliary'], accountingFr('Niveau inconnu.')).optional(),
    /** Balance auxiliaire : clients ou fournisseurs (défaut : les deux). */
    auxiliaryKind: AuxiliaryKindSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.from > v.to) {
      accountingIssue(ctx, 'INVALID_RANGE', 'La date de début dépasse la date de fin.', ['from']);
    }
  });
export type AccountingPeriodCriteriaBody = z.output<typeof AccountingPeriodCriteriaBody>;
export type AccountingPeriodCriteria = z.input<typeof AccountingPeriodCriteriaBody>;

/** Écritures écartées des livres : brouillons, en attente de taux, postérieures. */
export interface AccountingExcludedCounts {
  draft: number;
  awaitingRate: number;
  afterPeriod: number;
}

// ── Grand livre ─────────────────────────────────────────────────────────────

export interface AccountingLedgerLineView {
  ref: string;
  entryId: string;
  journalCode: string;
  fiscalYear: number | null;
  number: number | null;
  date: string;
  label: string;
  auxiliaryAccountNumber: string | null;
  debit: string;
  credit: string;
  /** Solde progressif en monnaie de tenue (débit − crédit). */
  balance: string;
  /** Devise de la pièce et montant signé dans cette devise (positif au débit). */
  currency: AccountingBookCurrency;
  amount: string;
  letteringCode: string | null;
  sourceKind: string | null;
  sourceId: string | null;
  sourceNumber: string | null;
}

export interface AccountingLedgerAccountView {
  accountNumber: string;
  generalAccountNumber: string;
  label: string | null;
  classNumber: string | null;
  confirmation: AccountingConfirmation;
  openingBalance: string;
  totalDebit: string;
  totalCredit: string;
  closingBalance: string;
  lines: AccountingLedgerLineView[];
  /** Mouvements par devise de la pièce — jamais additionnés entre devises. */
  byCurrency: {
    currency: AccountingBookCurrency;
    debit: string;
    credit: string;
    balance: string;
  }[];
}

export interface AccountingLedgerView extends AccountingReportEnvelope {
  level: 'general' | 'auxiliary';
  accounts: AccountingLedgerAccountView[];
  excluded: AccountingExcludedCounts;
}

// ── Balance générale ────────────────────────────────────────────────────────

export interface AccountingTrialBalanceTotals {
  openingDebit: string;
  openingCredit: string;
  periodDebit: string;
  periodCredit: string;
  closingDebit: string;
  closingCredit: string;
}

export interface AccountingTrialBalanceRowView extends AccountingTrialBalanceTotals {
  accountNumber: string;
  label: string | null;
  classNumber: string | null;
  confirmation: AccountingConfirmation;
  /** Solde de clôture signé (débit − crédit). */
  closingBalance: string;
}

export interface AccountingTrialBalanceView extends AccountingReportEnvelope {
  rows: AccountingTrialBalanceRowView[];
  classes: {
    classNumber: string | null;
    classLabel: string | null;
    confirmation: AccountingConfirmation;
    accountCount: number;
    totals: AccountingTrialBalanceTotals;
  }[];
  totals: AccountingTrialBalanceTotals;
  /** Contrôle du moteur : débits = crédits (ouverture, période, clôture). */
  balanced: boolean;
  unbalancedEntries: { entryId: string; difference: string }[];
  excluded: AccountingExcludedCounts;
}

// ── Balances auxiliaires ────────────────────────────────────────────────────

export interface AccountingAuxiliaryRowView {
  auxiliaryAccountNumber: string;
  collectiveAccountNumber: string;
  /** Libellé du compte auxiliaire (fiche client ou fournisseur), sinon nom de la pièce. */
  label: string | null;
  openingBalance: string;
  periodDebit: string;
  periodCredit: string;
  closingBalance: string;
  byCurrency: { currency: AccountingBookCurrency; balance: string }[];
  unletteredLineCount: number;
}

export interface AccountingAuxiliaryGroupView {
  collectiveAccountNumber: string;
  auxiliaryKind: AccountingAuxiliaryKind | null;
  rows: AccountingAuxiliaryRowView[];
  closingBalance: string;
  /** Solde du collectif porté sans compte auxiliaire : signalé, jamais réparti. */
  withoutAuxiliaryBalance: string;
}

export interface AccountingAuxiliaryBalanceView extends AccountingReportEnvelope {
  auxiliaryKind: AccountingAuxiliaryKind | null;
  groups: AccountingAuxiliaryGroupView[];
  conflicts: { auxiliaryAccountNumber: string; collectiveAccountNumbers: string[] }[];
}

// ── Projets d'états (§ 10) ──────────────────────────────────────────────────

/** Requête `GET /accounting/statements/:kind?year=&month=` (exercice, mois facultatif). */
export const AccountingStatementQuery = z
  .object({
    year: z
      .string(accountingFr('Exercice attendu.'))
      .regex(/^2\d{3}$/, { message: 'Exercice attendu sur quatre chiffres.' })
      .transform((v) => Number(v)),
    month: z
      .string(accountingFr('Mois attendu.'))
      .regex(/^(?:[1-9]|0[1-9]|1[0-2])$/, { message: 'Mois attendu entre 1 et 12.' })
      .transform((v) => Number(v))
      .optional(),
  })
  .strict();
export type AccountingStatementQuery = z.output<typeof AccountingStatementQuery>;

export interface AccountingStatementRubricView {
  code: string;
  label: string;
  confirmation: AccountingConfirmation;
  toConfirm: boolean;
  note: string | null;
  amount: string;
  accounts: { accountNumber: string; amount: string }[];
}

export interface AccountingStatementSectionView {
  code: string;
  label: string;
  confirmation: AccountingConfirmation;
  toConfirm: boolean;
  total: string;
  rubrics: AccountingStatementRubricView[];
}

/** Projet d'état : `status: "draft_unverified"`, `disclaimer` et réserves, TOUJOURS. */
export interface AccountingStatementView extends AccountingReportEnvelope {
  status: AccountingStatementStatus;
  disclaimer: string;
  kind: AccountingStatementKind;
  label: string;
  fiscalYear: number;
  available: boolean;
  unavailableReason: 'STATEMENT_NOT_AVAILABLE' | null;
  sections: AccountingStatementSectionView[];
  matchedNetBalance: string;
  /** Compte de résultat seulement (crédit − débit des comptes repris) ; `null` sinon. */
  result: string | null;
  unmappedAccounts: { accountNumber: string; closingBalance: string }[];
}

// ── Clôtures (§ 4) ──────────────────────────────────────────────────────────

/**
 * Corps d'une réouverture. Le motif est lu par `accountingReopenDecision` APRÈS le titre :
 * un non-propriétaire apprend qu'il ne peut pas (403), pas qu'il a oublié le motif.
 */
export const AccountingReopenBody = z
  .object({
    reason: z
      .string(accountingFr('Motif : texte attendu.'))
      .max(ACCOUNTING_LIMITS.reason, { message: `${ACCOUNTING_LIMITS.reason} caractères au plus.` })
      .optional(),
  })
  .strict();
export type AccountingReopenBody = z.output<typeof AccountingReopenBody>;

/** Corps de la clôture d'exercice : solde d'attente accepté explicitement, avec motif (§ 4). */
export const CloseAccountingFiscalYearBody = z
  .object({
    suspenseAcceptance: z
      .object({
        reason: z
          .string(accountingFr('Motif : texte attendu.'))
          .trim()
          .min(1, { message: 'Motif obligatoire.' })
          .max(ACCOUNTING_LIMITS.reason),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CloseAccountingFiscalYearBody = z.output<typeof CloseAccountingFiscalYearBody>;

/** Conditions manquantes d'une clôture d'exercice (`details.reasons[]`). */
export const ACCOUNTING_FISCAL_YEAR_CLOSE_REASONS = [
  'PERIODS_OPEN',
  'AWAITING_RATE',
  'SUSPENSE_NOT_ACCEPTED',
  'DRAFT_ENTRIES',
  'NEXT_PERIOD_CLOSED',
] as const;
export type AccountingFiscalYearCloseReason = (typeof ACCOUNTING_FISCAL_YEAR_CLOSE_REASONS)[number];

/** Réponse de la clôture d'exercice : l'exercice et les à-nouveaux générés par le moteur. */
export interface AccountingFiscalYearCloseView {
  fiscalYear: AccountingFiscalYearView;
  opening: {
    entryId: string | null;
    nextFiscalYear: number;
    date: string;
    lineCount: number;
    balanced: boolean;
    /** Résultat porté au compte désigné par le pack, à défaut au compte d'attente (E7). */
    result: { amount: string; accountNumber: string; treatment: string; note: string };
    warnings: { code: string; accountNumber: string | null }[];
  };
  suspenseAccepted: { reason: string; balance: string } | null;
}

// ── Rapprochement avec le réalisé (§ 7) ─────────────────────────────────────

/** Requête `GET /accounting/reconciliation/actuals?month=AAAA-MM`. */
export const AccountingReconciliationQuery = z
  .object({
    month: z
      .string(accountingFr('Mois attendu au format AAAA-MM.'))
      .regex(/^2\d{3}-(0[1-9]|1[0-2])$/, { message: 'Mois attendu au format AAAA-MM.' }),
  })
  .strict();
export type AccountingReconciliationQuery = z.output<typeof AccountingReconciliationQuery>;

export const ACCOUNTING_RECONCILIATION_UNAVAILABLE = [
  'NO_LINKED_PROJECT',
  'PROJECT_NOT_FOUND',
  'PROJECT_CURRENCY_NOT_SUPPORTED',
  'MONTH_OUTSIDE_EXERCISES',
] as const;
export type AccountingReconciliationUnavailable =
  (typeof ACCOUNTING_RECONCILIATION_UNAVAILABLE)[number];

export interface AccountingReconciliationMetricView {
  /** `revenue` ou `expense.<catégorie>`. */
  key: string;
  label: string;
  currency: AccountingBookCurrency;
  comparable: boolean;
  reason: 'NOT_REPORTED' | 'CURRENCY_NOT_CONVERTIBLE' | null;
  actual: string | null;
  actualSource: 'run.sales' | 'run.expenses' | 'manual' | null;
  accounting: string;
  /** Réalisé − comptabilité ; `null` si non comparable. */
  difference: string | null;
  causes: { cause: AccountingReconciliationCause; amount: string }[];
  otherCurrencies: { currency: AccountingBookCurrency; amount: string }[];
  /** Un écart `UNEXPLAINED` subsiste : une alerte, jamais une correction. */
  alert: boolean;
  /** Ligne du plan partagée par plusieurs catégories : réalisé non séparable par catégorie. */
  sharedLine: boolean;
}

export interface AccountingReconciliationView {
  month: string;
  /** Toujours vrai : rien n'est écrit, ni dans le réalisé, ni dans les livres. */
  displayOnly: true;
  available: boolean;
  unavailableReason: AccountingReconciliationUnavailable | null;
  project: { id: string; name: string; currency: string } | null;
  exercise: { year: number; month: number } | null;
  metrics: AccountingReconciliationMetricView[];
  alertCount: number;
  notes: string[];
}

// ── Exports (§ 9) ───────────────────────────────────────────────────────────

export const ACCOUNTING_EXPORT_KINDS = [
  'entries',
  'trial-balance',
  'auxiliary-balance',
  'ledger',
  'statements',
  'reserves',
] as const;
export type AccountingExportKind = (typeof ACCOUNTING_EXPORT_KINDS)[number];

export const ACCOUNTING_EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type AccountingExportFormat = (typeof ACCOUNTING_EXPORT_FORMATS)[number];

/**
 * Formats admis par contenu (§ 9, décision ouverte n° 14 : défaut de l'ADR, à remplacer
 * par le format de l'expert, E10). Le premier est le format proposé.
 */
export const ACCOUNTING_EXPORT_FORMATS_BY_KIND: Readonly<
  Record<AccountingExportKind, readonly AccountingExportFormat[]>
> = Object.freeze({
  entries: ['csv', 'xlsx'],
  'trial-balance': ['csv', 'xlsx'],
  'auxiliary-balance': ['csv', 'xlsx'],
  ledger: ['csv', 'xlsx'],
  statements: ['pdf', 'xlsx'],
  reserves: ['csv', 'pdf'],
});

export const CreateAccountingExportBody = z
  .object({
    kind: z.enum(ACCOUNTING_EXPORT_KINDS, accountingFr('Contenu d’export inconnu.')),
    format: z.enum(ACCOUNTING_EXPORT_FORMATS, accountingFr('Format attendu : csv, xlsx ou pdf.')),
    from: AccountingCalendarDay,
    to: AccountingCalendarDay,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.from > v.to) {
      accountingIssue(ctx, 'INVALID_RANGE', 'La date de début dépasse la date de fin.', ['from']);
    }
    if (!ACCOUNTING_EXPORT_FORMATS_BY_KIND[v.kind].includes(v.format)) {
      accountingIssue(
        ctx,
        'ACCOUNTING_EXPORT_FORMAT_UNSUPPORTED',
        'Ce format n’est pas proposé pour ce contenu.',
        ['format'],
      );
    }
  });
export type CreateAccountingExportBody = z.output<typeof CreateAccountingExportBody>;
export type CreateAccountingExportInput = z.input<typeof CreateAccountingExportBody>;

/** Ligne du journal des exports (`accounting_exports`). */
export interface AccountingExportView {
  id: string;
  kind: AccountingExportKind;
  format: AccountingExportFormat;
  from: string;
  to: string;
  simulation: boolean;
  fileName: string;
  /** Empreinte SHA-256 du fichier remis, enregistrée. */
  sha256: string;
  size: number;
  bookCurrency: AccountingBookCurrency;
  chartPack: { slug: string; version: number } | null;
  ruleSetVersions: number[];
  reserveCodes: string[];
  createdAt: string;
  createdBy: string;
  /** Fin de la conservation du fichier ; le journal, lui, reste. */
  expiresAt: string;
  fileAvailable: boolean;
}
