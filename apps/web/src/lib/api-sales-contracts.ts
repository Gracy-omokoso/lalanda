// Client de l'API des commandes clients, contrats, avenants, acomptes et échéanciers —
// ADR-0050 § 3 (lot V7).
//
// Fichier voisin de `api.ts` (même `jsonRequest`, mêmes erreurs). AUCUN montant ni
// aucune date n'est calculé ici : totaux, restes à facturer, termes, dates limites de
// préavis et échéances viennent de l'API (moteurs `invoice-totals` et `contracts`).
//
// Les unions fermées et les corps viennent de `@lalanda/shared/sales-contracts` (lot V0).
// Les VUES rendues par l'API (lots V2 à V5) n'ont pas de contrat partagé : les formes
// ci-dessous recopient au plus près celles des services de `apps/api/src/sales/contracts/`,
// qui restent la source de vérité — le web n'importe ni de l'API ni du moteur.
//
// Aucune route d'ÉMISSION ici : les brouillons préparés s'ouvrent dans l'écran des
// factures, qui garde « Émettre » et « Normaliser » sous `sales.invoice`.

import type {
  SalesContractAmendmentPurpose,
  SalesContractAmendmentStatus,
  SalesContractBillingFrequency,
  SalesContractBillingKind,
  SalesContractBillingTiming,
  SalesContractFileKind,
  SalesContractNoticeCheck,
  SalesContractOccurrenceBlock,
  SalesContractOccurrenceStatus,
  SalesContractRenewalMode,
  SalesContractRenewalRecordMode,
  SalesContractSettingsValues,
  SalesContractSignatorySide,
  SalesContractStatus,
  SalesContractTerminationParty,
  SalesDepositInvoiceType,
  SalesEngagementInvoiceType,
  SalesOrderInvoicingStatus,
  SalesOrderStatus,
} from '@lalanda/shared/sales-contracts';

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

export type {
  SalesContractBillingKind,
  SalesContractStatus,
  SalesOrderStatus,
} from '@lalanda/shared/sales-contracts';

type DecimalString = string;
type Jour = string;

export interface EngagementWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Ligne d'un engagement : la ligne du document de vente + sa clé stable (`L1`, `L2`…). */
export type EngagementLineView = InvoiceLineView & { lineRef: string };

export interface EngagementDocumentAmounts {
  currency: DocumentCurrency;
  calculation: InvoiceCalculationView;
}

/** Pièce PDF téléversée (copie signée, copie de travail, bon de commande du client). */
export interface SalesContractFileView {
  id: string;
  kind: SalesContractFileKind;
  amendmentId: string | null;
  fileName: string;
  contentType: 'application/pdf';
  size: number;
  sha256: string;
  uploadedBy: string;
  uploadedAt: string;
}

/** Facture liée (brouillon ou émise), lue des factures existantes. */
export interface LinkedInvoiceView {
  invoiceId: string;
  kind: string;
  type: string;
  status: string;
  state: 'draft' | 'issued';
  reference: string | null;
  currency: DocumentCurrency;
  total: DecimalString | null;
  linkedAt: string;
}

/** Document de vente d'un engagement, au corps du brouillon de facture. */
export interface EngagementDocumentBody {
  currency: DocumentCurrency;
  priceMode: InvoicePriceMode;
  customer: InvoiceCustomerBody;
  lines: readonly InvoiceLineBody[];
}

// ─── Commandes clients (§ 2.2, lot V2) ──────────────────────────────────────

export type SalesOrderSource =
  | { kind: 'quote'; quoteId: string; quoteVersion: number }
  | { kind: 'contract'; contractId: string }
  | null;

export interface SalesOrderSummary {
  id: string;
  number: string;
  status: SalesOrderStatus;
  statusLabel: string;
  customerId: string;
  customerName: string | null;
  customerReference: string | null;
  orderedOn: Jour;
  source: SalesOrderSource;
  opportunityId: string | null;
  currency: DocumentCurrency;
  priceMode: InvoicePriceMode;
  total: DecimalString | null;
  invoicingStatus: SalesOrderInvoicingStatus | null;
  invoicingLabel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderInvoicingLine {
  lineRef: string;
  ordered: DecimalString;
  invoiced: DecimalString;
  inDraft: DecimalString;
  remainingToInvoice: DecimalString;
  remainingToPrepare: DecimalString;
  overInvoiced: DecimalString;
}

export interface OrderInvoicingIssue {
  code: string;
  invoiceId: string | null;
  lineRef: string | null;
  invoiceLineIndex: number | null;
}

export interface OrderInvoicingView {
  version: string;
  status: SalesOrderInvoicingStatus;
  closeSuggested: boolean;
  lines: OrderInvoicingLine[];
  issues: OrderInvoicingIssue[];
}

export interface SalesOrderActions {
  edit: boolean;
  delete: boolean;
  confirm: boolean;
  close: boolean;
  closeSuggested: boolean;
  cancel: boolean;
  prepareInvoice: boolean;
  addFile: boolean;
}

export interface SalesOrderView extends SalesOrderSummary {
  customer: InvoiceCustomerView;
  lines: (EngagementLineView & { amount: DecimalString | null })[];
  lineInputs: InvoiceLineBody[];
  documentAmounts: EngagementDocumentAmounts;
  requestedDeliveryDate: Jour | null;
  notes: string | null;
  confirmedAt: string | null;
  closure: { at: string; by: string; reason: string } | null;
  cancellation: { at: string; by: string; reason: string } | null;
  invoicing: OrderInvoicingView | null;
  invoices: LinkedInvoiceView[];
  files: SalesContractFileView[];
  actions: SalesOrderActions;
  blockers: { code: string; message: string; lineIndex: number | null }[];
  warnings: EngagementWarning[];
  revision: number;
}

export interface SalesOrderPage {
  items: SalesOrderSummary[];
  nextCursor: string | null;
}

export interface SalesOrderBody extends EngagementDocumentBody {
  customerReference: string | null;
  orderedOn: Jour;
  opportunityId: string | null;
  requestedDeliveryDate: Jour | null;
  notes: string | null;
}

export interface ListOrdersParams {
  status?: SalesOrderStatus | 'all';
  customerId?: string;
  quoteId?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

export interface QuoteToOrderBody {
  orderedOn?: Jour;
  customerReference?: string | null;
  requestedDeliveryDate?: Jour | null;
  notes?: string | null;
}

export interface PrepareOrderInvoiceBody {
  expectedRevision: number;
  type?: SalesEngagementInvoiceType;
  lines?: { lineRef: string; quantity: DecimalString }[];
}

// ─── Contrats (§ 2.3, lot V3) ───────────────────────────────────────────────

export interface RenewalClause {
  mode: SalesContractRenewalMode;
  periodMonths: number | null;
  maxRenewals: number | null;
}

export interface ScheduleItemView {
  itemRef: string;
  dueDate: Jour;
  label: string;
  lines: EngagementLineView[];
  documentAmounts: EngagementDocumentAmounts;
}

export type ContractBillingView =
  | { kind: 'none' }
  | { kind: 'schedule'; items: ScheduleItemView[] }
  | {
      kind: 'recurring';
      frequency: SalesContractBillingFrequency;
      anchorDate: Jour;
      timing: SalesContractBillingTiming;
      autoPrepare: boolean;
    };

/** Échéancier au corps d'une requête : lignes d'une échéance au corps du brouillon. */
export type ContractBillingBody =
  | { kind: 'none' }
  | {
      kind: 'schedule';
      items: { itemRef: string; dueDate: Jour; label: string; lines: readonly InvoiceLineBody[] }[];
    }
  | {
      kind: 'recurring';
      frequency: SalesContractBillingFrequency;
      anchorDate: Jour;
      timing: SalesContractBillingTiming;
      autoPrepare: boolean;
    };

export interface ApprovalView {
  userId: string;
  decision: 'approved' | 'rejected';
  at: string;
  comment: string | null;
  soleApprover: boolean;
}

export interface SignatureView {
  signedOn: Jour;
  signatories: { name: string; title: string | null; side: SalesContractSignatorySide }[];
  fileId: string;
  declaredBy: string;
  declaredAt: string;
}

export interface ContractTerm {
  index: number;
  from: Jour;
  to: Jour | null;
  origin: 'initial' | 'tacit_recorded' | 'explicit_amendment';
}

export interface SalesContractTermsView {
  on: Jour;
  inForce: {
    initialTermMonths: number | null;
    renewal: RenewalClause;
    noticeDays: number;
    clauses: string | null;
    billingKind: SalesContractBillingKind;
    lines: EngagementLineView[];
    appliedAmendments: number[];
    pendingAmendments: number[];
  };
  currentTerm: ContractTerm;
  terms: ContractTerm[];
  termElapsed: boolean;
  lastTermEnd: Jour | null;
  noticeDeadline: Jour | null;
  proposedNextTerm: ContractTerm | null;
  billableUntil: Jour | null;
  renewalsRecorded: number;
  issues: { code: string; termIndex: number | null }[];
  conventions: string[];
}

export interface SalesContractSummary {
  id: string;
  number: string;
  version: number;
  title: string;
  status: SalesContractStatus;
  statusLabel: string;
  derivedStatus: string | null;
  derivedStatusLabel: string | null;
  customerId: string;
  customerName: string | null;
  ownerUserId: string;
  opportunityId: string | null;
  source: { kind: 'quote'; quoteId: string; quoteVersion: number } | null;
  startDate: Jour;
  billingKind: SalesContractBillingKind;
  currency: DocumentCurrency;
  priceMode: InvoicePriceMode;
  total: DecimalString | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface SalesContractAmendmentSummary {
  id: string;
  index: number;
  number: string;
  effectiveDate: Jour;
  purpose: SalesContractAmendmentPurpose;
  status: SalesContractAmendmentStatus;
  statusLabel: string;
  revision: number;
}

export interface SalesContractActions {
  edit: boolean;
  delete: boolean;
  submit: boolean;
  newVersion: boolean;
  cancel: boolean;
  approve: boolean;
  reject: boolean;
  declareSignature: boolean;
  addFile: boolean;
  terminate: boolean;
  recordRenewal: boolean;
  addAmendment: boolean;
}

export interface SalesContractView extends SalesContractSummary {
  customer: InvoiceCustomerView;
  lines: (EngagementLineView & { amount: DecimalString | null })[];
  lineInputs: InvoiceLineBody[];
  documentAmounts: EngagementDocumentAmounts;
  initialTermMonths: number | null;
  renewal: RenewalClause;
  noticeDays: number;
  billing: ContractBillingView;
  clauses: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  approvals: ApprovalView[];
  signature: SignatureView | null;
  renewals: {
    termIndex: number;
    from: Jour;
    to: Jour | null;
    recordedBy: string;
    recordedAt: string;
    mode: SalesContractRenewalRecordMode;
  }[];
  termination: {
    noticeGivenOn: Jour;
    by: SalesContractTerminationParty;
    effectiveOn: Jour;
    reason: string;
    recordedBy: string;
    recordedAt: string;
    noticeCheck: SalesContractNoticeCheck;
    noticeCheckLabel: string;
  } | null;
  cancellation: { at: string; by: string; reason: string } | null;
  projectId: string | null;
  contentSha256: string | null;
  previousVersions: {
    version: number;
    status: SalesContractStatus;
    archivedAt: string;
    archivedBy: string;
    total: DecimalString | null;
  }[];
  amendments: SalesContractAmendmentSummary[];
  terms: SalesContractTermsView | null;
  files: SalesContractFileView[];
  actions: SalesContractActions;
  blockers: { code: string; message: string; lineIndex: number | null; path: string | null }[];
  warnings: EngagementWarning[];
  banner: string;
}

export interface SalesContractPage {
  items: SalesContractSummary[];
  nextCursor: string | null;
}

export interface SalesContractWithWarnings {
  contract: SalesContractView;
  warnings: EngagementWarning[];
}

/** Clauses d'un contrat SAISIES par l'utilisateur (§ 2.3). */
export interface ContractClausesBody {
  startDate: Jour;
  initialTermMonths: number | null;
  renewal: RenewalClause;
  noticeDays: number;
  billing: ContractBillingBody;
  clauses: string | null;
}

export interface SalesContractBody extends EngagementDocumentBody, ContractClausesBody {
  title: string;
  opportunityId: string | null;
  ownerUserId: string | null;
}

export interface QuoteToContractBody extends ContractClausesBody {
  title?: string;
  ownerUserId?: string | null;
}

export interface ListContractsParams {
  status?: SalesContractStatus | 'all';
  billingKind?: SalesContractBillingKind;
  customerId?: string;
  quoteId?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

export interface SignatureBody {
  expectedRevision: number;
  signedOn: Jour;
  signatories: { name: string; title: string | null; side: SalesContractSignatorySide }[];
  fileId: string | null;
}

export interface TerminateBody {
  expectedRevision: number;
  noticeGivenOn: Jour;
  by: SalesContractTerminationParty;
  effectiveOn: Jour;
  reason: string;
}

// ─── Avenants (§ 2.5) ───────────────────────────────────────────────────────

export interface AmendmentChangesBody {
  lines?: readonly InvoiceLineBody[];
  billing?: ContractBillingBody;
  initialTermMonths?: number | null;
  renewal?: RenewalClause;
  noticeDays?: number;
  clauses?: string | null;
}

export interface AmendmentBody {
  expectedRevision?: number;
  effectiveDate: Jour;
  purpose: SalesContractAmendmentPurpose;
  changes: AmendmentChangesBody;
}

export interface SalesContractAmendmentActions {
  edit: boolean;
  submit: boolean;
  cancel: boolean;
  approve: boolean;
  reject: boolean;
  declareSignature: boolean;
  addFile: boolean;
}

export interface SalesContractAmendmentView {
  id: string;
  contractId: string;
  index: number;
  number: string;
  effectiveDate: Jour;
  purpose: SalesContractAmendmentPurpose;
  changes: {
    lines?: EngagementLineView[];
    billing?: ContractBillingView;
    initialTermMonths?: number | null;
    renewal?: RenewalClause;
    noticeDays?: number;
    clauses?: string | null;
  };
  status: SalesContractAmendmentStatus;
  statusLabel: string;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvals: ApprovalView[];
  signature: SignatureView | null;
  cancellation: { at: string; by: string; reason: string } | null;
  contentSha256: string | null;
  files: SalesContractFileView[];
  actions: SalesContractAmendmentActions;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

// ─── Acomptes (§ 5.1, § 5.2, lot V4) ────────────────────────────────────────

export interface SalesDepositLineView {
  invoiceId: string;
  type: string;
  status: string;
  state: 'draft' | 'issued';
  reference: string | null;
  recallCode: string | null;
  currency: DocumentCurrency;
  total: DecimalString | null;
  paid: DecimalString | null;
  requestedAmount: DecimalString | null;
  gapToRequested: string | null;
  resolved: boolean;
  resolution: { reason: string; resolvedBy: string; resolvedAt: string } | null;
  linkedAt: string;
}

export interface SalesDepositsView {
  owner: { kind: 'order' | 'contract'; id: string; number: string; revision: number };
  available: boolean;
  deposits: SalesDepositLineView[];
  byCurrency: {
    currency: DocumentCurrency;
    requested: DecimalString;
    invoiced: DecimalString;
    inDraft: DecimalString;
    paid: DecimalString;
  }[];
  finals: {
    invoiceId: string;
    kind: string;
    state: 'draft' | 'issued';
    reference: string | null;
  }[];
  unresolved: string[];
  issues: { code: string; invoiceIds: string[] }[];
  warning: string | null;
  engineVersion: string | null;
}

export interface PrepareDepositBody {
  expectedRevision: number;
  type: SalesDepositInvoiceType;
  requestedAmount: DecimalString;
  /** Choisi par l'utilisateur, JAMAIS prérempli (EC2, décision ouverte n° 12). */
  taxGroup: string;
  label?: string | null;
}

export interface PreparedDeposit {
  invoiceId: string;
  warnings: EngagementWarning[];
  deposits: SalesDepositsView;
}

// ─── Échéancier (§ 2.4, § 5.3, lot V5) ──────────────────────────────────────

export interface SalesOccurrenceView {
  key: string;
  kind: 'schedule_item' | 'subscription_occurrence';
  date: Jour;
  itemRef: string | null;
  label: string | null;
  periodStart: Jour | null;
  periodEnd: Jour | null;
  periodExceedsBounds: boolean;
  state: SalesContractOccurrenceStatus;
  stateLabel: string;
  invoice: {
    invoiceId: string;
    type: string;
    status: string;
    reference: string | null;
    currency: DocumentCurrency;
    total: DecimalString | null;
  } | null;
  reasons: { code: SalesContractOccurrenceBlock; message: string }[];
  autoPrepare: boolean;
}

export interface SalesContractScheduleView {
  contractId: string;
  number: string;
  status: SalesContractStatus;
  billingKind: SalesContractBillingKind;
  today: Jour;
  window: { from: Jour; to: Jour };
  leadDays: number;
  catchUpFrom: Jour;
  autoPrepareEnabled: boolean;
  billableUntil: Jour | null;
  entries: SalesOccurrenceView[];
  warnings: EngagementWarning[];
}

export interface PreparedOccurrence {
  invoiceId: string;
  warnings: EngagementWarning[];
  occurrence: SalesOccurrenceView;
}

// ─── Réglages (§ 2.1) ───────────────────────────────────────────────────────

export interface SalesContractSettingsView extends SalesContractSettingsValues {
  revision: number | null;
  updatedAt: string | null;
}

export interface SalesContractSettingsBody extends SalesContractSettingsValues {
  expectedRevision: number | null;
}

// ─── Client ─────────────────────────────────────────────────────────────────

const id = encodeURIComponent;

function erreurHttp(status: number, text: string): Error & { status: number; detail: unknown } {
  let detail: unknown = text;
  try {
    detail = JSON.parse(text);
  } catch {
    /* garde le texte brut */
  }
  const err = new Error(
    typeof detail === 'object' && detail !== null && 'message' in detail
      ? String((detail as { message: unknown }).message)
      : `HTTP ${status}`,
  ) as Error & { status: number; detail: unknown };
  err.status = status;
  err.detail = detail;
  return err;
}

/** Pièce PDF : corps binaire brut, nom en `X-File-Name` encodé URI. */
async function envoyerPiece<T>(chemin: string, file: File): Promise<T> {
  const res = await fetch(`${API_URL}${chemin}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': file.type || 'application/pdf',
      'x-file-name': encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!res.ok) throw erreurHttp(res.status, await res.text());
  return (await res.json()) as T;
}

/** Octets d'une pièce (servie inerte, en téléchargement) : le web en fait une URL locale. */
async function lirePiece(
  chemin: string,
  nomDeRepli: string,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${API_URL}${chemin}`, { method: 'GET', credentials: 'include' });
  if (!res.ok) throw erreurHttp(res.status, await res.text());
  const match = (res.headers.get('content-disposition') ?? '').match(/filename="([^"]+)"/);
  return { blob: await res.blob(), filename: match?.[1] ?? nomDeRepli };
}

const post = <T>(chemin: string, body: unknown = {}): Promise<T> =>
  jsonRequest<T>(chemin, { method: 'POST', body });

export const salesContractsApi = {
  // Commandes clients
  listOrders: (params: ListOrdersParams = {}) =>
    jsonRequest<SalesOrderPage>(`/sales/orders${salesQuery(params)}`, { method: 'GET' }),
  getOrder: (orderId: string) =>
    jsonRequest<SalesOrderView>(`/sales/orders/${id(orderId)}`, { method: 'GET' }),
  createOrder: (body: SalesOrderBody) => post<SalesOrderView>('/sales/orders', body),
  updateOrder: (orderId: string, body: SalesOrderBody & { expectedRevision: number }) =>
    jsonRequest<SalesOrderView>(`/sales/orders/${id(orderId)}`, { method: 'PUT', body }),
  deleteOrder: (orderId: string) =>
    jsonRequest<void>(`/sales/orders/${id(orderId)}`, { method: 'DELETE' }),
  confirmOrder: (orderId: string, expectedRevision: number) =>
    post<SalesOrderView>(`/sales/orders/${id(orderId)}/confirm`, { expectedRevision }),
  closeOrder: (orderId: string, expectedRevision: number, reason: string) =>
    post<SalesOrderView>(`/sales/orders/${id(orderId)}/close`, { expectedRevision, reason }),
  cancelOrder: (orderId: string, expectedRevision: number, reason: string) =>
    post<SalesOrderView>(`/sales/orders/${id(orderId)}/cancel`, { expectedRevision, reason }),
  prepareOrderInvoice: (orderId: string, body: PrepareOrderInvoiceBody) =>
    post<{ invoiceId: string; warnings: EngagementWarning[]; order: SalesOrderView }>(
      `/sales/orders/${id(orderId)}/prepare-invoice`,
      body,
    ),
  addOrderFile: (orderId: string, file: File) =>
    envoyerPiece<SalesContractFileView>(`/sales/orders/${id(orderId)}/files`, file),
  readOrderFile: (orderId: string, fileId: string, nom: string) =>
    lirePiece(`/sales/orders/${id(orderId)}/files/${id(fileId)}`, nom),
  quoteToOrder: (quoteId: string, body: QuoteToOrderBody = {}) =>
    post<{ order: SalesOrderView; warnings: EngagementWarning[] }>(
      `/sales/quotes/${id(quoteId)}/to-order`,
      body,
    ),

  // Contrats
  listContracts: (params: ListContractsParams = {}) =>
    jsonRequest<SalesContractPage>(`/sales/contracts${salesQuery(params)}`, { method: 'GET' }),
  getContract: (contractId: string) =>
    jsonRequest<SalesContractView>(`/sales/contracts/${id(contractId)}`, { method: 'GET' }),
  createContract: (body: SalesContractBody) => post<SalesContractView>('/sales/contracts', body),
  updateContract: (contractId: string, body: SalesContractBody & { expectedRevision: number }) =>
    jsonRequest<SalesContractView>(`/sales/contracts/${id(contractId)}`, { method: 'PUT', body }),
  deleteContract: (contractId: string) =>
    jsonRequest<void>(`/sales/contracts/${id(contractId)}`, { method: 'DELETE' }),
  contractAction: (
    contractId: string,
    action: 'submit' | 'new-version' | 'renewals',
    expectedRevision: number,
  ) =>
    post<SalesContractView>(`/sales/contracts/${id(contractId)}/${action}`, { expectedRevision }),
  cancelContract: (contractId: string, expectedRevision: number, reason: string) =>
    post<SalesContractView>(`/sales/contracts/${id(contractId)}/cancel`, {
      expectedRevision,
      reason,
    }),
  approveContract: (contractId: string, expectedRevision: number, comment: string | null) =>
    post<SalesContractView>(`/sales/contracts/${id(contractId)}/approve`, {
      expectedRevision,
      ...(comment ? { comment } : {}),
    }),
  rejectContract: (contractId: string, expectedRevision: number, comment: string) =>
    post<SalesContractView>(`/sales/contracts/${id(contractId)}/reject`, {
      expectedRevision,
      comment,
    }),
  declareContractSignature: (contractId: string, body: SignatureBody) =>
    post<SalesContractView>(`/sales/contracts/${id(contractId)}/signature`, body),
  terminateContract: (contractId: string, body: TerminateBody) =>
    post<SalesContractWithWarnings>(`/sales/contracts/${id(contractId)}/terminate`, body),
  addContractFile: (
    contractId: string,
    file: File,
    kind: 'draft_copy' | 'signed_copy',
    amendmentId: string | null = null,
  ) =>
    envoyerPiece<SalesContractFileView>(
      `/sales/contracts/${id(contractId)}/files${salesQuery({
        kind,
        ...(amendmentId ? { amendmentId } : {}),
      })}`,
      file,
    ),
  readContractFile: (contractId: string, fileId: string, nom: string) =>
    lirePiece(`/sales/contracts/${id(contractId)}/files/${id(fileId)}`, nom),
  quoteToContract: (quoteId: string, body: QuoteToContractBody) =>
    post<SalesContractWithWarnings>(`/sales/quotes/${id(quoteId)}/to-contract`, body),

  // Avenants
  listAmendments: (contractId: string) =>
    jsonRequest<{ items: SalesContractAmendmentView[] }>(
      `/sales/contracts/${id(contractId)}/amendments`,
      { method: 'GET' },
    ),
  createAmendment: (contractId: string, body: AmendmentBody) =>
    post<SalesContractAmendmentView>(`/sales/contracts/${id(contractId)}/amendments`, body),
  updateAmendment: (contractId: string, amendmentId: string, body: AmendmentBody) =>
    jsonRequest<SalesContractAmendmentView>(
      `/sales/contracts/${id(contractId)}/amendments/${id(amendmentId)}`,
      { method: 'PUT', body },
    ),
  submitAmendment: (contractId: string, amendmentId: string, expectedRevision: number) =>
    post<SalesContractAmendmentView>(
      `/sales/contracts/${id(contractId)}/amendments/${id(amendmentId)}/submit`,
      { expectedRevision },
    ),
  cancelAmendment: (
    contractId: string,
    amendmentId: string,
    expectedRevision: number,
    reason: string,
  ) =>
    post<SalesContractAmendmentView>(
      `/sales/contracts/${id(contractId)}/amendments/${id(amendmentId)}/cancel`,
      { expectedRevision, reason },
    ),
  approveAmendment: (
    contractId: string,
    amendmentId: string,
    expectedRevision: number,
    comment: string | null,
  ) =>
    post<SalesContractAmendmentView>(
      `/sales/contracts/${id(contractId)}/amendments/${id(amendmentId)}/approve`,
      { expectedRevision, ...(comment ? { comment } : {}) },
    ),
  rejectAmendment: (
    contractId: string,
    amendmentId: string,
    expectedRevision: number,
    comment: string,
  ) =>
    post<SalesContractAmendmentView>(
      `/sales/contracts/${id(contractId)}/amendments/${id(amendmentId)}/reject`,
      { expectedRevision, comment },
    ),
  declareAmendmentSignature: (contractId: string, amendmentId: string, body: SignatureBody) =>
    post<SalesContractAmendmentView>(
      `/sales/contracts/${id(contractId)}/amendments/${id(amendmentId)}/signature`,
      body,
    ),

  // Acomptes (commande ou contrat)
  getDeposits: (owner: 'orders' | 'contracts', ownerId: string) =>
    jsonRequest<SalesDepositsView>(`/sales/${owner}/${id(ownerId)}/deposits`, { method: 'GET' }),
  prepareDeposit: (owner: 'orders' | 'contracts', ownerId: string, body: PrepareDepositBody) =>
    post<PreparedDeposit>(`/sales/${owner}/${id(ownerId)}/prepare-deposit`, body),
  resolveDeposit: (
    owner: 'orders' | 'contracts',
    ownerId: string,
    invoiceId: string,
    expectedRevision: number,
    reason: string,
  ) =>
    post<SalesDepositsView>(`/sales/${owner}/${id(ownerId)}/deposits/${id(invoiceId)}/resolved`, {
      expectedRevision,
      reason,
    }),

  // Échéancier
  getSchedule: (contractId: string) =>
    jsonRequest<SalesContractScheduleView>(`/sales/contracts/${id(contractId)}/schedule`, {
      method: 'GET',
    }),
  prepareOccurrence: (contractId: string, key: string, type: SalesEngagementInvoiceType = 'FV') =>
    post<PreparedOccurrence>(`/sales/contracts/${id(contractId)}/occurrences/${id(key)}/prepare`, {
      type,
    }),

  // Réglages
  getSettings: () =>
    jsonRequest<SalesContractSettingsView>('/sales/contract-settings', { method: 'GET' }),
  putSettings: (body: SalesContractSettingsBody) =>
    jsonRequest<SalesContractSettingsView>('/sales/contract-settings', { method: 'PUT', body }),
};
