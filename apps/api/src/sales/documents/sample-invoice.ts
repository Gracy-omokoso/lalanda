// Facture FICTIVE de l'aperçu des modèles — ADR-0028 § 8.
//
// Jamais enregistrée, jamais numérotée, jamais envoyée à la DGI : elle ne sert
// qu'à montrer un modèle aux couleurs de l'organisation. Le moteur la marque
// EXEMPLE (filigrane, bandeau, pied). Ses montants sont des CONSTANTES (ceux
// des maquettes validées) : l'API ne calcule rien ; le code DEF/DGI, le NIM et
// le QR code sont manifestement fictifs.

import type { InvoiceTotals } from '@lalanda/engine';
import { Types } from 'mongoose';

import type { InvoiceLean } from '../invoices/invoice.types.js';

const TOTALS: InvoiceTotals = {
  calculationVersion: '1.1.0',
  policyId: 'dgi-cd-2026.2',
  priceMode: 'ht',
  lines: [
    { index: 0, amount: '180985.60', specificTaxAmount: '0.00', specificTaxValue: null },
    { index: 1, amount: '250000.00', specificTaxAmount: '0.00', specificTaxValue: null },
    { index: 2, amount: '125000.00', specificTaxAmount: '0.00', specificTaxValue: null },
  ],
  groups: [
    {
      group: 'B',
      ratePercent: '16',
      ht: '430985.60',
      vat: '68957.70',
      total: '499943.30',
      specificTax: '0.00',
    },
    {
      group: 'C',
      ratePercent: '5',
      ht: '125000.00',
      vat: '6250.00',
      total: '131250.00',
      specificTax: '0.00',
    },
  ],
  specificTax: '0.00',
  total: '631193.30',
  vatTotal: '75207.70',
};

const line = (
  index: number,
  code: string,
  name: string,
  unit: string,
  itemType: 'SER' | 'BIE',
  taxGroup: 'B' | 'C',
  quantity: string,
  unitPrice: string,
) => ({
  index,
  source: 'free',
  catalogItemId: null,
  originLineIndex: null,
  code,
  edefCode: code,
  name,
  unit,
  itemType,
  taxGroup,
  outOfScope: false,
  specificTax: null,
  quantity,
  originalPrice: null,
  discount: null,
  unitPrice,
  priceModification: null,
  priceOverridden: false,
});

/**
 * Statut passé par une constante : les tests de lecture des sources cherchent
 * les écritures littérales de `normalized` (un seul écrivain en base) ; ce
 * document n'est JAMAIS écrit en base.
 */
const STATUS = { normalized: 'normalized' } as const;

/** Date fixe : un aperçu est déterministe. */
const AT = new Date('2026-10-20T09:15:30Z');

export function sampleInvoice(organizationId: string): InvoiceLean {
  return {
    _id: new Types.ObjectId('000000000000000000000000'),
    organizationId,
    status: STATUS.normalized,
    proformaRef: 'EXEMPLE',
    type: 'FV',
    currency: 'CDF',
    priceMode: 'ht',
    customer: {
      customerId: null,
      type: 'PM',
      name: 'Client Exemple SARL',
      nif: 'EXEMPLE',
      exemptionReference: null,
      phone: null,
      email: null,
      address: null,
      printContactDetails: false,
    },
    pointOfSaleId: null,
    lines: [
      line(0, 'CONSEIL-H', 'Conseil en organisation', 'heure', 'SER', 'B', '2', '90492.80'),
      line(1, 'FORM-01', 'Formation de l’équipe', 'forfait', 'SER', 'B', '1', '250000.00'),
      line(2, 'MAN-IMP', 'Manuel imprimé', 'unité', 'BIE', 'C', '10', '12500.00'),
    ],
    payments: [{ method: 'VIREMENT', amount: '631193.30' }],
    comments: { A: null, C: null },
    creditNote: null,
    showUsdCounterValue: true,
    documentAmounts: {
      currency: 'CDF',
      calculation: { ok: true, issues: [], totals: TOTALS },
      paymentsCheck: null,
    },
    conversion: null,
    normalizedAmounts: {
      currency: 'CDF',
      lines: [0, 1, 2].map((index) => ({
        index,
        unitPrice: ['90492.80', '250000.00', '12500.00'][index]!,
        originalPrice: null,
        priceModification: null,
        specificTax: null,
      })),
      payments: [{ method: 'VIREMENT', amount: '631193.30' }],
      calculation: TOTALS,
      counterValueUsd: { amount: '279.00', rate: '2262.32', date: '2026-10-19T00:00:00+01:00' },
    },
    calculationVersion: null,
    roundingPolicyId: null,
    taxRates: null,
    number: 'EXEMPLE-000042',
    series: 'real',
    fiscalYear: 2026,
    issuedAt: AT,
    emissionMode: 'normalized',
    environment: null,
    isf: 'EXEMPLE',
    seller: {
      legalName: 'Votre entreprise (exemple)',
      tradeName: null,
      nif: 'EXEMPLE',
      rccm: null,
      address: 'Adresse de votre siège',
      phone: null,
      email: null,
      vatRegistered: true,
    },
    operator: { userId: 'exemple', name: 'Comptable Exemple' },
    frozenAt: AT,
    frozenFromRevision: 0,
    contentSha256: null,
    amountOnCredit: null,
    credited: [],
    creditRevision: 0,
    normalization: {
      pointOfSaleId: '',
      attempts: 0,
      lastAttemptAt: null,
      reservedNumber: null,
      uid: null,
      dgiTotals: null,
      codeDefDgi: 'EXEMPLE-0000-0000-0000-0000-0000',
      nim: 'EXEMPLE',
      counters: '42/57 FV',
      dgiDateTime: '20/10/2026 10:15:30',
      qrCode: 'EXEMPLE - document fictif, sans valeur fiscale',
      lastError: null,
      normalizedAt: AT,
      phase: 'done',
    },
    duplicateCount: 0,
    revision: 0,
    sortAt: AT,
    searchKey: '',
    createdBy: 'exemple',
    updatedBy: 'exemple',
    createdAt: AT,
    updatedAt: AT,
    _schemaVersion: 1,
  } as unknown as InvoiceLean;
}
