// Client de l'API des achats, deuxième partie — ADR-0044 § 3.4 à § 3.6 (lot P8) :
// réceptions, factures fournisseurs et rapprochement, échéancier, paiements et
// doublons probables.
//
// Fichier voisin de `api.ts` et `api-purchases.ts` (même `jsonRequest`, mêmes
// erreurs). AUCUN montant n'est calculé ici : restes à payer, rapprochement et
// échéancier viennent de l'API (moteur `@lalanda/engine`, module `purchases`).
//
// Contrats : réceptions et factures reprennent `@lalanda/shared/purchases` (lot P4).
// Les paiements (P5) et l'échéancier (P5, P6) n'ont pas encore de contrat partagé :
// les vues ci-dessous recopient l'ADR (§ 2.6, § 3.6) au plus près et seront
// remplacées par les contrats de ces lots à leur fusion. Tant qu'une route
// n'existe pas, l'API répond 404 : les écrans le disent, rien n'est inventé.

import type {
  CreatePurchaseReceptionBody,
  CreateSupplierInvoiceBody,
  PurchaseCurrency,
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
  SupplierPaymentChannel,
  SupplierPaymentOrigin,
  SupplierPaymentStatus,
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
} from '@lalanda/shared/purchases';

type DecimalString = string;

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

// ─── Échéancier (§ 3.6) — contrat des lots P5, P6 ───────────────────────────

export interface MontantCompte {
  amount: DecimalString;
  count: number;
}

/** Une devise de l'échéancier : montants et nombres rendus par le moteur. */
export interface EcheancierDeviseView {
  currency: PurchaseCurrency;
  overdue: MontantCompte;
  dueSoon: MontantCompte;
  /** « Plus tard » : semaines glissantes après la fenêtre « bientôt » (moteur). */
  weeks?: (MontantCompte & { from: string; to: string })[];
  /** Puis par mois civil `AAAA-MM`. */
  months?: (MontantCompte & { month: string })[];
  /** Σ hors litiges, rendu par le moteur. */
  open?: MontantCompte;
  disputed: MontantCompte;
}

export interface EcheancierView {
  asOf: string;
  dueSoonDays: number;
  byCurrency: EcheancierDeviseView[];
}

// ─── Paiements (§ 2.6, § 3.6) — contrat du lot P5 ───────────────────────────

export interface SupplierPaymentAllocationView {
  invoiceId: string;
  amount: DecimalString;
  /** Copies d'affichage si l'API les rend. */
  internalNumber?: string | null;
  supplierReference?: string | null;
}

export interface SupplierPaymentView {
  id: string;
  number: string;
  supplierId: string;
  supplierName?: string | null;
  currency: PurchaseCurrency;
  paidOn: string;
  amount: DecimalString;
  accountId: string | null;
  method: SupplierPaymentChannel;
  paymentMethodId?: string | null;
  reference: string | null;
  allocations: SupplierPaymentAllocationView[];
  expenseIds: string[];
  origin: SupplierPaymentOrigin;
  status: SupplierPaymentStatus;
  cancellation?: { at: string; by: string; reason: string } | null;
  revision?: number;
  createdAt?: string;
}

export interface SupplierPaymentPage {
  items: SupplierPaymentView[];
  nextCursor: string | null;
}

export interface PaymentAllocationInput {
  invoiceId: string;
  amount: DecimalString;
}

export interface CreateSupplierPaymentInput {
  supplierId: string;
  currency: PurchaseCurrency;
  paidOn: string;
  amount: DecimalString;
  accountId?: string | null;
  method: SupplierPaymentChannel;
  reference?: string | null;
  allocations: PaymentAllocationInput[];
}

export interface PaymentFromExpenseInput {
  expenseId: string;
  allocations: PaymentAllocationInput[];
  expectedRevision: number;
}

/**
 * Doublon probable (O3 c, moteur `possibleDuplicateExpenses`) : une dépense directe
 * et un paiement du même fournisseur, même devise, même montant, à trois jours ou
 * moins. Rien n'est annulé seul : l'écran le signale.
 */
export interface PossibleDuplicateView {
  code: 'POSSIBLE_DUPLICATE_EXPENSE';
  paymentId: string;
  expenseId: string;
  supplierId: string;
  currency: PurchaseCurrency;
  amount: DecimalString;
  daysApart: number;
  /** Copies d'affichage si l'API les rend. */
  supplierName?: string | null;
  paymentNumber?: string | null;
  expenseLabel?: string | null;
  expenseSpentOn?: string | null;
  paidOn?: string | null;
}

export interface PossibleDuplicatePage {
  items: PossibleDuplicateView[];
}

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
    params: { supplierId?: string; from?: string; to?: string; cursor?: string } = {},
  ) =>
    jsonRequest<SupplierPaymentPage>(`/purchases/payments${salesQuery(params)}`, {
      method: 'GET',
    }),
  createPayment: (body: CreateSupplierPaymentInput) =>
    jsonRequest<SupplierPaymentView>('/purchases/payments', { method: 'POST', body }),
  paymentFromExpense: (body: PaymentFromExpenseInput) =>
    jsonRequest<SupplierPaymentView>('/purchases/payments/from-expense', { method: 'POST', body }),
  cancelPayment: (paymentId: string, body: { reason: string }) =>
    jsonRequest<SupplierPaymentView>(`/purchases/payments/${id(paymentId)}/cancel`, {
      method: 'POST',
      body,
    }),
  listDuplicates: () =>
    jsonRequest<PossibleDuplicatePage>('/purchases/duplicates', { method: 'GET' }),
};
