// ─────────────────────────────────────────────────────────────────────────────
// Contrôles des factures et conversion en CDF — types du contrat
// (ADR-0023 § S25e.9, jalon E0)
//
// FICHIER FIGÉ par le jalon E0 : le moteur (E1), l'API des documents de vente
// (E2) et l'interface (E3) codent contre ces noms et ces formes en parallèle.
// Toute modification passe par le CTO et un amendement d'ADR-0023.
//
// Montants en chaînes décimales canoniques, jamais en `number` (docs/26) ;
// `computeInvoiceTotals` et `INVOICE_TOTALS_VERSION` ne changent pas.
// ─────────────────────────────────────────────────────────────────────────────

import type { LineDiscount } from './pricing.js';
import type { DecimalString, SpecificTax } from './types.js';

/** Devises d'un document commercial : choix de l'utilisateur (décision du 19 oct. 2026). */
export const DOCUMENT_CURRENCIES = ['CDF', 'USD'] as const;
export type DocumentCurrency = (typeof DOCUMENT_CURRENCIES)[number];

/** Modes de paiement e-DEF (`payment[].name`). */
export const PAYMENT_METHODS = [
  'ESPECES',
  'VIREMENT',
  'CARTEBANCAIRE',
  'MOBILEMONEY',
  'CHEQUES',
  'CREDIT',
  'AUTRE',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export interface PaymentInput {
  method: PaymentMethod;
  amount: DecimalString;
}

export type InvoiceCheckIssueCode =
  | 'NO_PAYMENTS'
  | 'PAYMENT_AMOUNT_INVALID'
  | 'PAYMENTS_TOTAL_MISMATCH'
  | 'CREDIT_NOTE_LINE_NOT_IN_ORIGIN'
  | 'CREDIT_NOTE_QUANTITY_EXCEEDED'
  | 'CREDIT_NOTE_PRICE_MISMATCH'
  | 'CREDIT_NOTE_AMOUNT_EXCEEDS_ORIGIN'
  | 'EXCHANGE_RATE_INVALID'
  | 'CONVERTED_AMOUNT_ZERO';
export interface InvoiceCheckIssue {
  code: InvoiceCheckIssueCode;
  lineIndex: number | null;
  /** Message en français, affichable tel quel. */
  message: string;
  details?: Readonly<Record<string, string>>;
}

export interface PaymentsCheck {
  ok: boolean;
  issues: readonly InvoiceCheckIssue[];
  paidTotal: DecimalString;
  amountOnCredit: DecimalString;
}

export interface ConvertibleLine {
  unitPrice: DecimalString;
  originalPrice: DecimalString | null;
  discount: LineDiscount | null;
  quantity: DecimalString;
  specificTax: SpecificTax | null;
}
export interface CurrencyConversionInput {
  from: DocumentCurrency;
  /** CDF pour 1 USD ; "1" si `from` = CDF. */
  rate: DecimalString;
  lines: readonly ConvertibleLine[];
  payments: readonly PaymentInput[];
}
export type CurrencyConversionResult =
  | {
      ok: true;
      conversionVersion: string;
      lines: readonly {
        index: number;
        unitPrice: DecimalString;
        originalPrice: DecimalString | null;
        priceModification: string | null;
        specificTax: SpecificTax | null;
      }[];
      /** Paiements convertis ; à réconcilier avec le total CDF par reconcilePayments. */
      payments: readonly PaymentInput[];
    }
  | { ok: false; issues: readonly InvoiceCheckIssue[] };

export interface OriginLine {
  index: number;
  quantity: DecimalString;
  unitPrice: DecimalString;
}
export interface CreditNoteCheck {
  ok: boolean;
  issues: readonly InvoiceCheckIssue[];
  creditedAfter: readonly { lineIndex: number; quantity: DecimalString }[];
  remainingAfter: readonly { lineIndex: number; quantity: DecimalString }[];
}
