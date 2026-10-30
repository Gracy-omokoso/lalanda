// Client de l'API des achats, deuxième partie — ADR-0044 § 3.4 à § 3.6 (lot P8) :
// réceptions, factures fournisseurs et rapprochement, échéancier, paiements et
// doublons probables.
//
// Fichier voisin de `api.ts` et `api-purchases.ts` (même `jsonRequest`, mêmes
// erreurs). AUCUN montant n'est calculé ici : restes à payer, rapprochement et
// échéancier viennent de l'API (moteur `@lalanda/engine`, module `purchases`).
//
// Contrats : réceptions et factures reprennent `@lalanda/shared/purchases` (lot P4).
// Paiements, échéancier et
// doublons reprennent ceux du lot P5. Une route absente ou refusée donne une
// phrase à l'écran, jamais un chiffre inventé.

import type {
  CreatePurchaseReceptionBody,
  CreateSupplierInvoiceBody,
  PurchaseMatchingStatus,
  PurchaseOrderDetailView,
  PurchaseReceptionPage,
  PurchaseReceptionView,
  PurchaseReceptionWriteResult,
  SupplierInvoiceDueFilter,
  SupplierInvoicePage,
  SupplierInvoicePrefill,
  SupplierInvoiceStatus,
  SupplierInvoiceView,
  CreateSupplierPaymentBody,
  PayablesScheduleCurrencyView,
  PayablesView,
  PurchaseDuplicatesView,
  SupplierPaymentAllocationInput,
  SupplierPaymentFromExpenseBody,
  SupplierPaymentPage,
  SupplierPaymentView,
} from '@lalanda/shared/purchases';

import { API_URL, jsonRequest, salesQuery } from './api';

export type {
  PurchaseOrderDetailView,
  PurchaseReceptionView,
  PurchaseReceptionWriteResult,
  SupplierInvoiceListItem,
  SupplierInvoicePrefill,
  SupplierInvoiceVarianceView,
  SupplierInvoiceView,
  PayableInvoiceItem,
  PayablesView,
  PossibleDuplicateView,
  PurchaseDuplicatesView,
  SupplierPaymentListItem,
  SupplierPaymentView,
} from '@lalanda/shared/purchases';

/** Erreur au format de `jsonRequest` (status, detail), pour les appels binaires. */
async function erreurHttp(res: Response): Promise<Error & { status: number; detail: unknown }> {
  const text = await res.text();
  let detail: unknown = text;
  try {
    detail = JSON.parse(text);
  } catch {
    /* garde le texte brut */
  }
  const message =
    typeof detail === 'object' && detail !== null && 'message' in detail
      ? String((detail as { message: unknown }).message)
      : `HTTP ${res.status}`;
  const err = new Error(message) as Error & { status: number; detail: unknown };
  err.status = res.status;
  err.detail = detail;
  return err;
}

const id = encodeURIComponent;

/** Pièce jointe : corps binaire brut, nom en `X-File-Name` encodé URI (§ 2.7). */
async function envoyerPiece<T>(chemin: string, file: File): Promise<T> {
  const res = await fetch(`${API_URL}${chemin}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!res.ok) throw await erreurHttp(res);
  return (await res.json()) as T;
}

/** Octets d'une pièce (servie inerte, en téléchargement) : le web en fait un lien local. */
async function lirePiece(chemin: string): Promise<Blob> {
  const res = await fetch(`${API_URL}${chemin}`, { method: 'GET', credentials: 'include' });
  if (!res.ok) throw await erreurHttp(res);
  return res.blob();
}

// ─── Réceptions (§ 3.4) ─────────────────────────────────────────────────────

export interface ListReceptionsParams {
  orderId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

// ─── Factures fournisseurs (§ 3.5) ──────────────────────────────────────────

export interface ListInvoicesParams {
  status?: SupplierInvoiceStatus;
  supplierId?: string;
  orderId?: string;
  due?: SupplierInvoiceDueFilter;
  matching?: PurchaseMatchingStatus;
  disputed?: 'true' | 'false';
  cursor?: string;
  limit?: number;
}

/** Corps tel que le web l'envoie (forme d'entrée du contrat P4). */
export type SupplierInvoiceInput = {
  [K in keyof CreateSupplierInvoiceBody]?: CreateSupplierInvoiceBody[K] | undefined;
} & Pick<
  CreateSupplierInvoiceBody,
  'supplierId' | 'supplierReference' | 'invoiceDate' | 'currency' | 'total'
>;

export type ReceptionInput = CreatePurchaseReceptionBody;

// ─── Échéancier, paiements et doublons (§ 2.6, § 3.6) — contrats du lot P5 ──

/** Échéancier du moteur (`GET /purchases/payables`), une devise par entrée. */
export type EcheancierView = PayablesView;
export type EcheancierDeviseView = PayablesScheduleCurrencyView;

/** Corps de `POST /purchases/payments` (la devise est celle des factures imputées). */
export type CreateSupplierPaymentInput = Omit<CreateSupplierPaymentBody, 'paymentMethodId'>;
export type PaymentAllocationInput = SupplierPaymentAllocationInput;
export type PaymentFromExpenseInput = SupplierPaymentFromExpenseBody;

// ─── Client ─────────────────────────────────────────────────────────────────

export const purchasesPayablesApi = {
  // Commande avec ses réceptions et factures (§ 3.2, vue enrichie par P4)
  getOrderDetail: (orderId: string) =>
    jsonRequest<PurchaseOrderDetailView>(`/purchases/orders/${id(orderId)}`, { method: 'GET' }),

  // Réceptions (§ 3.4)
  listReceptions: (params: ListReceptionsParams = {}) =>
    jsonRequest<PurchaseReceptionPage>(`/purchases/receptions${salesQuery(params)}`, {
      method: 'GET',
    }),
  getReception: (receptionId: string) =>
    jsonRequest<PurchaseReceptionView>(`/purchases/receptions/${id(receptionId)}`, {
      method: 'GET',
    }),
  createReception: (body: ReceptionInput) =>
    jsonRequest<PurchaseReceptionWriteResult>('/purchases/receptions', { method: 'POST', body }),
  cancelReception: (receptionId: string, body: { reason: string; expectedRevision: number }) =>
    jsonRequest<PurchaseReceptionWriteResult>(`/purchases/receptions/${id(receptionId)}/cancel`, {
      method: 'POST',
      body,
    }),
  uploadReceptionAttachment: (receptionId: string, file: File) =>
    envoyerPiece<PurchaseReceptionView>(
      `/purchases/receptions/${id(receptionId)}/attachment`,
      file,
    ),
  downloadReceptionAttachment: (receptionId: string) =>
    lirePiece(`/purchases/receptions/${id(receptionId)}/attachment`),

  // Factures fournisseurs (§ 3.5)
  listInvoices: (params: ListInvoicesParams = {}) =>
    jsonRequest<SupplierInvoicePage>(`/purchases/invoices${salesQuery(params)}`, {
      method: 'GET',
    }),
  getInvoice: (invoiceId: string) =>
    jsonRequest<SupplierInvoiceView>(`/purchases/invoices/${id(invoiceId)}`, { method: 'GET' }),
  createInvoice: (body: SupplierInvoiceInput) =>
    jsonRequest<SupplierInvoiceView>('/purchases/invoices', { method: 'POST', body }),
  prefillFromOrder: (orderId: string) =>
    jsonRequest<SupplierInvoicePrefill>('/purchases/invoices/from-order', {
      method: 'POST',
      body: { orderId },
    }),
  validateInvoice: (invoiceId: string, expectedRevision: number) =>
    jsonRequest<SupplierInvoiceView>(`/purchases/invoices/${id(invoiceId)}/validate`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  forceValidateInvoice: (invoiceId: string, body: { reason: string; expectedRevision: number }) =>
    jsonRequest<SupplierInvoiceView>(`/purchases/invoices/${id(invoiceId)}/force-validate`, {
      method: 'POST',
      body,
    }),
  disputeInvoice: (invoiceId: string, body: { reason: string; expectedRevision: number }) =>
    jsonRequest<SupplierInvoiceView>(`/purchases/invoices/${id(invoiceId)}/dispute`, {
      method: 'POST',
      body,
    }),
  resolveInvoiceDispute: (invoiceId: string, expectedRevision: number) =>
    jsonRequest<SupplierInvoiceView>(`/purchases/invoices/${id(invoiceId)}/resolve-dispute`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  cancelInvoice: (invoiceId: string, body: { reason: string; expectedRevision: number }) =>
    jsonRequest<SupplierInvoiceView>(`/purchases/invoices/${id(invoiceId)}/cancel`, {
      method: 'POST',
      body,
    }),
  uploadInvoiceAttachment: (invoiceId: string, file: File) =>
    envoyerPiece<SupplierInvoiceView>(`/purchases/invoices/${id(invoiceId)}/attachment`, file),
  downloadInvoiceAttachment: (invoiceId: string) =>
    lirePiece(`/purchases/invoices/${id(invoiceId)}/attachment`),

  // Dettes et paiements (§ 3.6)
  getSchedule: (params: { asOf?: string; supplierId?: string } = {}) =>
    jsonRequest<EcheancierView>(`/purchases/payables${salesQuery(params)}`, { method: 'GET' }),
  listPayments: (
    params: {
      supplierId?: string;
      invoiceId?: string;
      from?: string;
      to?: string;
      cursor?: string;
      limit?: number;
    } = {},
  ) =>
    jsonRequest<SupplierPaymentPage>(`/purchases/payments${salesQuery(params)}`, {
      method: 'GET',
    }),
  getPayment: (paymentId: string) =>
    jsonRequest<SupplierPaymentView>(`/purchases/payments/${id(paymentId)}`, { method: 'GET' }),
  createPayment: (body: CreateSupplierPaymentInput) =>
    jsonRequest<SupplierPaymentView>('/purchases/payments', { method: 'POST', body }),
  paymentFromExpense: (body: PaymentFromExpenseInput) =>
    jsonRequest<SupplierPaymentView>('/purchases/payments/from-expense', { method: 'POST', body }),
  cancelPayment: (paymentId: string, body: { reason: string; expectedRevision: number }) =>
    jsonRequest<SupplierPaymentView>(`/purchases/payments/${id(paymentId)}/cancel`, {
      method: 'POST',
      body,
    }),
  listDuplicates: (params: { supplierId?: string } = {}) =>
    jsonRequest<PurchaseDuplicatesView>(`/purchases/duplicates${salesQuery(params)}`, {
      method: 'GET',
    }),
};
