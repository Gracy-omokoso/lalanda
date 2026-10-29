// Fiche compte 360° et fil chronologique — types de RÉPONSE (ADR-0040 § 3.1.2,
// § 3.1.3). ADR-0040 — C5 (recopie du contrat de C8,
// `apps/api/src/crm/overview/crm-overview.types.ts` et `crm-overview.model.ts`).
//
// Types seulement : aucune règle, aucun calcul. Les montants sont des chaînes
// décimales telles que rendues par le moteur, PAR DEVISE, jamais converties ni
// additionnées. Une section sans droit est `{ status: 'hidden' }` : l'écran
// l'annonce par une phrase, jamais par une liste vide ni un zéro.
//
// Les formes du moteur (`CurrencyTotal`, `CurrencyOutstanding`, `Settlement`)
// sont recopiées ici : `@lalanda/shared` ne dépend pas de `@lalanda/engine`.

import type { CrmAccountView } from './accounts.js';

/** Section de la fiche : connue, masquée (droit manquant) ou vide. */
export type CrmOverviewSection<T> =
  ({ status: 'known' } & T) | { status: 'hidden' } | { status: 'empty' };

/** Somme de montants estimés d'une devise (moteur `crm`, `sumAmountsByCurrency`). */
export interface CrmCurrencyTotal {
  currency: string;
  total: string;
  count: number;
}

/** Reste à encaisser d'une devise (moteur `receivables`, `sumOutstandingByCurrency`). */
export interface CrmCurrencyOutstanding {
  currency: string;
  outstanding: string;
  openCount: number;
  overdueOutstanding: string;
  overdueCount: number;
  /** Crédit client : jamais déduit de `outstanding`. */
  creditBalance: string;
  invoiceCount: number;
}

/** Règlement d'une facture (moteur `receivables`, `computeSettlement`). */
export interface CrmInvoiceSettlement {
  status: string;
  overdue: boolean;
  due: string;
  credited: string;
  received: string;
  outstanding: string;
  creditBalance: string;
  version: string;
}

export interface CrmOverviewCustomer {
  id: string;
  /** Type DGI de la fiche client (lecture seule : la fiche fait foi). */
  type: string;
  name: string;
  nif: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
}

export interface CrmOverviewContact {
  id: string;
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
}

export interface CrmOverviewOpportunity {
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

export interface CrmOverviewActivity {
  id: string;
  kind: string;
  subject: string;
  dueAt: string | null;
  dueDay: string | null;
  assigneeUserId: string | null;
  opportunityId: string | null;
  contactId: string | null;
}

export interface CrmOverviewQuote {
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

export interface CrmOverviewInvoice {
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
  settlement: CrmInvoiceSettlement | null;
}

export interface CrmOverviewReceipt {
  id: string;
  receivedOn: string;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  allocations: { invoiceId: string; invoiceNumber: string | null; amount: string }[];
}

export interface CrmOverviewProject {
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

interface CrmOverviewList<T> {
  items: T[];
  truncated: boolean;
}

/** `GET /crm/accounts/:accountId/overview`. */
export interface CrmOverview {
  /** Jour de Kinshasa des statuts (retards, devis expirés). */
  asOf: string;
  account: CrmAccountView;
  sections: {
    identity: CrmOverviewSection<{
      account: CrmAccountView;
      customer: CrmOverviewCustomer | null;
    }>;
    contacts: CrmOverviewSection<CrmOverviewList<CrmOverviewContact>>;
    opportunities: CrmOverviewSection<
      CrmOverviewList<CrmOverviewOpportunity> & {
        totals: { basis: 'estimated'; open: CrmCurrencyTotal[]; won: CrmCurrencyTotal[] };
      }
    >;
    nextActions: CrmOverviewSection<{ items: CrmOverviewActivity[] }>;
    quotes: CrmOverviewSection<
      CrmOverviewList<CrmOverviewQuote> & {
        totals: { sent: CrmCurrencyTotal[]; accepted: CrmCurrencyTotal[] };
      }
    >;
    invoices: CrmOverviewSection<CrmOverviewList<CrmOverviewInvoice>>;
    receipts: CrmOverviewSection<CrmOverviewList<CrmOverviewReceipt>>;
    outstanding: CrmOverviewSection<{
      version: string;
      asOf: string;
      byCurrency: CrmCurrencyOutstanding[];
      overdueInvoices: number;
    }>;
    projects: CrmOverviewSection<CrmOverviewList<CrmOverviewProject>>;
  };
}

/** Sources du fil chronologique (§ 3.1.3). */
export const CRM_TIMELINE_SOURCES = [
  'activity',
  'opportunity',
  'account',
  'quote',
  'invoice',
  'receipt',
  'project',
] as const;
export type CrmTimelineSource = (typeof CRM_TIMELINE_SOURCES)[number];

export type CrmTimelineEventType =
  | 'activity.created'
  | 'activity.done'
  | 'opportunity.created'
  | 'opportunity.stage_changed'
  | 'opportunity.won'
  | 'opportunity.lost'
  | 'account.created'
  | 'account.converted'
  | 'account.merged'
  | 'quote.created'
  | 'quote.sent'
  | 'quote.accepted'
  | 'quote.refused'
  | 'quote.converted'
  | 'invoice.issued'
  | 'invoice.normalized'
  | 'receipt.recorded'
  | 'receipt.cancelled'
  | 'project.created'
  | 'project.completed';

export interface CrmTimelineEvent {
  id: string;
  type: CrmTimelineEventType;
  source: CrmTimelineSource;
  /** Instant ISO. */
  at: string;
  /** Document source (activité, opportunité, devis…). */
  refId: string;
  title: string;
  by: string | null;
  details: Record<string, string | number | boolean | null>;
}

/** `GET /crm/accounts/:accountId/timeline?cursor=&types=`. */
export interface CrmTimelinePage {
  items: CrmTimelineEvent[];
  nextCursor: string | null;
  /** Sources demandées mais masquées faute de droit : signalées, jamais vides. */
  hiddenSources: CrmTimelineSource[];
}
