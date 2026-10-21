// Formes STOCKÉES des sous-documents d'un document de vente (ADR-0023 § S25e.2).
//
// Valeurs JSON pures (chaînes, booléens, entiers de position, `null`) : c'est ce
// qui permet à `contentSha256` de se recalculer à l'identique après lecture en
// base. Les vues (`invoice.contract.ts`) en dérivent.

import type {
  DecimalString,
  DocumentCurrency,
  InvoiceTotals,
  InvoiceTotalsIssue,
  ItemType,
  LineDiscount,
  PaymentInput,
  PaymentsCheck,
  SpecificTax,
  TaxGroupLetter,
} from '@lalanda/engine';
import type { Types } from 'mongoose';

import type { CustomerType } from '../sales.dto.js';
import type {
  ConversionRateSource,
  CreditNoteNature,
  DgiEnvironment,
  InvoiceLineSource,
} from './invoice.contract.js';
import type { SalesInvoice } from './invoice.schema.js';

export interface StoredCustomer {
  customerId: string | null;
  type: CustomerType;
  name: string | null;
  nif: string | null;
  exemptionReference: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  printContactDetails: boolean;
}

export interface StoredLine {
  index: number;
  source: InvoiceLineSource;
  catalogItemId: string | null;
  originLineIndex: number | null;
  code: string | null;
  edefCode: string | null;
  name: string;
  unit: string | null;
  itemType: ItemType;
  taxGroup: TaxGroupLetter;
  outOfScope: boolean;
  specificTax: SpecificTax | null;
  quantity: DecimalString;
  originalPrice: DecimalString | null;
  discount: LineDiscount | null;
  unitPrice: DecimalString;
  priceModification: string | null;
  priceOverridden: boolean;
}

export interface StoredCalculation {
  ok: boolean;
  issues: readonly InvoiceTotalsIssue[];
  totals: InvoiceTotals | null;
}

export interface StoredDocumentAmounts {
  currency: DocumentCurrency;
  calculation: StoredCalculation;
  paymentsCheck: PaymentsCheck | null;
}

export interface StoredConversion {
  from: DocumentCurrency;
  to: 'CDF';
  rate: DecimalString;
  rateDate: string;
  rateSource: ConversionRateSource;
  reference: {
    rate: DecimalString;
    date: string;
    environment: DgiEnvironment;
    sha256: string;
  } | null;
  originInvoiceId: string | null;
  conversionVersion: string;
}

export interface StoredNormalizedLine {
  index: number;
  unitPrice: DecimalString;
  originalPrice: DecimalString | null;
  priceModification: string | null;
  specificTax: SpecificTax | null;
}

export interface StoredNormalizedAmounts {
  currency: 'CDF';
  lines: StoredNormalizedLine[];
  payments: PaymentInput[];
  calculation: InvoiceTotals;
  counterValueUsd: { amount: DecimalString; rate: DecimalString; date: string } | null;
}

export interface StoredTaxRates {
  source: 'dgi_snapshot';
  environment: DgiEnvironment;
  fetchedAt: string;
  sha256: string;
  rates: Partial<Record<TaxGroupLetter, DecimalString>>;
}

export interface StoredCreditNote {
  nature: CreditNoteNature;
  originInvoiceId: string | null;
  originNumber: string | null;
  reference: string | null;
}

export interface StoredSeller {
  legalName: string;
  tradeName: string | null;
  nif: string;
  rccm: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  vatRegistered: boolean;
}

/** Document tel que lu par `.lean()`. */
export type InvoiceLean = SalesInvoice & { _id: Types.ObjectId };

/** Auteur d'une action : identifiant, nom affichable et rôle sous lequel elle est autorisée. */
export interface InvoiceActor {
  userId: string;
  name: string;
  role: string;
}

/**
 * Étiquette interne d'un document créé par la campagne d'homologation DGI
 * (`edef:homologation`, ADR-0026 § 7). Aucun contenu fiscal : ni envoyée, ni
 * imprimée, ni hachée.
 */
export interface InvoiceCampaignLabel {
  /** Identifiant de campagne (`sfe-v1.2` par défaut). */
  id: string;
  /** Numéro du cas officiel, 1 à 29. */
  caseNumber: number;
  priceMode: 'ttc' | 'ht';
}
