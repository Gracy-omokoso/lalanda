// Fiche fournisseur 360° — `GET /purchases/suppliers/:id/overview` (ADR-0044 § 3.1.1).
// ADR-0044 — P6.
//
// Types de RÉPONSE seulement : aucune règle, aucun calcul. Chaque section est
// `{ status: 'known' | 'hidden' | 'empty', data }` (motif d'ADR-0040 § 3.1.2) :
// `hidden` (droit manquant) ⇒ `data: null`, jamais une liste vide ni un zéro.
// Montants : chaînes décimales rendues par le moteur, PAR DEVISE, jamais converties
// ni additionnées entre devises. Coordonnées de paiement : masquées (fiche).

import type {
  PurchaseCurrency,
  PurchaseMatchingStatus,
  PurchaseOrderStatus,
  SupplierInvoiceStatus,
} from './constants.js';
import type { SupplierOverviewSection, SupplierView } from './suppliers.js';

/** Somme TTC d'une devise (moteur), avec le nombre de documents qui la portent. */
export interface SupplierOverviewCurrencyTotal {
  currency: PurchaseCurrency;
  total: string;
  count: number;
}

export interface SupplierOverviewOrder {
  id: string;
  /** `BC…` d'une commande, sinon `DA…` d'une demande soumise, sinon `null`. */
  number: string | null;
  title: string;
  status: PurchaseOrderStatus;
  currency: PurchaseCurrency;
  /** Total TTC (moteur `computeOrderTotals`). */
  total: string;
  updatedAt: string;
}

export interface SupplierOverviewOrderStatus {
  status: PurchaseOrderStatus;
  count: number;
  totalsByCurrency: SupplierOverviewCurrencyTotal[];
}

export interface SupplierOverviewReceptionLine {
  orderLineId: string;
  label: string | null;
  unit: string | null;
  ordered: string;
  received: string;
  remaining: string;
}

export interface SupplierOverviewToReceive {
  orderId: string;
  orderNumber: string | null;
  title: string;
  /** Statut dérivé des réceptions (moteur `orderReceptionStatus`). */
  status: PurchaseOrderStatus;
  /** Lignes à réceptionner au reste non nul. */
  lines: SupplierOverviewReceptionLine[];
}

export interface SupplierOverviewInvoice {
  id: string;
  kind: 'invoice' | 'credit_note';
  internalNumber: string;
  supplierReference: string;
  status: SupplierInvoiceStatus;
  matchingStatus: PurchaseMatchingStatus;
  currency: PurchaseCurrency;
  total: string;
  /** Reste à payer (moteur `payableSettlement`) ; « 0.00 » hors facture validée. */
  remaining: string;
  dueDate: string;
  disputed: boolean;
}

/** Ancienneté d'une devise (moteur `payablesAging`), montants. */
export interface SupplierOverviewAgingRow {
  currency: PurchaseCurrency;
  /** Reste à payer hors litige. */
  remaining: string;
  notDue: string;
  days1to30: string;
  days31to60: string;
  days61to90: string;
  over90: string;
  disputed: string;
}

export interface SupplierOverviewPayment {
  id: string;
  number: string;
  paidOn: string;
  currency: PurchaseCurrency;
  amount: string;
  status: 'recorded' | 'cancelled';
}

export interface SupplierOverviewExpense {
  id: string;
  spentOn: string;
  label: string;
  currency: PurchaseCurrency;
  amount: string;
  /** Doublon probable d'un paiement (moteur `possibleDuplicateExpenses`) : signalé seulement. */
  possibleDuplicate: boolean;
}

export interface SupplierOverviewView {
  /** Version du moteur des achats (`PURCHASES_VERSION`). */
  version: string;
  /** Jour de référence de l'ancienneté (Kinshasa). */
  asOf: string;
  supplier: SupplierView;
  sections: {
    /** Demandes et commandes : par statut, et totaux des commandes engagées (non annulées). */
    orders: SupplierOverviewSection<{
      totalsByCurrency: SupplierOverviewCurrencyTotal[];
      byStatus: SupplierOverviewOrderStatus[];
      recent: SupplierOverviewOrder[];
      truncated: boolean;
    }>;
    receptions: SupplierOverviewSection<{ toReceive: SupplierOverviewToReceive[] }>;
    invoices: SupplierOverviewSection<{ recent: SupplierOverviewInvoice[]; truncated: boolean }>;
    balance: SupplierOverviewSection<{ byCurrency: SupplierOverviewAgingRow[] }>;
    /** `purchase.read` + `treasury.read`. */
    payments: SupplierOverviewSection<{ recent: SupplierOverviewPayment[] }>;
    /** `treasury.read` : dépenses directes de la fiche (sans `origin`). */
    directExpenses: SupplierOverviewSection<{
      recent: SupplierOverviewExpense[];
      duplicateCount: number;
    }>;
  };
}
