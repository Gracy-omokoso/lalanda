// ─────────────────────────────────────────────────────────────────────────────
// Marge par projet du RUN — types (ADR-0039 § 5)
//
// Module PUR : aucune base, aucun réseau, aucune horloge. L'API lit les
// factures liées au projet, leurs avoirs, les lettrages des encaissements, les
// dépenses rattachées, le temps saisi et les taux horaires, et les passe tels
// quels ; TOUT le calcul vit ici. Montants en chaînes décimales (deux décimales
// au plus) ; arithmétique en centimes entiers (`bigint`), jamais en flottant.
//
// La marge n'est ni un réalisé, ni une prévision, ni une donnée de plan : elle
// se recalcule à chaque lecture et n'est écrite nulle part (ADR-0018).
// ─────────────────────────────────────────────────────────────────────────────

import type { TaxGroupLetter } from '../invoice-totals/types.js';

/** Toute évolution d'un calcul de ce module incrémente cette version. */
export const WORK_MARGIN_VERSION = '1.0.0';

/** Devises de la marge — celles de la facturation et de la trésorerie. */
export const WORK_MARGIN_CURRENCIES = ['CDF', 'USD'] as const;
export type WorkMarginCurrency = (typeof WORK_MARGIN_CURRENCIES)[number];

/** Date civile `AAAA-MM-JJ` (jour de Kinshasa, déjà ramenée par l'appelant). */
export type WorkMarginDay = string;
/** Montant décimal positif ou nul, deux décimales au plus. */
export type WorkMarginAmount = string;

/** Paiement déclaré au gel d'un document (`method: 'CREDIT'` = part à crédit). */
export interface WorkMarginPayment {
  method: string;
  amount: WorkMarginAmount;
}

/**
 * Facture liée au projet (`FV`/`EV`). `final` : émise ou normalisée, série
 * réelle — l'appelant le décide ; une facture non finale (brouillon, pro forma,
 * série d'essai) n'apporte rien et n'est que comptée (`DRAFT_INVOICES_IGNORED`).
 */
export interface WorkMarginInvoiceInput {
  id: string;
  currency: WorkMarginCurrency;
  final: boolean;
  /** Jour d'émission ; requis pour une facture finale. */
  issuedOn: WorkMarginDay | null;
  /** Paiements déclarés au gel : la part non `CREDIT` est réglée à l'émission. */
  payments: readonly WorkMarginPayment[];
  /** Lettrages des encaissements NON annulés, avec le jour de l'encaissement. */
  allocations: readonly { receivedOn: WorkMarginDay; amount: WorkMarginAmount }[];
  /** Bases HT par groupe de taxe du document (facturé, pour information). */
  taxGroups: readonly { group: TaxGroupLetter; ht: WorkMarginAmount }[];
}

/** Avoir qui vise une facture liée ; sa part non `CREDIT` est de l'argent rendu. */
export interface WorkMarginCreditNoteInput {
  id: string;
  currency: WorkMarginCurrency;
  final: boolean;
  issuedOn: WorkMarginDay | null;
  payments: readonly WorkMarginPayment[];
  taxGroups: readonly { group: TaxGroupLetter; ht: WorkMarginAmount }[];
}

/** Dépense rattachée au projet (`status = recorded`) : montant payé. */
export interface WorkMarginExpenseInput {
  id: string;
  currency: WorkMarginCurrency;
  spentOn: WorkMarginDay;
  amount: WorkMarginAmount;
}

/** Saisie de temps non supprimée. */
export interface WorkMarginTimeEntryInput {
  userId: string;
  workedOn: WorkMarginDay;
  /** Entier strictement positif. */
  minutes: number;
}

/** Coût horaire d'un membre à partir d'une date (le plus récent ≤ jour travaillé). */
export interface WorkMarginRateInput {
  userId: string;
  currency: WorkMarginCurrency;
  /** Strictement positif, deux décimales au plus. */
  hourlyCost: WorkMarginAmount;
  effectiveFrom: WorkMarginDay;
}

export interface ProjectMarginInput {
  invoices: readonly WorkMarginInvoiceInput[];
  creditNotes: readonly WorkMarginCreditNoteInput[];
  expenses: readonly WorkMarginExpenseInput[];
  timeEntries: readonly WorkMarginTimeEntryInput[];
  rates: readonly WorkMarginRateInput[];
  /** Période facultative, bornes incluses (dates d'encaissement, de dépense, de travail). */
  from: WorkMarginDay | null;
  to: WorkMarginDay | null;
}

/** Constats codés (ADR-0039 § 5). */
export const PROJECT_MARGIN_FINDING_CODES = [
  'MULTI_CURRENCY',
  'TIME_WITHOUT_RATE',
  'NO_INVOICE_LINKED',
  'DRAFT_INVOICES_IGNORED',
  'AMOUNTS_INCLUDE_TAX',
] as const;
export type ProjectMarginFindingCode = (typeof PROJECT_MARGIN_FINDING_CODES)[number];

export interface ProjectMarginFinding {
  code: ProjectMarginFindingCode;
  /** `TIME_WITHOUT_RATE` : minutes non valorisées. */
  minutes?: number;
  /** `MULTI_CURRENCY` : devises ; `DRAFT_INVOICES_IGNORED` : factures ignorées. */
  count?: number;
}

/** Marge d'une devise : jamais additionnée à celle d'une autre devise. */
export interface ProjectMarginCurrency {
  currency: WorkMarginCurrency;
  /** Réglé à l'émission + encaissements lettrés (TTC). */
  received: WorkMarginAmount;
  /** Part non `CREDIT` des avoirs finaux : argent rendu. */
  refunded: WorkMarginAmount;
  expenses: WorkMarginAmount;
  /** Σ minutes × taux ÷ 60, un seul arrondi au centime (demi vers le haut). */
  timeCost: WorkMarginAmount;
  /** received − refunded − expenses − timeCost ; signée. */
  margin: string;
  /** Bases HT des factures finales moins celles des avoirs finaux ; signée, jamais soustraite. */
  invoicedExclTax: string;
  invoiceCount: number;
  expenseCount: number;
  /** Minutes VALORISÉES dans cette devise. */
  timeMinutes: number;
}

/** Détail par membre et par devise (chaque ligne arrondie pour elle-même). */
export interface ProjectMarginMemberCost {
  userId: string;
  currency: WorkMarginCurrency;
  minutes: number;
  cost: WorkMarginAmount;
}

export interface ProjectMarginResult {
  version: string;
  from: WorkMarginDay | null;
  to: WorkMarginDay | null;
  /** Par devise, CDF puis USD ; une devise sans aucun élément n'apparaît pas. */
  currencies: ProjectMarginCurrency[];
  findings: ProjectMarginFinding[];
  /** Minutes sans taux applicable : signalées, jamais valorisées à zéro. */
  minutesWithoutRate: number;
  byMember: ProjectMarginMemberCost[];
}
