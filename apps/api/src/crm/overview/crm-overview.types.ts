// Contrat de réponse de la fiche 360° et du fil chronologique (ADR-0040 § 3.1.2,
// § 3.1.3). ADR-0040 — C8.
//
// Montants en chaînes décimales, tels que rendus par le moteur ; par devise,
// jamais convertis. Une section sans droit est `{ status: 'hidden' }` : ni
// liste vide, ni zéros.

import type { CurrencyOutstanding, CurrencyTotal, Settlement } from '@lalanda/engine';
import type { CrmAccountView } from '@lalanda/shared/crm';

import type { Section, TimelineEvent, TimelineSource } from './crm-overview.model.js';

export interface CustomerDocumentLike {
  id: string;
  type: string;
  name: string;
  nif: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
}

export interface OverviewContact {
  id: string;
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
}

export interface OverviewOpportunity {
  id: string;
  title: string;
  status: string;
  stageKey: string;
  stageLabel: string | null;
  amount: string | null;
  currency: string;
  expectedCloseDate: string | null;
  ownerId: string | null;
  closedAt: string | null;
  lostReason: string | null;
  lostReasonKey: string | null;
  createdAt: string;
}

export interface OverviewActivity {
  id: string;
  kind: string;
  subject: string;
  dueAt: string | null;
  dueDay: string | null;
  assigneeUserId: string | null;
  opportunityId: string | null;
  contactId: string | null;
}

export interface OverviewQuote {
  id: string;
  number: string;
  version: number;
  title: string | null;
  status: string;
  validUntil: string;
  currency: string;
  total: string | null;
  opportunityId: string | null;
  invoiceId: string | null;
  createdAt: string;
}

export interface OverviewInvoice {
  id: string;
  number: string | null;
  type: string;
  kind: 'invoice' | 'credit_note';
  status: string;
  currency: string;
  total: string | null;
  issuedOn: string | null;
  dueDate: string | null;
  settlementStatus: string;
  settlementReason: string | null;
  settlement: Settlement | null;
}

export interface OverviewReceipt {
  id: string;
  receivedOn: string;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  /** Lettrages sur les factures DE CE CLIENT seulement. */
  allocations: { invoiceId: string; invoiceNumber: string | null; amount: string }[];
}

export interface OverviewProject {
  id: string;
  name: string;
  kind: string;
  status: string;
  ownerUserId: string | null;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  customerId: string | null;
  opportunityId: string | null;
}

interface List<T> {
  items: T[];
  truncated: boolean;
}

export interface CrmOverview {
  /** Jour de Kinshasa des statuts (retards, devis expirés). */
  asOf: string;
  account: CrmAccountView;
  sections: {
    identity: Section<{ account: CrmAccountView; customer: CustomerDocumentLike | null }>;
    contacts: Section<List<OverviewContact>>;
    opportunities: Section<
      List<OverviewOpportunity> & {
        totals: { basis: 'estimated'; open: CurrencyTotal[]; won: CurrencyTotal[] };
      }
    >;
    nextActions: Section<{ items: OverviewActivity[] }>;
    quotes: Section<
      List<OverviewQuote> & { totals: { sent: CurrencyTotal[]; accepted: CurrencyTotal[] } }
    >;
    invoices: Section<List<OverviewInvoice>>;
    receipts: Section<List<OverviewReceipt>>;
    outstanding: Section<{
      version: string;
      asOf: string;
      byCurrency: CurrencyOutstanding[];
      overdueInvoices: number;
    }>;
    projects: Section<List<OverviewProject>>;
  };
}

export interface TimelinePage {
  items: TimelineEvent[];
  nextCursor: string | null;
  /** Sources demandées mais masquées faute de droit : signalées, jamais vides. */
  hiddenSources: TimelineSource[];
}
