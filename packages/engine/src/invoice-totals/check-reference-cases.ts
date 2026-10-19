// ─────────────────────────────────────────────────────────────────────────────
// Cas de référence des contrôles de facture (ADR-0023 § S25e.9, chantier E1)
//
// Paiements, réconciliation après conversion, conversion USD → CDF et contrôles
// d'avoir. Les attendus ont été calculés à la main (opérations écrites dans
// `note`), jamais recopiés de la sortie du code ; le test les rejoue et les
// recoupe par une arithmétique de contrôle propre au test (centimes entiers).
//
// Les taux de change sont des valeurs d'exemple de l'ordre du taux officiel
// relevé le 19 oct. 2026 (2 262,32 CDF pour 1 USD) ; aucun NIF, nom ni donnée
// client.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  CurrencyConversionInput,
  InvoiceCheckIssueCode,
  OriginLine,
  PaymentInput,
} from './invoice-checks.types.js';
import type { DecimalString, SpecificTax } from './types.js';

type Refused = { ok: false; codes: readonly InvoiceCheckIssueCode[] };

export type InvoiceCheckReferenceCase =
  | {
      id: string;
      kind: 'payments';
      note: string;
      total: DecimalString;
      payments: readonly PaymentInput[];
      expected: {
        ok: boolean;
        codes: readonly InvoiceCheckIssueCode[];
        paidTotal: DecimalString;
        amountOnCredit: DecimalString;
      };
    }
  | {
      id: string;
      kind: 'reconcile';
      note: string;
      total: DecimalString;
      payments: readonly PaymentInput[];
      expected: { ok: true; amounts: readonly DecimalString[] } | Refused;
    }
  | {
      id: string;
      kind: 'conversion';
      note: string;
      input: CurrencyConversionInput;
      expected:
        | {
            ok: true;
            lines: readonly {
              unitPrice: DecimalString;
              originalPrice: DecimalString | null;
              priceModification: string | null;
              specificTax: SpecificTax | null;
            }[];
            payments: readonly DecimalString[];
          }
        | Refused;
    }
  | {
      id: string;
      kind: 'credit_note';
      note: string;
      input: {
        originLines: readonly OriginLine[];
        alreadyCredited: readonly { lineIndex: OriginLine['index']; quantity: DecimalString }[];
        lines: readonly {
          originLineIndex: OriginLine['index'];
          quantity: DecimalString;
          unitPrice: DecimalString;
        }[];
        originTotal: DecimalString;
        previousCreditTotals: readonly DecimalString[];
        creditTotal: DecimalString;
      };
      expected: {
        ok: boolean;
        codes: readonly InvoiceCheckIssueCode[];
        creditedAfter: readonly DecimalString[];
        remainingAfter: readonly DecimalString[];
      };
    };

const RATE = '2262.32';

/** Facture d'origine commune aux cas d'avoir : 2,375 × 40,00 (B) et 1 × 25,00 (A). */
const ORIGIN: readonly OriginLine[] = Object.freeze([
  { index: 0, quantity: '2.375', unitPrice: '40.00' },
  { index: 1, quantity: '1', unitPrice: '25.00' },
]);
/** Montant d'origine en HT, groupe B à 16 % : 95,00 + TVA 15,20 = 110,20 ; groupe A : 25,00. */
const ORIGIN_TOTAL = '135.20';

export const INVOICE_CHECK_REFERENCE_CASES: readonly InvoiceCheckReferenceCase[] = Object.freeze([
  // ── Paiements ──────────────────────────────────────────────────────────────
  {
    id: 'paiements-somme-exacte',
    kind: 'payments',
    note: '0,10 + 0,20 = 0,30 exactement (en flottant, 0,1 + 0,2 ≠ 0,3).',
    total: '0.30',
    payments: [
      { method: 'ESPECES', amount: '0.10' },
      { method: 'VIREMENT', amount: '0.20' },
    ],
    expected: { ok: true, codes: [], paidTotal: '0.30', amountOnCredit: '0.00' },
  },
  {
    id: 'paiements-part-a-credit',
    kind: 'payments',
    note: '1 064,00 en espèces + 3 000,00 à crédit = 4 064,00 ; part à crédit 3 000,00.',
    total: '4064.00',
    payments: [
      { method: 'ESPECES', amount: '1064.00' },
      { method: 'CREDIT', amount: '3000.00' },
    ],
    expected: { ok: true, codes: [], paidTotal: '4064.00', amountOnCredit: '3000.00' },
  },
  {
    id: 'paiements-ecart-centime',
    kind: 'payments',
    note: '99,99 payés pour 100,00 : écart d’un centime refusé.',
    total: '100.00',
    payments: [{ method: 'MOBILEMONEY', amount: '99.99' }],
    expected: {
      ok: false,
      codes: ['PAYMENTS_TOTAL_MISMATCH'],
      paidTotal: '99.99',
      amountOnCredit: '0.00',
    },
  },
  {
    id: 'paiements-montant-nul',
    kind: 'payments',
    note: 'Un paiement de 0,00 est refusé ; la somme n’est pas comparée tant qu’un montant est invalide.',
    total: '10.00',
    payments: [
      { method: 'ESPECES', amount: '0.00' },
      { method: 'CHEQUES', amount: '10.00' },
    ],
    expected: {
      ok: false,
      codes: ['PAYMENT_AMOUNT_INVALID'],
      paidTotal: '10.00',
      amountOnCredit: '0.00',
    },
  },
  {
    id: 'paiements-aucun',
    kind: 'payments',
    note: 'Aucun paiement : refusé.',
    total: '10.00',
    payments: [],
    expected: { ok: false, codes: ['NO_PAYMENTS'], paidTotal: '0.00', amountOnCredit: '0.00' },
  },

  // ── Réconciliation après conversion ────────────────────────────────────────
  {
    id: 'reconciliation-trois-paiements',
    kind: 'reconcile',
    note: '10,00 + 20,00 + 13,33 USD à 2 262,32 → 22 623,20 + 45 246,40 + 30 156,73 (30 156,7256) = 98 026,33 ; total CDF 98 026,32 → le plus gros paiement porte −0,01.',
    total: '98026.32',
    payments: [
      { method: 'ESPECES', amount: '22623.20' },
      { method: 'VIREMENT', amount: '45246.40' },
      { method: 'CREDIT', amount: '30156.73' },
    ],
    expected: { ok: true, amounts: ['22623.20', '45246.39', '30156.73'] },
  },
  {
    id: 'reconciliation-egalite',
    kind: 'reconcile',
    note: 'Deux paiements égaux de 100,00 : le premier porte l’écart (+0,01).',
    total: '250.01',
    payments: [
      { method: 'ESPECES', amount: '100.00' },
      { method: 'VIREMENT', amount: '100.00' },
      { method: 'CHEQUES', amount: '50.00' },
    ],
    expected: { ok: true, amounts: ['100.01', '100.00', '50.00'] },
  },
  {
    id: 'reconciliation-paiement-annule',
    kind: 'reconcile',
    note: 'Total 0,01 pour deux paiements de 0,01 : le premier tomberait à 0,00 → refusé.',
    total: '0.01',
    payments: [
      { method: 'ESPECES', amount: '0.01' },
      { method: 'ESPECES', amount: '0.01' },
    ],
    expected: { ok: false, codes: ['PAYMENT_AMOUNT_INVALID'] },
  },

  // ── Conversion USD → CDF ───────────────────────────────────────────────────
  {
    id: 'conversion-prix-simple',
    kind: 'conversion',
    note: '40,00 USD × 2 262,32 = 90 492,80 CDF exactement ; le paiement de 40,00 USD aussi.',
    input: {
      from: 'USD',
      rate: RATE,
      lines: [
        {
          unitPrice: '40.00',
          originalPrice: null,
          discount: null,
          quantity: '2.375',
          specificTax: null,
        },
      ],
      payments: [{ method: 'VIREMENT', amount: '40.00' }],
    },
    expected: {
      ok: true,
      lines: [
        { unitPrice: '90492.80', originalPrice: null, priceModification: null, specificTax: null },
      ],
      payments: ['90492.80'],
    },
  },
  {
    id: 'conversion-demi-centime',
    kind: 'conversion',
    note: '0,50 × 2 262,33 = 1 131,165 : demi-centime exact, arrondi vers le haut → 1 131,17 ; 0,33 × 2 262,33 = 746,5689 → 746,57.',
    input: {
      from: 'USD',
      rate: '2262.33',
      lines: [
        {
          unitPrice: '0.50',
          originalPrice: null,
          discount: null,
          quantity: '1',
          specificTax: null,
        },
        {
          unitPrice: '0.33',
          originalPrice: null,
          discount: null,
          quantity: '1',
          specificTax: null,
        },
      ],
      payments: [{ method: 'ESPECES', amount: '0.83' }],
    },
    expected: {
      ok: true,
      lines: [
        { unitPrice: '1131.17', originalPrice: null, priceModification: null, specificTax: null },
        { unitPrice: '746.57', originalPrice: null, priceModification: null, specificTax: null },
      ],
      // 0,83 × 2 262,33 = 1 877,7339 → 1 877,73
      payments: ['1877.73'],
    },
  },
  {
    id: 'conversion-taux-quatre-decimales',
    kind: 'conversion',
    note: 'Taux à 4 décimales : 0,33 × 2 262,3215 = 746,566095 → 746,57 ; 1 000,00 × 2 262,3215 = 2 262 321,50.',
    input: {
      from: 'USD',
      rate: '2262.3215',
      lines: [
        {
          unitPrice: '0.33',
          originalPrice: null,
          discount: null,
          quantity: '3',
          specificTax: null,
        },
        {
          unitPrice: '1000.00',
          originalPrice: null,
          discount: null,
          quantity: '1',
          specificTax: null,
        },
      ],
      payments: [{ method: 'VIREMENT', amount: '1000.99' }],
    },
    expected: {
      ok: true,
      lines: [
        { unitPrice: '746.57', originalPrice: null, priceModification: null, specificTax: null },
        {
          unitPrice: '2262321.50',
          originalPrice: null,
          priceModification: null,
          specificTax: null,
        },
      ],
      // 1 000,99 × 2 262,3215 = 2 264 561,198285 → 2 264 561,20
      payments: ['2264561.20'],
    },
  },
  {
    id: 'conversion-remise-pourcentage',
    kind: 'conversion',
    note: 'Prix d’origine 100,00 USD → 226 232,00 CDF ; remise de 10 % inchangée → 203 608,80 CDF.',
    input: {
      from: 'USD',
      rate: RATE,
      lines: [
        {
          unitPrice: '90.00',
          originalPrice: '100.00',
          discount: { kind: 'percent', value: '10' },
          quantity: '2',
          specificTax: null,
        },
      ],
      payments: [{ method: 'ESPECES', amount: '180.00' }],
    },
    expected: {
      ok: true,
      lines: [
        {
          unitPrice: '203608.80',
          originalPrice: '226232.00',
          priceModification: 'Remise 10 %',
          specificTax: null,
        },
      ],
      payments: ['407217.60'],
    },
  },
  {
    id: 'conversion-remise-montant',
    kind: 'conversion',
    note: 'Origine 50,00 USD × 3, remise 10,00 USD. CDF : origine 113 116,00, remise 22 623,20 ; prix (339 348,00 − 22 623,20) / 3 = 105 574,9333… → 105 574,93 ; remise effective (113 116,00 − 105 574,93) × 3 = 22 623,21 : libellé recalculé.',
    input: {
      from: 'USD',
      rate: RATE,
      lines: [
        {
          unitPrice: '46.67',
          originalPrice: '50.00',
          discount: { kind: 'total_amount', value: '10.00' },
          quantity: '3',
          specificTax: null,
        },
      ],
      payments: [{ method: 'ESPECES', amount: '140.01' }],
    },
    expected: {
      ok: true,
      lines: [
        {
          unitPrice: '105574.93',
          originalPrice: '113116.00',
          priceModification: 'Remise 22 623,21 CDF',
          specificTax: null,
        },
      ],
      // 140,01 × 2 262,32 = 316 747,4232 → 316 747,42
      payments: ['316747.42'],
    },
  },
  {
    id: 'conversion-taxes-specifiques',
    kind: 'conversion',
    note: 'Taxe par unité 0,75 USD → 1 696,74 CDF (exact) ; taxe en pourcentage de 10 % inchangée.',
    input: {
      from: 'USD',
      rate: RATE,
      lines: [
        {
          unitPrice: '2.00',
          originalPrice: null,
          discount: null,
          quantity: '4',
          specificTax: { kind: 'per_unit', amount: '0.75' },
        },
        {
          unitPrice: '1.00',
          originalPrice: null,
          discount: null,
          quantity: '1',
          specificTax: { kind: 'percent', rate: '10' },
        },
      ],
      payments: [{ method: 'ESPECES', amount: '12.00' }],
    },
    expected: {
      ok: true,
      lines: [
        {
          unitPrice: '4524.64',
          originalPrice: null,
          priceModification: null,
          specificTax: { kind: 'per_unit', amount: '1696.74' },
        },
        {
          unitPrice: '2262.32',
          originalPrice: null,
          priceModification: null,
          specificTax: { kind: 'percent', rate: '10' },
        },
      ],
      payments: ['27147.84'],
    },
  },
  {
    id: 'conversion-identite-cdf',
    kind: 'conversion',
    note: 'Document en CDF : taux 1, aucune ligne ni aucun paiement modifié.',
    input: {
      from: 'CDF',
      rate: '1',
      lines: [
        {
          unitPrice: '720.00',
          originalPrice: null,
          discount: null,
          quantity: '5',
          specificTax: null,
        },
        {
          unitPrice: '900.00',
          originalPrice: '1000.00',
          discount: { kind: 'percent', value: '10' },
          quantity: '1',
          specificTax: null,
        },
      ],
      payments: [{ method: 'ESPECES', amount: '4500.00' }],
    },
    expected: {
      ok: true,
      lines: [
        { unitPrice: '720.00', originalPrice: null, priceModification: null, specificTax: null },
        {
          unitPrice: '900.00',
          originalPrice: '1000.00',
          priceModification: 'Remise 10 %',
          specificTax: null,
        },
      ],
      payments: ['4500.00'],
    },
  },
  {
    id: 'conversion-prix-nul',
    kind: 'conversion',
    note: '0,01 × 0,4 = 0,004 → 0,00 : prix converti nul, refusé (taux artificiel pour atteindre la borne).',
    input: {
      from: 'USD',
      rate: '0.4',
      lines: [
        {
          unitPrice: '0.01',
          originalPrice: null,
          discount: null,
          quantity: '1',
          specificTax: null,
        },
      ],
      payments: [{ method: 'ESPECES', amount: '0.02' }],
    },
    // Le paiement 0,02 × 0,4 = 0,008 → 0,01 passe.
    expected: { ok: false, codes: ['CONVERTED_AMOUNT_ZERO'] },
  },
  {
    id: 'conversion-taux-nul',
    kind: 'conversion',
    note: 'Taux 0 : refusé.',
    input: { from: 'USD', rate: '0', lines: [], payments: [] },
    expected: { ok: false, codes: ['EXCHANGE_RATE_INVALID'] },
  },
  {
    id: 'conversion-taux-virgule',
    kind: 'conversion',
    note: 'Taux écrit avec une virgule (« 2262,32 ») : pas un décimal canonique, refusé.',
    input: { from: 'USD', rate: '2262,32', lines: [], payments: [] },
    expected: { ok: false, codes: ['EXCHANGE_RATE_INVALID'] },
  },
  {
    id: 'conversion-cdf-taux-different',
    kind: 'conversion',
    note: 'Document en CDF présenté avec un taux autre que 1 : refusé.',
    input: { from: 'CDF', rate: RATE, lines: [], payments: [] },
    expected: { ok: false, codes: ['EXCHANGE_RATE_INVALID'] },
  },

  // ── Avoirs ─────────────────────────────────────────────────────────────────
  {
    id: 'avoir-cumul-trois',
    kind: 'credit_note',
    note: 'Deux avoirs précédents (1 et 0,375) puis un troisième de 1 : 2,375 crédités sur 2,375 vendus, reste 0. Montants : 40,00 + 15,00 + 40,00 + TVA… cumulés à 110,20 ≤ 135,20.',
    input: {
      originLines: ORIGIN,
      alreadyCredited: [
        { lineIndex: 0, quantity: '1' },
        { lineIndex: 0, quantity: '0.375' },
      ],
      lines: [{ originLineIndex: 0, quantity: '1', unitPrice: '40.00' }],
      originTotal: ORIGIN_TOTAL,
      previousCreditTotals: ['46.40', '17.40'],
      creditTotal: '46.40',
    },
    expected: {
      ok: true,
      codes: [],
      creditedAfter: ['2.375', '0'],
      remainingAfter: ['0', '1'],
    },
  },
  {
    id: 'avoir-depassement-millieme',
    kind: 'credit_note',
    note: 'Déjà 2 crédités ; reste 0,375 ; l’avoir en demande 0,376 : dépassement d’un millième refusé.',
    input: {
      originLines: ORIGIN,
      alreadyCredited: [{ lineIndex: 0, quantity: '2' }],
      lines: [{ originLineIndex: 0, quantity: '0.376', unitPrice: '40.00' }],
      originTotal: ORIGIN_TOTAL,
      previousCreditTotals: ['92.80'],
      creditTotal: '17.45',
    },
    expected: {
      ok: false,
      codes: ['CREDIT_NOTE_QUANTITY_EXCEEDED'],
      creditedAfter: ['2.376', '0'],
      remainingAfter: ['0', '1'],
    },
  },
  {
    id: 'avoir-restant-exact',
    kind: 'credit_note',
    note: 'Déjà 0,125 crédités ; l’avoir crédite 0,25 sur deux lignes (0,1 + 0,15) : crédité 0,375, reste 2 exactement.',
    input: {
      originLines: ORIGIN,
      alreadyCredited: [{ lineIndex: 0, quantity: '0.125' }],
      lines: [
        { originLineIndex: 0, quantity: '0.1', unitPrice: '40.00' },
        { originLineIndex: 0, quantity: '0.15', unitPrice: '40' },
      ],
      originTotal: ORIGIN_TOTAL,
      previousCreditTotals: ['5.80'],
      creditTotal: '11.60',
    },
    expected: {
      ok: true,
      codes: [],
      creditedAfter: ['0.375', '0'],
      remainingAfter: ['2', '1'],
    },
  },
  {
    id: 'avoir-ligne-inconnue',
    kind: 'credit_note',
    note: 'La ligne 5 n’existe pas sur l’origine : refusée.',
    input: {
      originLines: ORIGIN,
      alreadyCredited: [],
      lines: [{ originLineIndex: 5, quantity: '1', unitPrice: '40.00' }],
      originTotal: ORIGIN_TOTAL,
      previousCreditTotals: [],
      creditTotal: '46.40',
    },
    expected: {
      ok: false,
      codes: ['CREDIT_NOTE_LINE_NOT_IN_ORIGIN'],
      creditedAfter: ['0', '0'],
      remainingAfter: ['2.375', '1'],
    },
  },
  {
    id: 'avoir-prix-different',
    kind: 'credit_note',
    note: 'Prix 24,99 au lieu de 25,00 sur l’origine : refusé.',
    input: {
      originLines: ORIGIN,
      alreadyCredited: [],
      lines: [{ originLineIndex: 1, quantity: '1', unitPrice: '24.99' }],
      originTotal: ORIGIN_TOTAL,
      previousCreditTotals: [],
      creditTotal: '24.99',
    },
    expected: {
      ok: false,
      codes: ['CREDIT_NOTE_PRICE_MISMATCH'],
      creditedAfter: ['0', '1'],
      remainingAfter: ['2.375', '0'],
    },
  },
  {
    id: 'avoir-montant-depasse-centime',
    kind: 'credit_note',
    note: 'Avoirs précédents 100,00 + 35,16 = 135,16 ; ce nouvel avoir (0,001 × 40,00 = 0,04 HT, TVA 0,0064 arrondie à 0,01, soit 0,05) porte le cumul à 135,21 > 135,20 : dépassement d’un centime signalé.',
    input: {
      originLines: ORIGIN,
      alreadyCredited: [{ lineIndex: 0, quantity: '2' }],
      lines: [{ originLineIndex: 0, quantity: '0.001', unitPrice: '40.00' }],
      originTotal: ORIGIN_TOTAL,
      previousCreditTotals: ['100.00', '35.16'],
      creditTotal: '0.05',
    },
    expected: {
      ok: false,
      codes: ['CREDIT_NOTE_AMOUNT_EXCEEDS_ORIGIN'],
      creditedAfter: ['2.001', '0'],
      remainingAfter: ['0.374', '1'],
    },
  },
] satisfies InvoiceCheckReferenceCase[]);
