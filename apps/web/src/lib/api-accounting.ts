// Client de l'API de la comptabilité — ADR-0049 § 11 (préfixe `/accounting`), lot K8.
//
// Fichier voisin de `api.ts` (même `jsonRequest`, mêmes erreurs). AUCUN calcul ici :
// écritures, soldes, balances, projets d'états et réserves viennent de l'API, qui les
// tient du moteur (`@lalanda/engine`, module `accounting`), en chaînes décimales.
//
// Contrats : les unions fermées, les textes des bandeaux et les codes viennent de
// `@lalanda/shared/accounting` (lot K0). Les VUES de réponse sont publiées
// par les lots K4 à K7 dans `@lalanda/shared/accounting` et réexportées ici. Tant qu'une
// route n'existe pas, l'API répond 404 : les écrans affichent « bientôt disponible »,
// jamais une donnée inventée.
//
// Aucune donnée comptable dans l'URL au-delà des identifiants et des périodes (§ 11) :
// recherches, grand livre et balances passent en corps `POST`.

import type {
  AccountingActivationMissingCode,
  AccountingAuxiliaryBalanceView,
  AccountingExportView,
  AccountingFiscalYearCloseView,
  AccountingLedgerView,
  AccountingPeriodCriteria,
  AccountingReconciliationView,
  AccountingStatementKind,
  AccountingStatementView,
  AccountingTrialBalanceView,
  CreateAccountingExportInput,
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
  AccountingOpeningProposalView,
  AccountingOpeningStatusView,
  CreateAccountingOpeningBody,
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

// ── Vues publiées par l'API (`@lalanda/shared/accounting`) ──────────────────

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

// ADR-0049 — K6 : restitution, projets d'états, clôtures, rapprochement et exports, PUBLIÉS
// par l'API dans `@lalanda/shared/accounting` (reporting.ts) — mêmes formes que les réponses.
export type {
  AccountingAuxiliaryBalanceView,
  AccountingAuxiliaryGroupView,
  AccountingAuxiliaryRowView,
  AccountingExportFormat,
  AccountingExportKind,
  AccountingExportView,
  AccountingFiscalYearCloseView,
  AccountingLedgerAccountView,
  AccountingLedgerLineView,
  AccountingLedgerView,
  AccountingPeriodCriteria,
  AccountingReconciliationMetricView,
  AccountingReconciliationView,
  AccountingReserveView,
  AccountingStatementView,
  AccountingTrialBalanceRowView,
  AccountingTrialBalanceView,
} from '@lalanda/shared/accounting';

// ADR-0049 — K7 : reprise de l'existant (à-nouveaux de reprise), PUBLIÉE par l'API dans
// `@lalanda/shared/accounting` (opening.ts) — mêmes formes que les réponses.
export type {
  AccountingOpeningLaterAccountView,
  AccountingOpeningLineKind,
  AccountingOpeningProposalLineView,
  AccountingOpeningProposalView,
  AccountingOpeningStatusView,
} from '@lalanda/shared/accounting';

/** Corps de `POST /accounting/exports`. */
export type AccountingExportInput = CreateAccountingExportInput;

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

  // Reprise de l'existant (K7) : proposition (rien n'est enregistré), saisie en brouillon
  // (mode actif), validation par une autre personne autorisée (409 `SELF_APPROVAL_FORBIDDEN`,
  // `OPENING_PROPOSAL_CHANGED` si un montant repris ne correspond plus aux pièces).
  getOpeningProposal: () =>
    jsonRequest<AccountingOpeningProposalView>('/accounting/opening/proposal', GET),
  getOpening: () => jsonRequest<AccountingOpeningStatusView>('/accounting/opening', GET),
  createOpening: (body: z.input<typeof CreateAccountingOpeningBody>) =>
    jsonRequest<AccountingOpeningStatusView>('/accounting/opening', { method: 'POST', body }),
  validateOpening: (entryId: string, expectedRevision: number) =>
    jsonRequest<AccountingOpeningStatusView>(`/accounting/opening/${seg(entryId)}/validate`, {
      method: 'POST',
      body: { expectedRevision },
    }),

  // Restitution (K6)
  ledger: (body: AccountingPeriodCriteria) =>
    jsonRequest<AccountingLedgerView>('/accounting/ledger', { method: 'POST', body }),
  trialBalance: (body: AccountingPeriodCriteria) =>
    jsonRequest<AccountingTrialBalanceView>('/accounting/trial-balance', { method: 'POST', body }),
  auxiliaryBalance: (body: AccountingPeriodCriteria) =>
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

  // Clôtures (K4 pour la structure, K6 pour les clôtures et les à-nouveaux)
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
  /** Clôture d'exercice : à-nouveaux générés par le moteur ; solde d'attente accepté avec motif. */
  closeFiscalYear: (year: number, suspenseAcceptanceReason?: string) =>
    jsonRequest<AccountingFiscalYearCloseView>(`/accounting/fiscal-years/${seg(year)}/close`, {
      method: 'POST',
      body:
        suspenseAcceptanceReason === undefined
          ? {}
          : { suspenseAcceptance: { reason: suspenseAcceptanceReason } },
    }),
  /** Propriétaire seul (403 `REOPEN_OWNER_ONLY`) ; les à-nouveaux sont contre-passés. */
  reopenFiscalYear: (year: number, reason: string) =>
    jsonRequest<AccountingFiscalYearView>(`/accounting/fiscal-years/${seg(year)}/reopen`, {
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
