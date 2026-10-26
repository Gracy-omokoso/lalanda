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
  type InvoiceCalculationView,
  type InvoiceCustomerBody,
  type InvoiceCustomerView,
  type InvoiceLineBody,
  type InvoiceLineView,
  type InvoicePriceMode,
} from './api';

type DecimalString = string;

// ─── CRM ─────────────────────────────────────────────────────────────────────

export type StageKind = 'open' | 'won' | 'lost';
export type OpportunityStatus = StageKind;

export interface PipelineStage {
  key: string;
  label: string;
  kind: StageKind;
}

export interface CrmSettingsView {
  stages: PipelineStage[];
  autoWinOnQuoteAccepted: boolean;
  staleAfterDays: number;
  /** 0 : réglages par défaut, jamais enregistrés. */
  revision: number;
  updatedAt: string | null;
}

export interface PutCrmSettingsBody {
  expectedRevision: number;
  stages: PipelineStage[];
  autoWinOnQuoteAccepted: boolean;
  staleAfterDays: number;
}

export interface ContactView {
  id: string;
  kind: 'customer_contact' | 'prospect';
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  customerId: string | null;
  customerName: string | null;
  companyName: string | null;
  notes: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContactBody {
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  customerId: string | null;
  companyName: string | null;
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
}

export interface OpportunityView extends OpportunitySummary {
  lostReason: string | null;
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
  customerId: string | null;
  prospectName: string | null;
  contactId: string | null;
  amount: DecimalString | null;
  currency: DocumentCurrency;
  expectedCloseDate: string | null;
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
  getPipeline: () => jsonRequest<PipelineView>('/crm/pipeline', { method: 'GET' }),

  listContacts: (query: {
    q?: string;
    kind?: 'all' | 'prospect' | 'customer_contact';
    customerId?: string;
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
    limit?: number;
    cursor?: string | null;
  }) =>
    jsonRequest<Page<OpportunitySummary>>(`/crm/opportunities${salesQuery(query)}`, {
      method: 'GET',
    }),
  getOpportunity: (opportunityId: string) =>
    jsonRequest<OpportunityView>(`/crm/opportunities/${id(opportunityId)}`, { method: 'GET' }),
  createOpportunity: (body: OpportunityBody & { stageKey?: string }) =>
    jsonRequest<OpportunityView>('/crm/opportunities', { method: 'POST', body }),
  updateOpportunity: (
    opportunityId: string,
    body: OpportunityBody & { expectedRevision: number },
  ) =>
    jsonRequest<OpportunityView>(`/crm/opportunities/${id(opportunityId)}`, {
      method: 'PUT',
      body,
    }),
  moveOpportunity: (
    opportunityId: string,
    body: { expectedRevision: number; stageKey: string; lostReason?: string | null },
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

  listActivities: (query: {
    status?: 'all' | 'open' | 'overdue' | 'done';
    opportunityId?: string;
    contactId?: string;
    limit?: number;
    cursor?: string | null;
  }) => jsonRequest<Page<ActivityView>>(`/crm/activities${salesQuery(query)}`, { method: 'GET' }),
  createActivity: (body: ActivityBody) =>
    jsonRequest<ActivityView>('/crm/activities', { method: 'POST', body }),
  completeActivity: (activityId: string, expectedRevision: number) =>
    jsonRequest<ActivityView>(`/crm/activities/${id(activityId)}/complete`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  deleteActivity: (activityId: string) =>
    jsonRequest<void>(`/crm/activities/${id(activityId)}`, { method: 'DELETE' }),

  // ─── Devis ────────────────────────────────────────────────────────────────
  listQuotes: (query: ListQuotesQuery = {}) =>
    jsonRequest<Page<QuoteSummary>>(`/sales/quotes${salesQuery(query)}`, { method: 'GET' }),
  getQuote: (quoteId: string) =>
    jsonRequest<QuoteView>(`/sales/quotes/${id(quoteId)}`, { method: 'GET' }),
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
};
