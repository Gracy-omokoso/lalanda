// ─────────────────────────────────────────────────────────────────────────────
// Encaissements, statut de règlement et réalisé issu des ventes — types (ADR-0031)
//
// Mêmes principes qu'`invoice-totals` : montants en chaînes décimales aux
// frontières, jamais de flottant pour un montant officiel (docs/26) ; aucune
// horloge (la date du jour est un paramètre) ; aucune base, aucun réseau.
// ─────────────────────────────────────────────────────────────────────────────

import type { DocumentCurrency, PaymentMethod } from '../invoice-totals/invoice-checks.types.js';
import type { DecimalString, TaxGroupLetter } from '../invoice-totals/types.js';

/** Version du calcul des soldes, des statuts et des agrégats (ADR-0031 § 5). */
export const RECEIVABLES_VERSION = '1.0.0';

/**
 * Les six moyens de règlement d'un encaissement : les modes e-DEF moins `CREDIT`,
 * qui déclare une part NON réglée (ADR-0023 § S25e.8) et ne peut donc pas
 * décrire de l'argent reçu (ADR-0031 § 1).
 */
export const RECEIPT_METHODS = [
  'ESPECES',
  'VIREMENT',
  'CARTEBANCAIRE',
  'MOBILEMONEY',
  'CHEQUES',
  'AUTRE',
] as const satisfies readonly PaymentMethod[];
export type ReceiptMethod = (typeof RECEIPT_METHODS)[number];

/**
 * Groupes de taxation qui ne forment pas un chiffre d'affaires (ADR-0023 § S25e.13,
 * repris par ADR-0031 § 3). Toute TVA est aussi exclue : seules les bases HT comptent.
 */
export const REVENUE_EXCLUDED_TAX_GROUPS = [
  'H',
  'I',
  'J',
  'L',
  'N',
] as const satisfies readonly TaxGroupLetter[];

/** Date civile `AAAA-MM-JJ` (Kinshasa). */
export type CalendarDate = string;
/** Mois civil `AAAA-MM`. */
export type CalendarMonth = string;
/** Décimal signé à deux décimales (`"-12.50"`) : un mois d'avoirs peut être négatif. */
export type SignedDecimalString = string;

// ── Encaissement ────────────────────────────────────────────────────────────

export interface ReceiptAllocationInput {
  invoiceId: string;
  amount: DecimalString;
}

export interface ReceiptCheckInput {
  amount: DecimalString;
  method: string;
  allocations: readonly ReceiptAllocationInput[];
  /**
   * Reste à encaisser de chaque facture lettrée, HORS l'encaissement contrôlé
   * (pour une modification, ses anciens lettrages sont déjà retirés).
   */
  outstandingByInvoice: Readonly<Record<string, DecimalString>>;
}

export type ReceiptIssueCode =
  | 'RECEIPT_AMOUNT_INVALID'
  | 'RECEIPT_METHOD_INVALID'
  | 'RECEIPT_NO_ALLOCATION'
  | 'RECEIPT_ALLOCATION_INVALID'
  | 'RECEIPT_ALLOCATION_DUPLICATE'
  | 'RECEIPT_ALLOCATIONS_MISMATCH'
  | 'RECEIPT_ALLOCATION_EXCEEDS_BALANCE';

export interface ReceiptIssue {
  code: ReceiptIssueCode;
  /** Position du lettrage concerné, `null` pour l'encaissement entier. */
  allocationIndex: number | null;
  message: string; // français, affichable
  details?: Readonly<Record<string, string>>;
}

export interface ReceiptCheck {
  ok: boolean;
  issues: readonly ReceiptIssue[];
}

// ── Statut de règlement ─────────────────────────────────────────────────────

export interface SettlementInput {
  /** Part `CREDIT` déclarée au gel de la facture (`amountOnCredit`). */
  amountOnCredit: DecimalString;
  /** Part `CREDIT` de chaque avoir final rattaché à la facture (ADR-0031 § 2). */
  creditNoteCredits: readonly DecimalString[];
  /** Lettrages des encaissements non annulés. */
  allocations: readonly DecimalString[];
  dueDate: CalendarDate | null;
  /** Date du jour (Kinshasa), fournie par l'appelant : le moteur n'a pas d'horloge. */
  asOf: CalendarDate;
}

export type SettlementStatus = 'unpaid' | 'partially_paid' | 'paid' | 'overdue';

export interface Settlement {
  status: SettlementStatus;
  /** Vrai seulement si un reste existe et que l'échéance est dépassée. */
  overdue: boolean;
  due: DecimalString;
  credited: DecimalString;
  received: DecimalString;
  outstanding: DecimalString;
  /** Excédent (avoir ou encaissement au-delà du dû) : « crédit client », jamais compensé. */
  creditBalance: DecimalString;
  version: string;
}

// ── Agrégats mensuels ───────────────────────────────────────────────────────

export interface ReceiptForAggregation {
  receivedOn: CalendarDate;
  currency: DocumentCurrency;
  amount: DecimalString;
}

export interface MonthlyCurrencyTotal {
  month: CalendarMonth;
  currency: DocumentCurrency;
  total: DecimalString;
  count: number;
}

// ── Chiffre d'affaires réalisé ──────────────────────────────────────────────

/** `invoice` : FV, EV ; `credit_note` : FA, EA ; `deposit` : acomptes FT, ET (exclus). */
export type RevenueDocumentKind = 'invoice' | 'credit_note' | 'deposit';

export interface RevenueGroupAmount {
  group: TaxGroupLetter;
  /** Base HT du groupe (`haa…` : taxe spécifique comprise, ADR-0022). */
  ht: DecimalString;
}

export interface RevenueDocumentInput {
  id: string;
  /** Jour civil d'émission à Kinshasa. */
  issuedOn: CalendarDate;
  kind: RevenueDocumentKind;
  document: { currency: DocumentCurrency; groups: readonly RevenueGroupAmount[] };
  /** Montants CDF normalisés (seuls à valeur fiscale), `null` hors facture normalisée. */
  normalized: { currency: 'CDF'; groups: readonly RevenueGroupAmount[] } | null;
}

export type RevenueAmounts =
  | { ok: true; currency: string; ht: DecimalString; source: 'document' | 'normalized' }
  | { ok: false; reason: 'CURRENCY_NOT_CONVERTIBLE' };

export interface MonthlyRevenue {
  month: CalendarMonth;
  currency: string;
  /** Factures moins avoirs, signé. `null` si un document du mois n'est pas convertible. */
  revenueHt: SignedDecimalString | null;
  invoicesHt: DecimalString;
  creditNotesHt: DecimalString;
  invoiceIds: readonly string[];
  creditNoteIds: readonly string[];
  depositIds: readonly string[];
  nonConvertibleIds: readonly string[];
}

export interface FiscalPeriod {
  /** Exercice 1 à 5 (docs/08, convention 1). */
  year: number;
  /** Mois d'exercice 1 à 12. */
  month: number;
}

export interface RunActualsInput {
  documents: readonly RevenueDocumentInput[];
  projectCurrency: string;
  /** Mois civil qui ouvre l'exercice 1 (`AAAA-MM`), choisi par l'utilisateur. */
  exerciseStart: CalendarMonth;
  revenueLineId: string;
}

export interface RunActualsPeriod extends FiscalPeriod {
  calendarMonth: CalendarMonth;
  values: Readonly<Record<string, SignedDecimalString>>;
  /** Documents qui forment la valeur, triés : base de l'empreinte d'idempotence. */
  documentIds: readonly string[];
}

export type RunActualsSkipReason = 'OUTSIDE_PLAN_HORIZON' | 'CURRENCY_NOT_CONVERTIBLE';

export interface RunActualsSkipped {
  calendarMonth: CalendarMonth;
  reason: RunActualsSkipReason;
  fiscal: FiscalPeriod | null;
  documentIds: readonly string[];
}

export interface RunActualsPlan {
  version: string;
  periods: readonly RunActualsPeriod[];
  skipped: readonly RunActualsSkipped[];
  /** Acomptes non reportés (ADR-0031, décision ouverte n° 1). */
  excludedDepositIds: readonly string[];
}
