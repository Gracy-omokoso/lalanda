// Campagne d'homologation DGI — définitions des 29 cas de facture officiels
// (ADR-0026, chantier S25h).
//
// Source : cas de test officiels du SFE, version 1.2 (documentation du compte
// développeur DGI, NON PUBLIQUE, hors dépôt) — repris ici EN SUBSTANCE : pour
// chaque cas, le type de facture, les articles (quantité × groupe), le type de
// client, la nature d'avoir et la facture d'origine. Tout le reste (désignations,
// prix, moyens de paiement) est au choix du candidat : valeurs FICTIVES, marquées
// « TEST ». Chaque cas se joue deux fois, en TTC puis en HT (même prix unitaire
// saisi, lu dans le mode du document).
//
// Ce module est une DONNÉE réutilisable : il produit les corps de requête de
// l'API LALANDA (`POST /sales/invoices`), jamais une requête e-MCF. Le test e2e
// `invoices.homologation.e2e.test.ts` le joue contre le FAUX serveur e-MCF ; un
// futur script pourra le rejouer contre l'environnement de test DGI réel, par
// l'API Lalanda. Il n'appelle rien lui-même.
//
// Aucune arithmétique de montant : la part « reste » d'un paiement est fixée par
// `reconcilePayments` du moteur (qui porte l'écart sur le plus gros paiement).

import {
  PAYMENT_METHODS,
  reconcilePayments,
  type DecimalString,
  type ItemType,
  type LineDiscount,
  type PaymentInput,
  type PaymentMethod,
  type PriceMode,
  type SpecificTax,
  type TaxGroupLetter,
} from '@lalanda/engine';

import type {
  CreditNoteNature,
  InvoiceLineBody,
  InvoiceType,
} from '../../sales/invoices/invoice.contract.js';
import type { CustomerType } from '../../sales/sales.dto.js';

/** Version des cas officiels reprise ici. */
export const HOMOLOGATION_CASES_VERSION = '1.2';

/** Deux factures par cas : le SFE gère les prix TTC et HT (exigence 5.3). */
export const HOMOLOGATION_PRICE_MODES: readonly PriceMode[] = Object.freeze(['ttc', 'ht'] as const);

/** Enchaînements imposés : [cas d'origine, avoir]. L'avoir porte le code DEF/DGI de l'origine. */
export const HOMOLOGATION_CHAINS: readonly (readonly [number, number])[] = Object.freeze([
  [1, 10],
  [3, 11],
  [6, 12],
  [15, 16],
]);

export interface HomologationSaleLine {
  code: string | null;
  name: string;
  itemType: ItemType;
  taxGroup: TaxGroupLetter;
  outOfScope: boolean;
  unit: string | null;
  quantity: DecimalString;
  /** CDF, dans le mode du document (TTC ou HT). */
  unitPrice: DecimalString;
  specificTax: SpecificTax | null;
  discount: LineDiscount | null;
}

/** Ligne d'avoir rattaché : reprise d'une ligne de l'origine, seule la quantité varie. */
export interface HomologationCreditLine {
  originLineIndex: number;
  quantity: DecimalString;
}

/** Montant fixe, ou `remainder` : le solde jusqu'au total (un seul par cas). */
export interface HomologationPayment {
  method: PaymentMethod;
  amount: DecimalString | 'remainder';
}

export type HomologationCredit =
  | {
      nature: Exclude<CreditNoteNature, 'RRR'>;
      /** Numéro du cas dont la facture normalisée est l'origine. */
      originCase: number;
      lines: readonly HomologationCreditLine[];
    }
  | { nature: 'RRR' };

/** Ce que le cas doit prouver, vérifiable sur la requête e-MCF et sur le PDF. */
export interface HomologationExpectation {
  /** Groupes de taxation des articles, dans l'ordre des lignes. */
  groups: readonly TaxGroupLetter[];
  /** Types d'article envoyés, dans l'ordre des lignes. */
  itemTypes: readonly ItemType[];
  /** Codes d'article envoyés (`items[].code`), dans l'ordre des lignes. */
  itemCodes: readonly (string | null)[];
  /** Ligne de commentaire A attendue (client AO : « Réf. Exo. : … »). */
  commentA: string | null;
  /** Référence envoyée : code DEF/DGI de l'origine, `RRR`, ou aucune. */
  reference: 'origin' | 'RRR' | null;
  /** Contre-valeur USD envoyée (`curCode`, `curRate`, `curDate`). */
  counterValue: boolean;
  /** Mentions que le PDF doit porter (texte brut, avant échappement HTML). */
  pdfMentions: readonly string[];
}

export interface HomologationCase {
  /** Numéro du cas officiel, 1 à 29. */
  number: number;
  title: string;
  type: InvoiceType;
  customer: CustomerType;
  credit: HomologationCredit | null;
  /** Lignes d'une vente ou d'un avoir RRR ; vide pour un avoir rattaché. */
  lines: readonly HomologationSaleLine[];
  /** Document en CDF avec contre-valeur USD demandée (cas 26). */
  usdCounterValue: boolean;
  payments: readonly HomologationPayment[];
  expected: HomologationExpectation;
}

/** Clients FICTIFS de la campagne, un par type (PP : vente de comptoir, sans fiche). */
export interface HomologationCustomer {
  type: Exclude<CustomerType, 'PP'>;
  name: string;
  nif: string;
  exemptionReference: string | null;
}

export const HOMOLOGATION_CUSTOMERS: readonly HomologationCustomer[] = Object.freeze([
  {
    type: 'PM',
    name: 'TEST HOMOLOGATION Société PM SARL',
    nif: 'TESTPM0001',
    exemptionReference: null,
  },
  {
    type: 'PC',
    name: 'TEST HOMOLOGATION Commerçant PC',
    nif: 'TESTPC0001',
    exemptionReference: null,
  },
  { type: 'PL', name: 'TEST HOMOLOGATION Cabinet PL', nif: 'TESTPL0001', exemptionReference: null },
  {
    type: 'AO',
    name: 'TEST HOMOLOGATION Organisation internationale AO',
    nif: 'TESTAO0001',
    exemptionReference: 'EXO-TEST-2026-001',
  },
]);

/** Nom imprimé du client de comptoir (PP : tous les champs sont facultatifs). */
export const HOMOLOGATION_WALK_IN_NAME = 'TEST HOMOLOGATION Particulier';

// ── Fabrique de lignes ───────────────────────────────────────────────────────

function line(
  quantity: DecimalString,
  taxGroup: TaxGroupLetter,
  name: string,
  unitPrice: DecimalString,
  extra: Partial<Omit<HomologationSaleLine, 'quantity' | 'taxGroup' | 'name' | 'unitPrice'>> = {},
): HomologationSaleLine {
  return Object.freeze({
    code: extra.code !== undefined ? extra.code : `TEST-${taxGroup}`,
    name,
    itemType: extra.itemType ?? 'BIE',
    taxGroup,
    outOfScope: extra.outOfScope ?? false,
    unit: extra.unit ?? null,
    quantity,
    unitPrice,
    specificTax: extra.specificTax ?? null,
    discount: extra.discount ?? null,
  });
}

const pay = (method: PaymentMethod, amount: DecimalString | 'remainder' = 'remainder') =>
  Object.freeze({ method, amount });

const RRR_MENTION = 'FACTURE D’AVOIR — Remise, ristourne, rabais (RRR)';

/** Les 29 cas de facture officiels, dans l'ordre (les origines précèdent leurs avoirs). */
export const HOMOLOGATION_CASES: readonly HomologationCase[] = Object.freeze(
  (
    [
      {
        number: 1,
        title: 'Vente mixte 16 % et 5 %',
        type: 'FV',
        customer: 'PM',
        credit: null,
        lines: [
          line('1', 'B', 'Ordinateur portable TEST', '850000.00'),
          line('1', 'C', 'Sac de farine TEST', '42500.00'),
        ],
        usdCounterValue: false,
        payments: [pay('ESPECES', '100000.00'), pay('VIREMENT')],
        expected: {
          groups: ['B', 'C'],
          itemTypes: ['BIE', 'BIE'],
          itemCodes: ['TEST-B', 'TEST-C'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['[PM] Personne morale', '[B]', '[C]'],
        },
      },
      {
        number: 2,
        title: 'Vente exonérée seule',
        type: 'FV',
        customer: 'PM',
        credit: null,
        lines: [line('1', 'A', 'Manuel scolaire TEST', '15000.00')],
        usdCounterValue: false,
        payments: [pay('CARTEBANCAIRE')],
        expected: {
          groups: ['A'],
          itemTypes: ['BIE'],
          itemCodes: ['TEST-A'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['[PM] Personne morale', '[A]'],
        },
      },
      {
        number: 3,
        title: 'Vente mixte taxable et exonérée',
        type: 'FV',
        customer: 'PM',
        credit: null,
        lines: [
          line('2', 'B', 'Conseil TEST (heure)', '45000.00', { itemType: 'SER', unit: 'heure' }),
          line('3', 'A', 'Manuel scolaire TEST', '15000.00'),
        ],
        usdCounterValue: false,
        payments: [pay('MOBILEMONEY')],
        expected: {
          groups: ['B', 'A'],
          itemTypes: ['SER', 'BIE'],
          itemCodes: ['TEST-B', 'TEST-A'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['[PM] Personne morale', '[SER]', '[BIE]'],
        },
      },
      {
        number: 4,
        title: 'Quantités décimales',
        type: 'FV',
        customer: 'PM',
        credit: null,
        lines: [
          line('2.375', 'B', 'Câble électrique TEST', '1250.50', { unit: 'm' }),
          line('3.5', 'A', 'Riz TEST', '2300.00', { unit: 'kg' }),
        ],
        usdCounterValue: false,
        payments: [pay('CHEQUES')],
        expected: {
          groups: ['B', 'A'],
          itemTypes: ['BIE', 'BIE'],
          itemCodes: ['TEST-B', 'TEST-A'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['[PM] Personne morale', '2,375 m', '3,5 kg'],
        },
      },
      {
        number: 5,
        title: 'Client personne physique',
        type: 'FV',
        customer: 'PP',
        credit: null,
        lines: [
          line('2', 'B', 'Chaise TEST', '12000.00'),
          line('3', 'A', 'Cahier TEST', '3500.00'),
        ],
        usdCounterValue: false,
        payments: [pay('ESPECES')],
        expected: {
          groups: ['B', 'A'],
          itemTypes: ['BIE', 'BIE'],
          itemCodes: ['TEST-B', 'TEST-A'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['[PP] Personne physique'],
        },
      },
      {
        number: 6,
        title: 'Client personne physique commerçante',
        type: 'FV',
        customer: 'PC',
        credit: null,
        lines: [
          line('2', 'B', 'Table TEST', '18000.00'),
          line('3', 'A', 'Lait en poudre TEST', '4000.00'),
        ],
        usdCounterValue: false,
        payments: [pay('MOBILEMONEY', '10000.00'), pay('ESPECES')],
        expected: {
          groups: ['B', 'A'],
          itemTypes: ['BIE', 'BIE'],
          itemCodes: ['TEST-B', 'TEST-A'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['[PC] Personne physique commerçante', 'NIF : TESTPC0001'],
        },
      },
      {
        number: 7,
        title: 'Client profession libérale',
        type: 'FV',
        customer: 'PL',
        credit: null,
        lines: [
          line('2', 'B', 'Audit TEST (jour)', '30000.00', { itemType: 'SER', unit: 'jour' }),
          line('3', 'A', 'Brochure TEST', '5000.00'),
        ],
        usdCounterValue: false,
        payments: [pay('CREDIT')],
        expected: {
          groups: ['B', 'A'],
          itemTypes: ['SER', 'BIE'],
          itemCodes: ['TEST-B', 'TEST-A'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['[PL] Profession libérale', 'NIF : TESTPL0001'],
        },
      },
      {
        number: 8,
        title: 'Taxe spécifique (par unité et en %)',
        type: 'FV',
        customer: 'PM',
        credit: null,
        lines: [
          line('3', 'B', 'Boisson sucrée TEST', '5000.00', {
            specificTax: { kind: 'per_unit', amount: '250.00' },
          }),
          line('2', 'C', 'Huile alimentaire TEST', '9000.00', {
            specificTax: { kind: 'percent', rate: '10' },
          }),
          line('1', 'A', 'Pain TEST', '1500.00'),
        ],
        usdCounterValue: false,
        payments: [pay('VIREMENT')],
        expected: {
          groups: ['B', 'C', 'A'],
          itemTypes: ['BIE', 'BIE', 'BIE'],
          itemCodes: ['TEST-B', 'TEST-C', 'TEST-A'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['[PM] Personne morale', 'T.S.'],
        },
      },
      {
        number: 9,
        title: 'Facture d’acompte',
        type: 'FT',
        customer: 'PM',
        credit: null,
        lines: [
          line('2', 'B', 'Acompte installation TEST', '100000.00', { itemType: 'SER' }),
          line('3', 'A', 'Acompte manuels TEST', '20000.00'),
        ],
        usdCounterValue: false,
        payments: [pay('VIREMENT')],
        expected: {
          groups: ['B', 'A'],
          itemTypes: ['SER', 'BIE'],
          itemCodes: ['TEST-B', 'TEST-A'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['D’ACOMPTE'],
        },
      },
      {
        number: 10,
        title: 'Avoir d’annulation (origine : cas 1)',
        type: 'FA',
        customer: 'PM',
        credit: {
          nature: 'RAN',
          originCase: 1,
          lines: [
            { originLineIndex: 0, quantity: '1' },
            { originLineIndex: 1, quantity: '1' },
          ],
        },
        lines: [],
        usdCounterValue: false,
        payments: [pay('VIREMENT')],
        expected: {
          groups: ['B', 'C'],
          itemTypes: ['BIE', 'BIE'],
          itemCodes: ['TEST-B', 'TEST-C'],
          commentA: null,
          reference: 'origin',
          counterValue: false,
          pdfMentions: ['FACTURE D’AVOIR — Annulation', 'Code DEF/DGI d’origine'],
        },
      },
      {
        number: 11,
        title: 'Avoir après reprise (origine : cas 3)',
        type: 'FA',
        customer: 'PM',
        credit: {
          nature: 'RAM',
          originCase: 3,
          lines: [
            { originLineIndex: 0, quantity: '1' },
            { originLineIndex: 1, quantity: '1' },
          ],
        },
        lines: [],
        usdCounterValue: false,
        payments: [pay('ESPECES')],
        expected: {
          groups: ['B', 'A'],
          itemTypes: ['SER', 'BIE'],
          itemCodes: ['TEST-B', 'TEST-A'],
          commentA: null,
          reference: 'origin',
          counterValue: false,
          pdfMentions: ['FACTURE D’AVOIR — Avoir suite reprise', 'Code DEF/DGI d’origine'],
        },
      },
      {
        number: 12,
        title: 'Avoir de correction (origine : cas 6)',
        type: 'FA',
        customer: 'PC',
        credit: { nature: 'COR', originCase: 6, lines: [{ originLineIndex: 0, quantity: '1' }] },
        lines: [],
        usdCounterValue: false,
        payments: [pay('MOBILEMONEY')],
        expected: {
          groups: ['B'],
          itemTypes: ['BIE'],
          itemCodes: ['TEST-B'],
          commentA: null,
          reference: 'origin',
          counterValue: false,
          pdfMentions: [
            'FACTURE D’AVOIR — Correction',
            'Code DEF/DGI d’origine',
            '[PC] Personne physique commerçante',
          ],
        },
      },
      {
        number: 13,
        title: 'Avoir de remise, ristourne, rabais (référence « RRR »)',
        type: 'FA',
        customer: 'PM',
        credit: { nature: 'RRR' },
        lines: [
          line('3', 'B', 'Ristourne de fin d’année TEST (16 %)', '2000.00', { itemType: 'SER' }),
          line('2', 'C', 'Ristourne de fin d’année TEST (5 %)', '1000.00', { itemType: 'SER' }),
          line('1', 'A', 'Ristourne de fin d’année TEST (exonéré)', '500.00', { itemType: 'SER' }),
        ],
        usdCounterValue: false,
        payments: [pay('CHEQUES')],
        expected: {
          groups: ['B', 'C', 'A'],
          itemTypes: ['SER', 'SER', 'SER'],
          itemCodes: ['TEST-B', 'TEST-C', 'TEST-A'],
          commentA: null,
          reference: 'RRR',
          counterValue: false,
          pdfMentions: [RRR_MENTION, 'Référence : RRR'],
        },
      },
      {
        number: 14,
        title: 'Régime dérogatoire (ambassade, organisation internationale)',
        type: 'FV',
        customer: 'AO',
        credit: null,
        lines: [line('2', 'D', 'Fournitures de bureau TEST', '60000.00')],
        usdCounterValue: false,
        payments: [pay('VIREMENT')],
        expected: {
          groups: ['D'],
          itemTypes: ['BIE'],
          itemCodes: ['TEST-D'],
          commentA: 'Réf. Exo. : EXO-TEST-2026-001',
          reference: null,
          counterValue: false,
          pdfMentions: [
            '[AO] Ambassades et organisations internationales',
            'Réf. Exo. : EXO-TEST-2026-001',
          ],
        },
      },
      {
        number: 15,
        title: 'Vente à l’exportation',
        type: 'EV',
        customer: 'PM',
        credit: null,
        lines: [line('3', 'E', 'Café vert TEST (sac)', '250000.00', { unit: 'sac' })],
        usdCounterValue: false,
        payments: [pay('VIREMENT')],
        expected: {
          groups: ['E'],
          itemTypes: ['BIE'],
          itemCodes: ['TEST-E'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['EXPORTATION'],
        },
      },
      {
        number: 16,
        title: 'Avoir d’annulation à l’exportation (origine : cas 15)',
        type: 'EA',
        customer: 'PM',
        credit: { nature: 'RAN', originCase: 15, lines: [{ originLineIndex: 0, quantity: '3' }] },
        lines: [],
        usdCounterValue: false,
        payments: [pay('VIREMENT')],
        expected: {
          groups: ['E'],
          itemTypes: ['BIE'],
          itemCodes: ['TEST-E'],
          commentA: null,
          reference: 'origin',
          counterValue: false,
          pdfMentions: ['EXPORTATION', 'FACTURE D’AVOIR — Annulation', 'Code DEF/DGI d’origine'],
        },
      },
      {
        // Le tableau des cas dit ET, la fiche détaillée « (FT) » : ET retenu
        // (« acompte à l'exportation »), question posée à la DGI (ADR-0026).
        number: 17,
        title: 'Acompte à l’exportation',
        type: 'ET',
        customer: 'PM',
        credit: null,
        lines: [line('3', 'E', 'Acompte café vert TEST (sac)', '80000.00', { unit: 'sac' })],
        usdCounterValue: false,
        payments: [pay('VIREMENT')],
        expected: {
          groups: ['E'],
          itemTypes: ['BIE'],
          itemCodes: ['TEST-E'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['EXPORTATION', 'D’ACOMPTE'],
        },
      },
      {
        number: 18,
        title: 'Marché public à financement extérieur 16 % et 5 %',
        type: 'FV',
        customer: 'PM',
        credit: null,
        lines: [
          line('2', 'F', 'Travaux TEST (marché public)', '150000.00', { itemType: 'SER' }),
          line('2', 'G', 'Fournitures TEST (marché public)', '40000.00'),
        ],
        usdCounterValue: false,
        payments: [pay('VIREMENT')],
        expected: {
          groups: ['F', 'G'],
          itemTypes: ['SER', 'BIE'],
          itemCodes: ['TEST-F', 'TEST-G'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['[F]', '[G]'],
        },
      },
      {
        number: 19,
        title: 'Consignation d’emballage',
        type: 'FV',
        customer: 'PM',
        credit: null,
        lines: [
          line('2', 'B', 'Eau minérale TEST (casier)', '15000.00'),
          line('2', 'H', 'Consignation casier TEST', '3000.00'),
        ],
        usdCounterValue: false,
        payments: [pay('ESPECES')],
        expected: {
          groups: ['B', 'H'],
          itemTypes: ['BIE', 'BIE'],
          itemCodes: ['TEST-B', 'TEST-H'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['[H]'],
        },
      },
      {
        number: 20,
        title: 'Garantie et caution',
        type: 'FV',
        customer: 'PM',
        credit: null,
        lines: [
          line('1', 'C', 'Location matériel TEST', '50000.00', { itemType: 'SER' }),
          line('1', 'I', 'Caution matériel TEST', '100000.00', { itemType: 'SER' }),
        ],
        usdCounterValue: false,
        payments: [pay('CHEQUES')],
        expected: {
          groups: ['C', 'I'],
          itemTypes: ['SER', 'SER'],
          itemCodes: ['TEST-C', 'TEST-I'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['[I]'],
        },
      },
      {
        number: 21,
        title: 'Débours',
        type: 'FV',
        customer: 'PM',
        credit: null,
        lines: [
          line('2', 'J', 'Frais de dossier refacturés TEST', '25000.00', { itemType: 'SER' }),
        ],
        usdCounterValue: false,
        payments: [pay('CARTEBANCAIRE')],
        expected: {
          groups: ['J'],
          itemTypes: ['SER'],
          itemCodes: ['TEST-J'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['[J]'],
        },
      },
      {
        number: 22,
        title: 'Vendeur non assujetti',
        type: 'FV',
        customer: 'PM',
        credit: null,
        lines: [line('2', 'K', 'Prestation TEST (non assujetti)', '20000.00', { itemType: 'SER' })],
        usdCounterValue: false,
        payments: [pay('ESPECES')],
        expected: {
          groups: ['K'],
          itemTypes: ['SER'],
          itemCodes: ['TEST-K'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['[K]'],
        },
      },
      {
        number: 23,
        title: 'Prélèvements sur ventes (articles TAX)',
        type: 'FV',
        customer: 'PM',
        credit: null,
        lines: [
          line('2', 'B', 'Boisson gazeuse TEST', '6000.00'),
          line('2', 'L', 'Taxe parafiscale TEST', '300.00', { itemType: 'TAX' }),
        ],
        usdCounterValue: false,
        payments: [pay('MOBILEMONEY')],
        expected: {
          groups: ['B', 'L'],
          itemTypes: ['BIE', 'TAX'],
          itemCodes: ['TEST-B', 'TEST-L'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['[L]', '[TAX]'],
        },
      },
      {
        number: 24,
        title: 'Ventes réglementées et TVA spécifique',
        type: 'FV',
        customer: 'PM',
        credit: null,
        lines: [
          line('3', 'M', 'Carburant TEST (litre)', '3200.00', { unit: 'l' }),
          line('3', 'N', 'TVA spécifique carburant TEST', '150.00', { itemType: 'TAX' }),
        ],
        usdCounterValue: false,
        payments: [pay('CARTEBANCAIRE', '5000.00'), pay('CREDIT')],
        expected: {
          groups: ['M', 'N'],
          itemTypes: ['BIE', 'TAX'],
          itemCodes: ['TEST-M', 'TEST-N'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['[M]', '[N]', '[TAX]'],
        },
      },
      {
        number: 25,
        title: 'Remises sur lignes (10 % et 300 CDF au total)',
        type: 'FV',
        customer: 'PM',
        credit: null,
        lines: [
          line('2', 'B', 'Imprimante TEST', '320000.00', {
            discount: { kind: 'percent', value: '10' },
          }),
          line('3', 'C', 'Ramette de papier TEST', '12000.00'),
          line('3', 'A', 'Manuel TEST', '8000.00', {
            discount: { kind: 'total_amount', value: '300.00' },
          }),
        ],
        usdCounterValue: false,
        payments: [pay('VIREMENT')],
        expected: {
          groups: ['B', 'C', 'A'],
          itemTypes: ['BIE', 'BIE', 'BIE'],
          itemCodes: ['TEST-B', 'TEST-C', 'TEST-A'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['Prix d’origine', 'Remise 10 %', 'Remise 300'],
        },
      },
      {
        number: 26,
        title: 'Contre-valeur en USD',
        type: 'FV',
        customer: 'PM',
        credit: null,
        lines: [
          line('2', 'B', 'Licence logicielle TEST', '450000.00', { itemType: 'SER' }),
          line('3', 'C', 'Support TEST', '18000.00', { itemType: 'SER' }),
        ],
        usdCounterValue: true,
        payments: [pay('VIREMENT')],
        expected: {
          groups: ['B', 'C'],
          itemTypes: ['SER', 'SER'],
          itemCodes: ['TEST-B', 'TEST-C'],
          commentA: null,
          reference: null,
          counterValue: true,
          pdfMentions: ['Contre-valeur', 'USD', 'taux appliqué'],
        },
      },
      {
        number: 27,
        title: 'Taux réduit 1 %',
        type: 'FV',
        customer: 'PM',
        credit: null,
        lines: [line('1', 'O', 'Produit TEST (taux 1 %)', '70000.00')],
        usdCounterValue: false,
        payments: [pay('ESPECES')],
        expected: {
          groups: ['O'],
          itemTypes: ['BIE'],
          itemCodes: ['TEST-O'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['[O]'],
        },
      },
      {
        number: 28,
        title: 'Marché public à financement extérieur 1 %',
        type: 'FV',
        customer: 'PM',
        credit: null,
        lines: [line('1', 'P', 'Fourniture TEST (marché public 1 %)', '90000.00')],
        usdCounterValue: false,
        payments: [pay('VIREMENT')],
        expected: {
          groups: ['P'],
          itemTypes: ['BIE'],
          itemCodes: ['TEST-P'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['[P]'],
        },
      },
      {
        number: 29,
        title: 'Opération hors champ (code « HORS CHAMP »)',
        type: 'FV',
        customer: 'PM',
        credit: null,
        lines: [
          line('1', 'A', 'Indemnité TEST (hors champ)', '50000.00', {
            code: 'INDEM-TEST',
            itemType: 'SER',
            outOfScope: true,
          }),
        ],
        usdCounterValue: false,
        payments: [pay('ESPECES')],
        expected: {
          groups: ['A'],
          itemTypes: ['SER'],
          itemCodes: ['HORS CHAMP'],
          commentA: null,
          reference: null,
          counterValue: false,
          pdfMentions: ['HORS CHAMP', '[A] hors champ'],
        },
      },
    ] satisfies HomologationCase[]
  ).map((c) => Object.freeze(c)),
);

/** Cas par numéro ; lève une erreur pour un numéro hors 1–29. */
export function homologationCase(number: number): HomologationCase {
  const found = HOMOLOGATION_CASES.find((c) => c.number === number);
  if (!found) throw new RangeError(`Cas d’homologation inconnu : ${number}`);
  return found;
}

// ── Corps de requête de l'API Lalanda ────────────────────────────────────────

export interface HomologationDraftContext {
  /** Identifiant de la fiche client de chaque type (PP : vente de comptoir). */
  customerIds: Readonly<Partial<Record<CustomerType, string>>>;
  /** Identifiant Lalanda de la facture normalisée d'un cas d'origine, dans le MÊME mode de prix. */
  originInvoiceId: (originCase: number) => string;
  /** `null` : le seul point de vente actif de l'organisation. */
  pointOfSaleId: string | null;
}

/** Corps de `POST /sales/invoices` (brouillon, sans paiement) pour un cas et un mode de prix. */
export function homologationDraftBody(
  c: HomologationCase,
  priceMode: PriceMode,
  ctx: HomologationDraftContext,
) {
  let customer:
    | { customerId: string; printContactDetails: boolean }
    | { customerId: null; walkIn: { name: string | null } };
  if (c.customer === 'PP') {
    customer = { customerId: null, walkIn: { name: HOMOLOGATION_WALK_IN_NAME } };
  } else {
    const id = ctx.customerIds[c.customer];
    if (id === undefined) throw new Error(`Aucune fiche client de type ${c.customer}.`);
    customer = { customerId: id, printContactDetails: false };
  }

  let lines: InvoiceLineBody[];
  let creditNote: { nature: CreditNoteNature; originInvoiceId: string | null } | null = null;
  if (c.credit !== null && c.credit.nature !== 'RRR') {
    const originInvoiceId = ctx.originInvoiceId(c.credit.originCase);
    creditNote = { nature: c.credit.nature, originInvoiceId };
    lines = c.credit.lines.map((l) => ({
      source: 'origin',
      originLineIndex: l.originLineIndex,
      quantity: l.quantity,
    }));
  } else {
    if (c.credit !== null) creditNote = { nature: 'RRR', originInvoiceId: null };
    lines = c.lines.map((l) => ({ source: 'free', ...l }));
  }

  return {
    type: c.type,
    currency: 'CDF' as const,
    priceMode,
    customer,
    pointOfSaleId: ctx.pointOfSaleId,
    lines,
    payments: [] as PaymentInput[],
    comments: { A: null, C: null },
    creditNote,
    showUsdCounterValue: c.usdCounterValue,
  };
}

/**
 * Paiements du cas pour le total calculé par le moteur (brouillon) : les montants
 * fixes tels quels, le `remainder` au solde. Le solde est posé par
 * `reconcilePayments` (moteur) sur une valeur provisoire plus grande que tout
 * paiement fixe : aucune arithmétique ici.
 */
export function homologationPayments(c: HomologationCase, total: DecimalString): PaymentInput[] {
  const placeholder = '999999999999.00';
  const draft = c.payments.map((p) => ({
    method: p.method,
    amount: p.amount === 'remainder' ? placeholder : p.amount,
  }));
  const reconciled = reconcilePayments(total, draft);
  if (!reconciled.ok) {
    throw new Error(
      `Cas ${c.number} : paiements impossibles pour le total ${total} (${reconciled.issues
        .map((i) => i.message)
        .join(' ; ')}).`,
    );
  }
  return [...reconciled.payments];
}

/** Moyens de paiement couverts par la campagne (exigence 1.18). */
export function homologationPaymentMethods(): PaymentMethod[] {
  const used = new Set(HOMOLOGATION_CASES.flatMap((c) => c.payments.map((p) => p.method)));
  return PAYMENT_METHODS.filter((m) => used.has(m));
}
