// Client de l'API du CRM minimal et des devis — ADR-0035 § 4.
//
// Fichier voisin de `api.ts` (même `jsonRequest`, mêmes erreurs) pour ne pas
// grossir ce dernier. AUCUN montant n'est calculé ici : montants estimés,
// totaux et probabilités viennent de l'API (moteur), en chaînes décimales.

import {
  API_URL,
  jsonRequest,
  salesQuery,
  type DocumentCurrency,
  type DocumentEmailDraft,
  type DocumentEmailInput,
  type DocumentEmailResult,
  type InvoiceCalculationView,
  type InvoiceCustomerBody,
  type InvoiceCustomerView,
  type InvoiceLineBody,
  type InvoiceLineView,
  type InvoicePriceMode,
} from './api';

import type {
  CrmAccountPage,
  CrmAccountView,
  CrmAccountWriteResult,
  CrmOverview,
  CrmTimelinePage,
} from '@lalanda/shared/crm';

export type {
  CrmAccountListItem,
  CrmAccountPage,
  CrmAccountView,
  CrmAccountWriteResult,
  CrmOverview,
  CrmTimelinePage,
} from '@lalanda/shared/crm';

type DecimalString = string;

// ─── CRM ─────────────────────────────────────────────────────────────────────

export type StageKind = 'open' | 'won' | 'lost';
export type OpportunityStatus = StageKind;

export interface PipelineStage {
  key: string;
  label: string;
  kind: StageKind;
}

/** Motif de perte paramétrable (ADR-0040 § 2.5). */
export interface LostReason {
  key: string;
  label: string;
  active: boolean;
}

export interface CrmSettingsView {
  stages: PipelineStage[];
  autoWinOnQuoteAccepted: boolean;
  staleAfterDays: number;
  /** ADR-0040 — C2 : motifs de perte et motif obligatoire. */
  lostReasons: LostReason[];
  lostReasonRequired: boolean;
  forecastProbability: 'historical' | 'manual';
  /** 0 : réglages par défaut, jamais enregistrés. */
  revision: number;
  updatedAt: string | null;
}

export interface PutCrmSettingsBody {
  expectedRevision: number;
  stages: PipelineStage[];
  autoWinOnQuoteAccepted: boolean;
  staleAfterDays: number;
  lostReasons?: LostReason[];
  lostReasonRequired?: boolean;
}

export interface ContactView {
  id: string;
  kind: 'customer_contact' | 'prospect';
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  /** ADR-0040 — C1 : compte de la personne, `null` sans entreprise. */
  accountId: string | null;
  accountName: string | null;
  customerId: string | null;
  customerName: string | null;
  companyName: string | null;
  notes: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** ADR-0040 — C1 : le compte remplace client et entreprise saisie. */
export interface ContactBody {
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  accountId: string | null;
  notes: string | null;
}

export interface OpportunitySummary {
  id: string;
  title: string;
  customerId: string | null;
  customerName: string | null;
  prospectName: string | null;
  contactId: string | null;
  contactName: string | null;
  stageKey: string;
  stageLabel: string;
  status: OpportunityStatus;
  /** Montant ESTIMÉ, chaîne décimale ; `null` : non estimé. */
  amount: DecimalString | null;
  currency: DocumentCurrency;
  expectedCloseDate: string | null;
  lastActivityAt: string;
  daysSinceActivity: number;
  stale: boolean;
  closedAt: string | null;
  revision: number;
  // ── ADR-0040 — C2 ──
  accountId: string | null;
  accountName: string | null;
  ownerId: string | null;
  /** Ouverte et sans responsable membre de l'organisation : à réassigner. */
  orphaned: boolean;
  amountSource: AmountSource;
  lostReasonKey: string | null;
  wonAt: string | null;
}

export type AmountSource = 'manual' | 'lines';

/** Ligne d'opportunité (ADR-0040 § 2.3) ; prix HORS TAXES, `null` : sans prix. */
export interface OpportunityLine {
  catalogItemId: string | null;
  label: string;
  quantity: DecimalString;
  unit: string | null;
  unitPrice: DecimalString | null;
  discountPercent: DecimalString | null;
}

export interface OpportunityLineBody {
  catalogItemId: string | null;
  label: string | null;
  quantity: DecimalString;
  unit?: string | null;
  unitPrice?: DecimalString | null;
  discountPercent: DecimalString | null;
}

export interface OpportunityWarning {
  code: 'CRM_LINE_WITHOUT_PRICE';
  lineIndex: number;
}

export interface OpportunityView extends OpportunitySummary {
  /** Détail libre du motif de perte (le motif est `lostReasonKey`). */
  lostReason: string | null;
  lines: OpportunityLine[];
  stageHistory: {
    stageKey: string;
    stageLabel: string;
    at: string;
    by: string;
    source: 'user' | 'quote' | 'import';
    quoteId: string | null;
  }[];
  quotes: {
    id: string;
    number: string;
    version: number;
    status: QuoteStatus;
    currency: DocumentCurrency;
    total: DecimalString | null;
    validUntil: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityBody {
  title: string;
  /** ADR-0040 — C2 : le compte visé (client et prospect en sont déduits). */
  accountId: string | null;
  contactId: string | null;
  amount: DecimalString | null;
  currency: DocumentCurrency;
  expectedCloseDate: string | null;
  ownerId?: string;
  lines?: OpportunityLineBody[];
  amountSource?: AmountSource;
}

/** Prévision pondérée d'une devise (moteur, ADR-0040 § 7.1) ; jamais convertie. */
export interface CurrencyForecast {
  currency: string;
  weighted: DecimalString;
  unweighted: DecimalString;
  count: number;
  notWeightable: { total: DecimalString; count: number };
}

export interface WeightedForecast {
  version: string;
  basis: 'estimated';
  probabilitySource: 'historical' | 'manual';
  currencies: CurrencyForecast[];
}

export type StageWinRate =
  | { status: 'available'; ratePercent: string; sample: number; won: number }
  | { status: 'unavailable'; sample: number; won: number; requiredSample: number };

export interface ActivityBrief {
  id: string;
  kind: ActivityKind;
  subject: string;
  dueAt: string | null;
  overdue: boolean;
  opportunityId: string | null;
  opportunityTitle: string | null;
}

export interface PipelineView {
  calculationVersion: string;
  generatedAt: string;
  settings: CrmSettingsView;
  stages: {
    key: string;
    label: string;
    kind: StageKind;
    opportunities: OpportunitySummary[];
    totals: { currency: string; total: DecimalString; count: number }[];
    winRate: StageWinRate | null;
  }[];
  stale: OpportunitySummary[];
  overdueActivities: ActivityBrief[];
  upcomingActivities: ActivityBrief[];
  winRateMinSample: number;
  // ── ADR-0040 — C2 ──
  /** Filtre responsable appliqué (`null` : tout le pipeline). */
  ownerId: string | null;
  forecast: WeightedForecast;
  orphaned: { count: number; ownerIds: string[] };
}

export type ActivityKind = 'call' | 'meeting' | 'note' | 'follow_up';

export interface ActivityView {
  id: string;
  kind: ActivityKind;
  kindLabel: string;
  subject: string;
  notes: string | null;
  dueAt: string | null;
  done: boolean;
  doneAt: string | null;
  overdue: boolean;
  opportunityId: string | null;
  contactId: string | null;
  customerId: string | null;
  // ── ADR-0040 — C4 ──
  accountId: string | null;
  assigneeUserId: string | null;
  /** Jour d'échéance à Kinshasa. */
  dueDay: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityBody {
  kind: ActivityKind;
  subject: string;
  notes: string | null;
  dueAt: string | null;
  opportunityId: string | null;
  contactId: string | null;
  customerId: string | null;
  /** Absent : le créateur (création) ou l'assigné courant (modification). */
  assigneeUserId?: string | null;
}

export interface ActivitiesQuery {
  status?: 'all' | 'open' | 'overdue' | 'done';
  opportunityId?: string;
  contactId?: string;
  accountId?: string;
  assignee?: string;
  dueFrom?: string;
  dueTo?: string;
  limit?: number;
  cursor?: string | null;
}

export interface ListAccountsQuery {
  kind?: 'prospect' | 'customer';
  ownerId?: string;
  active?: 'true' | 'false';
  q?: string;
  limit?: number;
  cursor?: string | null;
}

export interface AccountBody {
  name?: string;
  ownerId?: string | null;
  industry?: string | null;
  origin?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
}

export type ConvertAccountBody =
  | { mode: 'create'; customer: Record<string, unknown>; expectedRevision: number }
  | { mode: 'link'; customerId: string; expectedRevision: number };

export interface ConversionResult {
  account: CrmAccountView;
  customerId: string;
  mode: 'created' | 'linked';
  merged: boolean;
}

export interface MergeResult {
  account: CrmAccountView;
  moved: Record<string, number>;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ImportResult {
  dryRun: boolean;
  rows: number;
  created: number;
}

// ─── Devis ───────────────────────────────────────────────────────────────────

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'refused' | 'expired';

export interface QuoteSummary {
  id: string;
  number: string;
  version: number;
  status: QuoteStatus;
  statusLabel: string;
  title: string | null;
  customerName: string | null;
  customerId: string | null;
  opportunityId: string | null;
  currency: DocumentCurrency;
  priceMode: InvoicePriceMode;
  total: DecimalString | null;
  validUntil: string;
  convertedInvoiceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteActions {
  edit: boolean;
  delete: boolean;
  send: boolean;
  accept: boolean;
  refuse: boolean;
  newVersion: boolean;
  convert: boolean;
}

export interface QuoteView extends QuoteSummary {
  notes: string | null;
  customer: InvoiceCustomerView;
  lines: InvoiceLineView[];
  lineInputs: InvoiceLineBody[];
  documentAmounts: { currency: DocumentCurrency; calculation: InvoiceCalculationView };
  sentAt: string | null;
  acceptedAt: string | null;
  refusedAt: string | null;
  refusalReason: string | null;
  opportunityOutcome: 'won' | 'disabled' | 'not_open' | 'none' | null;
  opportunity: { id: string; title: string | null } | null;
  conversion: {
    invoiceId: string;
    convertedAt: string;
    alive: boolean;
    invoiceStatus: string | null;
    reference: string | null;
  } | null;
  previousVersions: {
    version: number;
    status: QuoteStatus;
    total: DecimalString | null;
    sentAt: string | null;
    supersededAt: string;
  }[];
  actions: QuoteActions;
  blockers: { code: string; message: string; lineIndex: number | null }[];
  revision: number;
}

export interface QuoteBody {
  opportunityId: string | null;
  title: string | null;
  notes: string | null;
  validUntil: string | null;
  currency: DocumentCurrency;
  priceMode: InvoicePriceMode;
  customer: InvoiceCustomerBody;
  lines: readonly InvoiceLineBody[];
}

export interface QuoteConversionResult {
  quote: QuoteView;
  invoiceId: string;
  amountsDiffer: boolean;
}

export interface ListQuotesQuery {
  status?: QuoteStatus | 'all';
  customerId?: string;
  opportunityId?: string;
  q?: string;
  limit?: number;
  cursor?: string | null;
}

async function download(
  path: string,
  fallbackName: string,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${API_URL}${path}`, { method: 'GET', credentials: 'include' });
  if (!res.ok) {
    const text = await res.text();
    let detail: unknown = text;
    try {
      detail = JSON.parse(text);
    } catch {
      /* garde le texte brut */
    }
    const err = new Error(
      typeof detail === 'object' && detail !== null && 'message' in detail
        ? String((detail as { message: unknown }).message)
        : `HTTP ${res.status}`,
    ) as Error & { status: number; detail: unknown };
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const match = cd.match(/filename="([^"]+)"/);
  return { blob: await res.blob(), filename: match?.[1] ?? fallbackName };
}

const id = (v: string) => encodeURIComponent(v);

export const crmApi = {
  getSettings: () => jsonRequest<CrmSettingsView>('/crm/settings', { method: 'GET' }),
  putSettings: (body: PutCrmSettingsBody) =>
    jsonRequest<CrmSettingsView>('/crm/settings', { method: 'PUT', body }),
  getPipeline: (query: { ownerId?: string } = {}) =>
    jsonRequest<PipelineView>(`/crm/pipeline${salesQuery(query)}`, { method: 'GET' }),
  reassignOpportunities: (body: { fromOwnerId: string; toOwnerId: string; onlyOpen: boolean }) =>
    jsonRequest<{ reassigned: number }>('/crm/opportunities/reassign', { method: 'POST', body }),

  // ─── Comptes (ADR-0040 § 3.1) ───────────────────────────────────────────
  listAccounts: (query: ListAccountsQuery = {}) =>
    jsonRequest<CrmAccountPage>(`/crm/accounts${salesQuery(query)}`, { method: 'GET' }),
  getAccount: (accountId: string) =>
    jsonRequest<CrmAccountView>(`/crm/accounts/${id(accountId)}`, { method: 'GET' }),
  createAccount: (body: AccountBody & { name: string }) =>
    jsonRequest<CrmAccountWriteResult>('/crm/accounts', { method: 'POST', body }),
  updateAccount: (accountId: string, body: AccountBody & { expectedRevision: number }) =>
    jsonRequest<CrmAccountWriteResult>(`/crm/accounts/${id(accountId)}`, { method: 'PUT', body }),
  archiveAccount: (accountId: string, expectedRevision: number, archive: boolean) =>
    jsonRequest<CrmAccountView>(
      `/crm/accounts/${id(accountId)}/${archive ? 'archive' : 'restore'}`,
      { method: 'POST', body: { expectedRevision } },
    ),
  deleteAccount: (accountId: string) =>
    jsonRequest<void>(`/crm/accounts/${id(accountId)}`, { method: 'DELETE' }),
  mergeAccount: (accountId: string, targetAccountId: string, expectedRevision: number) =>
    jsonRequest<MergeResult>(`/crm/accounts/${id(accountId)}/merge`, {
      method: 'POST',
      body: { targetAccountId, expectedRevision },
    }),
  convertAccount: (accountId: string, body: ConvertAccountBody) =>
    jsonRequest<ConversionResult>(`/crm/accounts/${id(accountId)}/convert`, {
      method: 'POST',
      body,
    }),
  getAccountOverview: (accountId: string) =>
    jsonRequest<CrmOverview>(`/crm/accounts/${id(accountId)}/overview`, { method: 'GET' }),
  getAccountTimeline: (accountId: string, cursor: string | null = null) =>
    jsonRequest<CrmTimelinePage>(
      `/crm/accounts/${id(accountId)}/timeline${salesQuery({ cursor })}`,
      { method: 'GET' },
    ),

  listContacts: (query: {
    q?: string;
    kind?: 'all' | 'prospect' | 'customer_contact';
    customerId?: string;
    accountId?: string;
    limit?: number;
    cursor?: string | null;
  }) => jsonRequest<Page<ContactView>>(`/crm/contacts${salesQuery(query)}`, { method: 'GET' }),
  createContact: (body: ContactBody) =>
    jsonRequest<ContactView>('/crm/contacts', { method: 'POST', body }),
  updateContact: (contactId: string, body: ContactBody & { expectedRevision: number }) =>
    jsonRequest<ContactView>(`/crm/contacts/${id(contactId)}`, { method: 'PUT', body }),
  deleteContact: (contactId: string) =>
    jsonRequest<void>(`/crm/contacts/${id(contactId)}`, { method: 'DELETE' }),
  importContacts: (csv: string, dryRun: boolean) =>
    jsonRequest<ImportResult>('/crm/contacts/import', { method: 'POST', body: { csv, dryRun } }),
  exportContacts: () => download('/crm/contacts/export', 'contacts.csv'),

  listOpportunities: (query: {
    status?: 'all' | OpportunityStatus;
    stageKey?: string;
    q?: string;
    ownerId?: string;
    accountId?: string;
    limit?: number;
    cursor?: string | null;
  }) =>
    jsonRequest<Page<OpportunitySummary>>(`/crm/opportunities${salesQuery(query)}`, {
      method: 'GET',
    }),
  getOpportunity: (opportunityId: string) =>
    jsonRequest<OpportunityView>(`/crm/opportunities/${id(opportunityId)}`, { method: 'GET' }),
  createOpportunity: (body: OpportunityBody & { stageKey?: string }) =>
    jsonRequest<OpportunityView & { warnings: OpportunityWarning[] }>('/crm/opportunities', {
      method: 'POST',
      body,
    }),
  updateOpportunity: (
    opportunityId: string,
    body: OpportunityBody & { expectedRevision: number },
  ) =>
    jsonRequest<OpportunityView & { warnings: OpportunityWarning[] }>(
      `/crm/opportunities/${id(opportunityId)}`,
      {
        method: 'PUT',
        body,
      },
    ),
  moveOpportunity: (
    opportunityId: string,
    body: {
      expectedRevision: number;
      stageKey: string;
      lostReasonKey?: string | null;
      lostReasonDetail?: string | null;
    },
  ) =>
    jsonRequest<OpportunityView>(`/crm/opportunities/${id(opportunityId)}/move`, {
      method: 'POST',
      body,
    }),
  deleteOpportunity: (opportunityId: string) =>
    jsonRequest<void>(`/crm/opportunities/${id(opportunityId)}`, { method: 'DELETE' }),
  importOpportunities: (csv: string, dryRun: boolean) =>
    jsonRequest<ImportResult>('/crm/opportunities/import', {
      method: 'POST',
      body: { csv, dryRun },
    }),
  exportOpportunities: () => download('/crm/opportunities/export', 'opportunites.csv'),

  listActivities: (query: ActivitiesQuery) =>
    jsonRequest<Page<ActivityView>>(`/crm/activities${salesQuery(query)}`, { method: 'GET' }),
  createActivity: (body: ActivityBody) =>
    jsonRequest<ActivityView>('/crm/activities', { method: 'POST', body }),
  completeActivity: (activityId: string, expectedRevision: number) =>
    jsonRequest<ActivityView>(`/crm/activities/${id(activityId)}/complete`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  reopenActivity: (activityId: string, expectedRevision: number) =>
    jsonRequest<ActivityView>(`/crm/activities/${id(activityId)}/reopen`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  updateActivity: (
    activityId: string,
    body: ActivityBody & { done: boolean; expectedRevision: number },
  ) => jsonRequest<ActivityView>(`/crm/activities/${id(activityId)}`, { method: 'PUT', body }),
  deleteActivity: (activityId: string) =>
    jsonRequest<void>(`/crm/activities/${id(activityId)}`, { method: 'DELETE' }),

  // ─── Devis ────────────────────────────────────────────────────────────────
  listQuotes: (query: ListQuotesQuery = {}) =>
    jsonRequest<Page<QuoteSummary>>(`/sales/quotes${salesQuery(query)}`, { method: 'GET' }),
  getQuote: (quoteId: string) =>
    jsonRequest<QuoteView>(`/sales/quotes/${id(quoteId)}`, { method: 'GET' }),
  /** ADR-0040 § 3.3 : devis brouillon prérempli (`sales.quote` + `crm.read`). */
  createQuoteFromOpportunity: (opportunityId: string, validUntil: string | null = null) =>
    jsonRequest<QuoteView>('/sales/quotes/from-opportunity', {
      method: 'POST',
      body: { opportunityId, validUntil },
    }),
  createQuote: (body: QuoteBody) =>
    jsonRequest<QuoteView>('/sales/quotes', { method: 'POST', body }),
  updateQuote: (quoteId: string, body: QuoteBody & { expectedRevision: number }) =>
    jsonRequest<QuoteView>(`/sales/quotes/${id(quoteId)}`, { method: 'PUT', body }),
  deleteQuote: (quoteId: string) =>
    jsonRequest<void>(`/sales/quotes/${id(quoteId)}`, { method: 'DELETE' }),
  quoteAction: (
    quoteId: string,
    action: 'send' | 'accept' | 'new-version',
    expectedRevision: number,
  ) =>
    jsonRequest<QuoteView>(`/sales/quotes/${id(quoteId)}/${action}`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  refuseQuote: (quoteId: string, expectedRevision: number, reason: string | null) =>
    jsonRequest<QuoteView>(`/sales/quotes/${id(quoteId)}/refuse`, {
      method: 'POST',
      body: { expectedRevision, reason },
    }),
  convertQuote: (quoteId: string, expectedRevision: number) =>
    jsonRequest<QuoteConversionResult>(`/sales/quotes/${id(quoteId)}/convert`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  downloadQuotePdf: (quoteId: string, fallbackName: string) =>
    download(`/sales/quotes/${id(quoteId)}/pdf`, fallbackName),
  /** ADR-0042 : préremplissage (`sales.quote`) et envoi par e-mail, PDF joint. */
  getQuoteEmailDraft: (quoteId: string) =>
    jsonRequest<DocumentEmailDraft>(`/sales/quotes/${id(quoteId)}/email`, { method: 'GET' }),
  sendQuoteEmail: (quoteId: string, body: DocumentEmailInput) =>
    jsonRequest<DocumentEmailResult>(`/sales/quotes/${id(quoteId)}/email`, {
      method: 'POST',
      body,
    }),
};
