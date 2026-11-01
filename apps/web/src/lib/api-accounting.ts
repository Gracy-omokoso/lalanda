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
  AccountingConfirmation,
  AccountingReconciliationCause,
  AccountingStatementKind,
  AccountingStatementStatus,
} from '@lalanda/shared/accounting';

import type {
  AccountingEntrySearch,
  AccountingEntryView,
  AccountingLetteringView,
  AccountingPage,
  AccountingPendingView,
  AccountingRegenerationView,
  AccountingSyncResult,
  AccountingTreasuryLinkView,
  CreateManualEntryBody,
  PutAccountingTreasuryLinkBody,
  UpdateManualEntryBody,
  AccountingAccountView,
  AccountingChartPackDetail,
  AccountingChartPackSummary,
  AccountingExchangeRateView,
  AccountingFiscalYearView,
  AccountingJournalView,
  AccountingRuleInput,
  AccountingRuleSetView,
  AccountingSettingsView,
  UpdateAccountingSettingsBody,
} from '@lalanda/shared/accounting';
import type { z } from 'zod';

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

// ── Vues (provisoires, d'après l'ADR, pour K5 à K7 ; K4 publie les siennes) ──

/** Réserve qu'un état dit de lui-même (§ 6.10) : code stable, phrase prête à afficher. */
export interface AccountingReserveView {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ADR-0049 — K4 : vues et corps du référentiel et des réglages, PUBLIÉS par l'API dans
// `@lalanda/shared/accounting` (referential.ts) — mêmes formes que les réponses.
export type {
  AccountingAccountView,
  AccountingChartPackDetail,
  AccountingChartPackSummary,
  AccountingExchangeRateView,
  AccountingFiscalYearView,
  AccountingJournalView,
  AccountingPeriodView,
  AccountingRuleInput,
  AccountingRuleSetView,
  AccountingSettingsView,
} from '@lalanda/shared/accounting';

/** Règle de correspondance (§ 2.4) ; numéros de compte venus du plan, jamais du code. */
export type AccountingRuleView = AccountingRuleInput;

/** Corps de `PUT /accounting/settings` : `expectedRevision` + champs modifiés seulement. */
export type AccountingSettingsInput = z.input<typeof UpdateAccountingSettingsBody>;

/** Erreur `409 ACCOUNTING_ACTIVATION_PRECONDITION` : `details.missing[]`. */
export interface AccountingActivationRefusal {
  missing: AccountingActivationMissingCode[];
}

// ADR-0049 — K5 : écritures, « À comptabiliser », synchronisation, lettrage, PUBLIÉS par
// l'API dans `@lalanda/shared/accounting` (entries.ts) — mêmes formes que les réponses.
export type {
  AccountingEntryLineView,
  AccountingEntrySearch,
  AccountingEntrySourceView,
  AccountingEntryView,
  AccountingLetteringView,
  AccountingPage,
  AccountingPendingView,
  AccountingRegenerationView,
  AccountingSyncResult,
  AccountingTreasuryLinkView,
} from '@lalanda/shared/accounting';

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
  /** `accounting.manage` + `fiscal.manage` ; révision des réglages exigée (409 `STALE_REVISION`). */
  activate: (expectedRevision: number) =>
    jsonRequest<AccountingSettingsView>('/accounting/activate', {
      method: 'POST',
      body: { expectedRevision },
    }),
  deactivate: (expectedRevision: number) =>
    jsonRequest<AccountingSettingsView>('/accounting/deactivate', {
      method: 'POST',
      body: { expectedRevision },
    }),

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
  /** Opération diverse en brouillon (`accounting.post`, mode actif). */
  createEntry: (body: z.input<typeof CreateManualEntryBody>) =>
    jsonRequest<AccountingEntryView>('/accounting/entries', { method: 'POST', body }),
  updateEntry: (entryId: string, body: z.input<typeof UpdateManualEntryBody>) =>
    jsonRequest<AccountingEntryView>(`/accounting/entries/${seg(entryId)}`, {
      method: 'PUT',
      body,
    }),
  /** Séparation des tâches : l'auteur ne valide pas (409 `SELF_APPROVAL_FORBIDDEN`). */
  validateEntry: (entryId: string, expectedRevision: number) =>
    jsonRequest<AccountingEntryView>(`/accounting/entries/${seg(entryId)}/validate`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  reverseEntry: (entryId: string, body: { reason: string; date?: string }) =>
    jsonRequest<AccountingEntryView>(`/accounting/entries/${seg(entryId)}/reverse`, {
      method: 'POST',
      body,
    }),
  deleteEntry: (entryId: string) =>
    jsonRequest<void>(`/accounting/entries/${seg(entryId)}`, { method: 'DELETE' }),
  resolvePending: (pendingId: string, note: string) =>
    jsonRequest<AccountingPendingView>(`/accounting/pending/${seg(pendingId)}/resolve`, {
      method: 'POST',
      body: { note },
    }),
  /** Synchronisation immédiate, idempotente (`accounting.manage`). */
  sync: () => jsonRequest<AccountingSyncResult>('/accounting/sync', { method: 'POST', body: {} }),
  /** Aperçu, puis `confirm` : régénération contrôlée d'un mois ouvert. */
  regenerate: (year: number, month: number, confirm: boolean) =>
    jsonRequest<AccountingRegenerationView>(
      `/accounting/periods/${seg(year)}/${seg(month)}/regenerate${confirm ? '?confirm=true' : ''}`,
      { method: 'POST', body: {} },
    ),
  letter: (lineRefs: string[]) =>
    jsonRequest<AccountingLetteringView>('/accounting/lettering', {
      method: 'POST',
      body: { lineRefs },
    }),
  unletter: (code: string) =>
    jsonRequest<{ code: string; lineRefs: string[] }>(
      `/accounting/lettering/${seg(code)}/unletter`,
      {
        method: 'POST',
        body: {},
      },
    ),
  listTreasuryLinks: () =>
    jsonRequest<{ items: AccountingTreasuryLinkView[] }>('/accounting/treasury-links', GET),
  putTreasuryLink: (treasuryAccountId: string, body: PutAccountingTreasuryLinkBody) =>
    jsonRequest<AccountingTreasuryLinkView>(
      `/accounting/treasury-links/${seg(treasuryAccountId)}`,
      { method: 'PUT', body },
    ),

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
