// Client de l'API de la comptabilité — ADR-0049 § 11 (préfixe `/accounting`), lot K8.
//
// Fichier voisin de `api.ts` (même `jsonRequest`, mêmes erreurs). AUCUN calcul ici :
// écritures, soldes, balances, projets d'états et réserves viennent de l'API, qui les
// tient du moteur (`@lalanda/engine`, module `accounting`), en chaînes décimales.
//
// Contrats : les unions fermées, les textes des bandeaux et les codes viennent de
// `@lalanda/shared/accounting` (lot K0). Les VUES de réponse ne sont pas encore publiées
// par les lots K4 à K7 : elles sont décrites ici d'après l'ADR (§ 2, § 6.10, § 6.11,
// § 10, § 11), au plus juste et en lecture seule, et seront remplacées par les types
// partagés quand ces lots les ajouteront à `@lalanda/shared/accounting`. Tant qu'une
// route n'existe pas, l'API répond 404 : les écrans affichent « bientôt disponible »,
// jamais une donnée inventée.
//
// Aucune donnée comptable dans l'URL au-delà des identifiants et des périodes (§ 11) :
// recherches, grand livre et balances passent en corps `POST`.

import type {
  AccountingActivationMissingCode,
  AccountingAuxiliaryKind,
  AccountingBookCurrency,
  AccountingChartPackStatus,
  AccountingConfirmation,
  AccountingDepreciationPostingMode,
  AccountingEntryStatus,
  AccountingFiscalYearStatus,
  AccountingJournalKind,
  AccountingMode,
  AccountingPendingReason,
  AccountingPeriodStatus,
  AccountingRateSource,
  AccountingReconciliationCause,
  AccountingRuleSetStatus,
  AccountingSourceKind,
  AccountingStatementKind,
  AccountingStatementStatus,
  AccountingStockPostingMode,
} from '@lalanda/shared/accounting';

import { API_URL, jsonRequest } from './api';

export type {
  AccountingActivationMissingCode,
  AccountingBookCurrency,
  AccountingChartPackStatus,
  AccountingConfirmation,
  AccountingEntryStatus,
  AccountingJournalKind,
  AccountingMode,
  AccountingStatementKind,
} from '@lalanda/shared/accounting';

// ── Vues (provisoires, d'après l'ADR ; à remplacer par les contrats de K4 à K7) ──

/** Réserve qu'un état dit de lui-même (§ 6.10) : code stable, phrase prête à afficher. */
export interface AccountingReserveView {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** `GET /accounting/settings` (§ 2.2). */
export interface AccountingSettingsView {
  mode: AccountingMode;
  chartPack: { slug: string; version: number | string; status: AccountingChartPackStatus } | null;
  bookCurrency: AccountingBookCurrency | null;
  cutoverDate: string | null;
  fiscalYearStartMonth: number;
  stockPosting: AccountingStockPostingMode;
  depreciationPosting: AccountingDepreciationPostingMode;
  ruleSetVersion: number | null;
  activatedAt: string | null;
  activatedBy: string | null;
  revision?: number;
}

/** Corps de `PUT /accounting/settings` : champs modifiés seulement. */
export interface AccountingSettingsInput {
  mode?: Exclude<AccountingMode, 'active'>;
  chartPack?: { slug: string; version: number | string };
  bookCurrency?: AccountingBookCurrency;
  cutoverDate?: string;
  fiscalYearStartMonth?: number;
  expectedRevision?: number;
}

/** Erreur `409 ACCOUNTING_ACTIVATION_PRECONDITION` : `details.missing[]`. */
export interface AccountingActivationRefusal {
  missing: AccountingActivationMissingCode[];
}

/** Pack de plan comptable publié (`GET /accounting/chart-packs`, § 2.1). */
export interface AccountingChartPackSummary {
  slug: string;
  version: number | string;
  framework: string;
  countries: string[];
  status: AccountingChartPackStatus;
  warnings: string[];
}

export interface AccountingChartPackDetail extends AccountingChartPackSummary {
  sources: {
    id: string;
    issuer: string;
    title: string;
    reference: string;
    publishedOn: string | null;
    url: string | null;
  }[];
  classes: { number: string | number; label: string; confirmation: AccountingConfirmation }[];
  accounts: {
    number: string;
    label: string;
    classNumber: string | number;
    confirmation: AccountingConfirmation;
  }[];
}

/** Compte du plan de l'organisation (§ 2.3). */
export interface AccountingAccountView {
  number: string;
  label: string;
  packLabel: string | null;
  origin: 'pack' | 'organization';
  confirmation: AccountingConfirmation | null;
  auxiliary: { kind: AccountingAuxiliaryKind; partyName: string | null } | null;
  collectiveNumber: string | null;
  active: boolean;
}

/** Règle de correspondance (§ 2.4) ; numéros de compte venus du plan, jamais du code. */
export interface AccountingRuleView {
  key: string;
  label?: string | null;
  debit: string[];
  credit: string[];
  requiresReview: boolean;
  confirmation?: AccountingConfirmation | null;
}

export interface AccountingRuleSetView {
  version: number;
  status: AccountingRuleSetStatus;
  basedOn: { packSlug: string; packVersion: number | string } | null;
  rules: AccountingRuleView[];
  validation: {
    by: string | null;
    at: string | null;
    soleApprover: boolean;
    expertReview: { declared: boolean; name: string | null; date: string | null } | null;
  } | null;
}

export interface AccountingJournalView {
  code: string;
  label: string;
  kind: AccountingJournalKind;
  active: boolean;
}

export interface AccountingExchangeRateView {
  date: string;
  from: AccountingBookCurrency;
  to: AccountingBookCurrency;
  rate: string;
  sourceText: string | null;
}

/** Ligne d'écriture (§ 2.6). Débit OU crédit en monnaie de tenue ; montant en devise de la pièce. */
export interface AccountingEntryLineView {
  accountNumber: string;
  accountLabel?: string | null;
  auxiliaryAccountNumber: string | null;
  label: string;
  debit: string | null;
  credit: string | null;
  currency: AccountingBookCurrency;
  amount: string;
  rate: string | null;
  rateSource: AccountingRateSource | null;
  letteringCode: string | null;
}

export interface AccountingEntryView {
  id: string;
  journalCode: string;
  fiscalYear: number | null;
  number: number | null;
  date: string;
  status: AccountingEntryStatus;
  label: string | null;
  source: {
    kind: AccountingSourceKind;
    id: string;
    number: string | null;
    date: string;
    partyName: string | null;
  } | null;
  lines: AccountingEntryLineView[];
  reversalOf: string | null;
  reversedBy: string | null;
  generation: { ruleSetVersion: number; engineVersion: string } | null;
  manual: { authorId: string; validatorId: string | null; reason: string } | null;
  suspense: boolean;
}

/** Corps de `POST /accounting/entries/search` (filtres en corps, § 11). */
export interface AccountingEntrySearch {
  journalCode?: string;
  from?: string;
  to?: string;
  accountNumber?: string;
  sourceNumber?: string;
  status?: AccountingEntryStatus;
  cursor?: string;
  limit?: number;
}

export interface AccountingPage<T> {
  items: T[];
  nextCursor: string | null;
  reserves?: AccountingReserveView[];
}

/** « À comptabiliser » (§ 2.7). */
export interface AccountingPendingView {
  id: string;
  reason: AccountingPendingReason;
  source: { kind: AccountingSourceKind; id: string; number: string | null; date: string };
  createdAt: string;
}

/** Critères en corps du grand livre et des balances (§ 11). */
export interface AccountingPeriodCriteria {
  from: string;
  to: string;
  accountNumber?: string;
  auxiliaryKind?: AccountingAuxiliaryKind;
}

export interface AccountingLedgerLineView {
  ref: string;
  entryId: string;
  journalCode: string;
  number: number | null;
  date: string;
  label: string;
  debit: string;
  credit: string;
  balance: string;
  currency: AccountingBookCurrency;
  amount: string;
  letteringCode: string | null;
  sourceNumber: string | null;
}

export interface AccountingLedgerAccountView {
  accountNumber: string;
  label: string | null;
  confirmation: AccountingConfirmation;
  openingBalance: string;
  totalDebit: string;
  totalCredit: string;
  closingBalance: string;
  lines: AccountingLedgerLineView[];
}

export interface AccountingLedgerView {
  bookCurrency: AccountingBookCurrency;
  from: string;
  to: string;
  accounts: AccountingLedgerAccountView[];
  reserves: AccountingReserveView[];
}

export interface AccountingTrialBalanceRowView {
  accountNumber: string;
  label: string | null;
  confirmation: AccountingConfirmation;
  openingDebit: string;
  openingCredit: string;
  periodDebit: string;
  periodCredit: string;
  closingDebit: string;
  closingCredit: string;
}

export interface AccountingTrialBalanceView {
  bookCurrency: AccountingBookCurrency;
  from: string;
  to: string;
  rows: AccountingTrialBalanceRowView[];
  totals: { debit: string; credit: string; balanced: boolean };
  reserves: AccountingReserveView[];
}

export interface AccountingAuxiliaryBalanceView extends AccountingTrialBalanceView {
  kind: AccountingAuxiliaryKind;
}

/** Projet d'état (§ 10) : `status: "draft_unverified"`, `disclaimer`, réserves, toujours. */
export interface AccountingStatementView {
  status: AccountingStatementStatus;
  disclaimer: string;
  reserves: AccountingReserveView[];
  kind: AccountingStatementKind;
  label: string;
  bookCurrency: AccountingBookCurrency;
  from: string;
  to: string;
  sections: {
    code: string;
    label: string;
    toConfirm: boolean;
    total: string;
    rubrics: { code: string; label: string; toConfirm: boolean; amount: string }[];
  }[];
  result: string | null;
}

export interface AccountingFiscalYearView {
  year: number;
  start: string;
  end: string;
  status: AccountingFiscalYearStatus;
  closedAt: string | null;
  periods: { month: number; status: AccountingPeriodStatus; closedAt: string | null }[];
}

/** Rapprochement du mois avec le réalisé (§ 7) : écarts typés, jamais corrigés. */
export interface AccountingReconciliationView {
  month: string;
  metrics: {
    key: string;
    label: string;
    actuals: string | null;
    accounting: string | null;
    gap: string | null;
    causes: AccountingReconciliationCause[];
  }[];
}

export type AccountingExportKind =
  'entries' | 'trial-balance' | 'auxiliary-balance' | 'ledger' | 'statements' | 'reserves';
export type AccountingExportFormat = 'csv' | 'xlsx' | 'pdf';

export interface AccountingExportInput {
  kind: AccountingExportKind;
  format: AccountingExportFormat;
  from: string;
  to: string;
}

export interface AccountingExportView {
  id: string;
  kind: AccountingExportKind;
  format: AccountingExportFormat;
  from: string;
  to: string;
  simulation: boolean;
  sha256: string;
  createdAt: string;
  createdBy: string | null;
  expiresAt: string | null;
}

// ─── Client ─────────────────────────────────────────────────────────────────

const seg = (v: string | number): string => encodeURIComponent(String(v));
const GET = { method: 'GET' } as const;

export const accountingApi = {
  // Réglages et activation (K4)
  getSettings: () => jsonRequest<AccountingSettingsView>('/accounting/settings', GET),
  updateSettings: (body: AccountingSettingsInput) =>
    jsonRequest<AccountingSettingsView>('/accounting/settings', { method: 'PUT', body }),
  activate: () =>
    jsonRequest<AccountingSettingsView>('/accounting/activate', { method: 'POST', body: {} }),
  deactivate: () =>
    jsonRequest<AccountingSettingsView>('/accounting/deactivate', { method: 'POST', body: {} }),

  // Packs, plan, règles, journaux, taux (K4)
  listChartPacks: () =>
    jsonRequest<{ items: AccountingChartPackSummary[] }>('/accounting/chart-packs', GET),
  getChartPack: (slug: string, version: number | string) =>
    jsonRequest<AccountingChartPackDetail>(
      `/accounting/chart-packs/${seg(slug)}/${seg(version)}`,
      GET,
    ),
  listAccounts: () => jsonRequest<{ items: AccountingAccountView[] }>('/accounting/accounts', GET),
  listRuleSets: () => jsonRequest<{ items: AccountingRuleSetView[] }>('/accounting/rule-sets', GET),
  getRuleSet: (version: number) =>
    jsonRequest<AccountingRuleSetView>(`/accounting/rule-sets/${seg(version)}`, GET),
  listJournals: () => jsonRequest<{ items: AccountingJournalView[] }>('/accounting/journals', GET),
  listExchangeRates: () =>
    jsonRequest<{ items: AccountingExchangeRateView[] }>('/accounting/exchange-rates', GET),

  // Écritures, « À comptabiliser » (K5)
  searchEntries: (body: AccountingEntrySearch) =>
    jsonRequest<AccountingPage<AccountingEntryView>>('/accounting/entries/search', {
      method: 'POST',
      body,
    }),
  getEntry: (entryId: string) =>
    jsonRequest<AccountingEntryView>(`/accounting/entries/${seg(entryId)}`, GET),
  listPending: () => jsonRequest<AccountingPage<AccountingPendingView>>('/accounting/pending', GET),

  // Restitution (K6)
  ledger: (body: AccountingPeriodCriteria) =>
    jsonRequest<AccountingLedgerView>('/accounting/ledger', { method: 'POST', body }),
  trialBalance: (body: AccountingPeriodCriteria) =>
    jsonRequest<AccountingTrialBalanceView>('/accounting/trial-balance', { method: 'POST', body }),
  auxiliaryBalance: (body: AccountingPeriodCriteria & { auxiliaryKind: AccountingAuxiliaryKind }) =>
    jsonRequest<AccountingAuxiliaryBalanceView>('/accounting/auxiliary-balance', {
      method: 'POST',
      body,
    }),
  getStatement: (kind: AccountingStatementKind, year: number, month?: number) =>
    jsonRequest<AccountingStatementView>(
      `/accounting/statements/${seg(kind)}?year=${seg(year)}${month ? `&month=${seg(month)}` : ''}`,
      GET,
    ),
  reconciliation: (month: string) =>
    jsonRequest<AccountingReconciliationView>(
      `/accounting/reconciliation/actuals?month=${seg(month)}`,
      GET,
    ),

  // Clôtures (K4 pour la structure, K6 pour les clôtures)
  listFiscalYears: () =>
    jsonRequest<{ items: AccountingFiscalYearView[] }>('/accounting/fiscal-years', GET),
  closePeriod: (year: number, month: number) =>
    jsonRequest<AccountingFiscalYearView>(`/accounting/periods/${seg(year)}/${seg(month)}/close`, {
      method: 'POST',
      body: {},
    }),
  reopenPeriod: (year: number, month: number, reason: string) =>
    jsonRequest<AccountingFiscalYearView>(`/accounting/periods/${seg(year)}/${seg(month)}/reopen`, {
      method: 'POST',
      body: { reason },
    }),

  // Exports (K6)
  listExports: () => jsonRequest<AccountingPage<AccountingExportView>>('/accounting/exports', GET),
  createExport: (body: AccountingExportInput) =>
    jsonRequest<AccountingExportView>('/accounting/exports', { method: 'POST', body }),
  /** Adresse du fichier d'un export (`GET /accounting/exports/:id/file`, `accounting.export`). */
  exportFileUrl: (exportId: string) => `${API_URL}/accounting/exports/${seg(exportId)}/file`,
};
