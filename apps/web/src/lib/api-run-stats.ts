// Tableaux de bord des écrans Achats et Trésorerie (ADR-0071). Lecture seule ; les
// chiffres sont ceux du moteur, servis par l'API (contrats `@lalanda/shared`).

import type {
  PayablesStats,
  PurchaseOrderStats,
  SupplierInvoiceStats,
} from '@lalanda/shared/purchases';
import type { AccountStats, ExpenseStats } from '@lalanda/shared/treasury';

import { jsonRequest } from './api';

export type { AccountStats, ExpenseStats, PayablesStats, PurchaseOrderStats, SupplierInvoiceStats };

export const runStatsApi = {
  supplierInvoices: () =>
    jsonRequest<SupplierInvoiceStats>('/purchases/invoices/stats', { method: 'GET' }),
  payables: () => jsonRequest<PayablesStats>('/purchases/payables/stats', { method: 'GET' }),
  orders: () => jsonRequest<PurchaseOrderStats>('/purchases/orders/stats', { method: 'GET' }),
  expenses: (month?: string) =>
    jsonRequest<ExpenseStats>(
      `/treasury/expenses/stats${month ? `?month=${encodeURIComponent(month)}` : ''}`,
      { method: 'GET' },
    ),
  accounts: () => jsonRequest<AccountStats>('/treasury/accounts/stats', { method: 'GET' }),
};
