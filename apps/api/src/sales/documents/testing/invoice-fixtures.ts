// Documents de vente figés, fictifs, pour les tests du PDF (ADR-0025).
// NIF, NIM, codes et QR inventés : aucune donnée réelle, aucun appel DGI.

import type { InvoiceTotals } from '@lalanda/engine';
import { Types } from 'mongoose';

import type { InvoiceLean } from '../../invoices/invoice.types.js';

/**
 * Statuts passés par une constante : les tests de lecture des sources cherchent
 * les écritures littérales de `normalized` / `issued` dans le code applicatif
 * (un seul écrivain chacun) ; une fixture ne doit pas y figurer.
 */
const STATUS = { normalized: 'normalized', issued: 'issued' } as const;

const USD_TOTALS: InvoiceTotals = {
  calculationVersion: '1.1.0',
  policyId: 'dgi-cd-2026.2',
  priceMode: 'ht',
  lines: [{ index: 0, amount: '80.00', specificTaxAmount: '0.00', specificTaxValue: null }],
  groups: [
    {
      group: 'B',
      ratePercent: '16',
      total: '92.80',
      ht: '80.00',
      vat: '12.80',
      specificTax: '0.00',
    },
  ],
  specificTax: '0.00',
  total: '92.80',
  vatTotal: '12.80',
};

const CDF_TOTALS: InvoiceTotals = {
  calculationVersion: '1.1.0',
  policyId: 'dgi-cd-2026.2',
  priceMode: 'ht',
  lines: [{ index: 0, amount: '180985.60', specificTaxAmount: '0.00', specificTaxValue: null }],
  groups: [
    {
      group: 'B',
      ratePercent: '16',
      total: '209943.30',
      ht: '180985.60',
      vat: '28957.70',
      specificTax: '0.00',
    },
  ],
  specificTax: '0.00',
  total: '209943.30',
  vatTotal: '28957.70',
};

/** Code QR fictif, avec des caractères hors du jeu alphanumérique QR (`;`, minuscules). */
export const FAKE_QR = 'RDCDEF01;XX01000001-1;ABCD1234EFGH5678IJKL9012;A0000000X;20261020101530;x';

const base = (): InvoiceLean =>
  ({
    _id: new Types.ObjectId('6714b1d5f2a3b4c5d6e7f801'),
    organizationId: 'org-test',
    status: 'draft',
    proformaRef: 'PF-2026-000045',
    type: 'FV',
    currency: 'USD',
    priceMode: 'ht',
    customer: {
      customerId: '6713a0c4e1a2b3c4d5e6f701',
      type: 'PM',
      name: 'Client Exemple SARL',
      nif: 'T0000000X',
      exemptionReference: null,
      phone: '+243 800 000 001',
      email: 'client@exemple.cd',
      address: '2, avenue Cliente, Kinshasa',
      printContactDetails: false,
    },
    pointOfSaleId: 'pos-1',
    lines: [
      {
        index: 0,
        source: 'free',
        catalogItemId: null,
        originLineIndex: null,
        code: 'CONSEIL-H',
        edefCode: 'CONSEIL-H',
        name: 'Conseil (heure)',
        unit: 'heure',
        itemType: 'SER',
        taxGroup: 'B',
        outOfScope: false,
        specificTax: null,
        quantity: '2',
        originalPrice: null,
        discount: null,
        unitPrice: '40.00',
        priceModification: null,
        priceOverridden: false,
      },
    ],
    payments: [{ method: 'VIREMENT', amount: '92.80' }],
    comments: { A: null, C: null },
    creditNote: null,
    showUsdCounterValue: false,
    documentAmounts: {
      currency: 'USD',
      calculation: { ok: true, issues: [], totals: USD_TOTALS },
      paymentsCheck: null,
    },
    conversion: null,
    normalizedAmounts: null,
    calculationVersion: null,
    roundingPolicyId: null,
    taxRates: null,
    number: null,
    series: null,
    fiscalYear: null,
    issuedAt: null,
    emissionMode: null,
    environment: null,
    isf: null,
    seller: null,
    operator: null,
    frozenAt: null,
    frozenFromRevision: null,
    contentSha256: null,
    amountOnCredit: null,
    credited: [],
    creditRevision: 0,
    normalization: null,
    duplicateCount: 0,
    revision: 3,
    sortAt: new Date('2026-10-20T08:00:00Z'),
    searchKey: '',
    createdBy: 'u1',
    updatedBy: 'u1',
    createdAt: new Date('2026-10-20T08:00:00Z'),
    updatedAt: new Date('2026-10-20T08:30:00Z'),
    _schemaVersion: 1,
  }) as unknown as InvoiceLean;

const SELLER = {
  legalName: 'Exemple SARL',
  tradeName: null,
  nif: 'A0000000X',
  rccm: 'CD/KIN/RCCM/00-B-0000',
  address: '1, avenue Exemple, Gombe, Kinshasa',
  phone: '+243 800 000 000',
  email: 'facturation@exemple.cd',
  vatRegistered: true,
};

export function draftUsd(): InvoiceLean {
  return base();
}

/** Facture normalisée de test (forme de `TEST-2026-000001`). */
export function normalizedTest(overrides: Partial<InvoiceLean> = {}): InvoiceLean {
  const frozen = new Date('2026-10-20T09:15:00Z');
  return {
    ...base(),
    status: STATUS.normalized,
    emissionMode: 'normalized',
    environment: 'test',
    isf: 'ISF-TEST-E2E',
    series: 'test',
    number: 'TEST-2026-000001',
    fiscalYear: 2026,
    issuedAt: new Date('2026-10-20T09:15:30Z'),
    seller: SELLER,
    operator: { userId: 'u1', name: 'Comptable Exemple' },
    frozenAt: frozen,
    frozenFromRevision: 3,
    contentSha256: 'a'.repeat(64),
    conversion: {
      from: 'USD',
      to: 'CDF',
      rate: '2262.32',
      rateDate: '2026-10-19T00:00:00+01:00',
      rateSource: 'dgi_currency_rates',
      reference: null,
      originInvoiceId: null,
      conversionVersion: '1.0.0',
    },
    normalizedAmounts: {
      currency: 'CDF',
      lines: [
        {
          index: 0,
          unitPrice: '90492.80',
          originalPrice: null,
          priceModification: null,
          specificTax: null,
        },
      ],
      payments: [{ method: 'VIREMENT', amount: '209943.30' }],
      calculation: CDF_TOTALS,
      counterValueUsd: { amount: '92.80', rate: '2262.32', date: '2026-10-19T00:00:00+01:00' },
    },
    normalization: {
      pointOfSaleId: 'pos-1',
      attempts: 1,
      lastAttemptAt: frozen,
      reservedNumber: 'TEST-2026-000001',
      uid: 'uid-fictif',
      dgiTotals: null,
      codeDefDgi: 'ABCD-1234-EFGH-5678-IJKL-9012',
      nim: 'XX01000001-1',
      counters: '7/8 FV',
      dgiDateTime: '20/10/2026 10:15:30',
      qrCode: FAKE_QR,
      lastError: null,
      normalizedAt: frozen,
      phase: 'done',
      uncertainStep: null,
      attemptId: null,
      claim: null,
      requestSha256: null,
      submittedAt: null,
      confirmStartedAt: null,
      reconcileAfter: null,
      uncertainSince: null,
      differences: null,
      review: null,
    },
    ...overrides,
  } as InvoiceLean;
}

/** Même facture, comme si elle venait de l'environnement de production (série réelle). */
export function normalizedProduction(): InvoiceLean {
  return normalizedTest({
    environment: 'production',
    series: 'real',
    number: '2026-000001',
    isf: 'AAA-BBB-01',
  });
}

/** Facture ordinaire (organisation non normalisée). */
export function issuedStandard(): InvoiceLean {
  return {
    ...base(),
    status: STATUS.issued,
    emissionMode: 'standard',
    series: 'real',
    number: '2026-000012',
    fiscalYear: 2026,
    issuedAt: new Date('2026-10-20T09:00:00Z'),
    seller: SELLER,
    operator: { userId: 'u1', name: 'Comptable Exemple' },
    frozenAt: new Date('2026-10-20T09:00:00Z'),
    contentSha256: 'b'.repeat(64),
  } as InvoiceLean;
}
