// ─────────────────────────────────────────────────────────────────────────────
// Cas de référence du calcul des factures (ADR-0022 § S25d.6)
//
// Rejoués par les tests du moteur, puis, au lot S25f, envoyés à l'environnement
// de TEST de la DGI et aussitôt annulés (`POST /api/invoice` puis
// `PUT …/cancel`) pour départager les lectures de la documentation.
//
// Les valeurs attendues ont été calculées à la main (fractions exactes), jamais
// recopiées de la sortie du code. Trois exemples de la documentation DGI sont
// FAUX ou non fiables : ils restent ici pour documenter l'écart, avec la valeur
// publiée que le moteur ne doit PAS produire (`dgiPublished`).
//
// Les montants viennent de la documentation du compte développeur DGI (non
// publique) pour les cas `dgi_example`, résumés en substance ; les autres sont
// construits pour l'occasion. Aucun NIF, nom ni donnée client.
// ─────────────────────────────────────────────────────────────────────────────

import { DGI_ROUNDING_POLICY, DGI_ROUNDING_POLICY_2026_1 } from './compute.js';
import type {
  DecimalString,
  InvoiceLineInput,
  InvoiceTotalsInput,
  InvoiceTotalsIssueCode,
  RoundingPolicy,
  TaxGroupLetter,
} from './types.js';

interface GroupExpectation {
  total: DecimalString;
  ht: DecimalString;
  vat: DecimalString;
}

export type ReferenceExpectation =
  | {
      ok: true;
      groups: Partial<Record<TaxGroupLetter, GroupExpectation>>;
      specificTax: DecimalString;
      total: DecimalString;
      vatTotal: DecimalString;
      /** Montants de ligne attendus, dans l'ordre des lignes, quand le cas les vise. */
      lineAmounts?: readonly DecimalString[];
    }
  | { ok: false; codes: readonly InvoiceTotalsIssueCode[] };

type ExpectedTotals = Extract<ReferenceExpectation, { ok: true }>;

export interface InvoiceTotalsReferenceCase {
  id: string;
  origin: 'dgi_example' | 'derived' | 'calibration';
  reliability: 'reliable' | 'unreliable' | 'to_calibrate';
  note: string;
  input: InvoiceTotalsInput;
  /** Attendu sous `DGI_ROUNDING_POLICY` (`dgi-cd-2026.2`, calcul 1.1.0). */
  expected: ReferenceExpectation;
  /**
   * Attendu sous l'ancienne politique par défaut `DGI_ROUNDING_POLICY_2026_1`
   * (calcul 1.0.0), quand il diffère d'`expected` et que le cas ne porte pas de
   * `variants` : garde testé le recalcul à l'identique des documents 1.0.0.
   */
  expectedUnderPolicy20261?: ReferenceExpectation;
  /** Exemple DGI faux : valeur publiée que le moteur ne doit pas reproduire. */
  dgiPublished?: {
    group: TaxGroupLetter;
    total?: DecimalString;
    vat?: DecimalString;
    specificTax?: DecimalString;
  };
  /** Cas de calibrage : attendu sous chaque politique de `CALIBRATION_ROUNDING_POLICIES`. */
  variants?: Readonly<Record<string, ReferenceExpectation>>;
}

/**
 * Les quatre lectures possibles des ambiguïtés (a) et (b) ; la première est la politique
 * par défaut. Depuis l'étalonnage du 20 oct. 2026, la lecture « ligne par ligne, TVA au
 * plus proche » (appelée `cal-per-line-vat-half-up` dans le rapport) EST la politique par
 * défaut `dgi-cd-2026.2`, et l'ancienne politique par défaut `dgi-cd-2026.1` redevient
 * une simple candidate.
 */
export const CALIBRATION_ROUNDING_POLICIES: readonly RoundingPolicy[] = Object.freeze([
  DGI_ROUNDING_POLICY,
  DGI_ROUNDING_POLICY_2026_1,
  Object.freeze({ id: 'cal-per-group-vat-up', lineAmount: 'per_group', vat: 'up' }),
  Object.freeze({ id: 'cal-per-group-vat-half-up', lineAmount: 'per_group', vat: 'half_up' }),
] as const);

function policyIdOf(lineAmount: RoundingPolicy['lineAmount'], vat: RoundingPolicy['vat']): string {
  const policy = CALIBRATION_ROUNDING_POLICIES.find(
    (p) => p.lineAmount === lineAmount && p.vat === vat,
  );
  if (policy === undefined) throw new Error(`Aucune politique ${lineAmount}/${vat}`);
  return policy.id;
}

const P_LINE_UP = policyIdOf('per_line', 'up');
const P_LINE_HALF = policyIdOf('per_line', 'half_up');
const P_GROUP_UP = policyIdOf('per_group', 'up');
const P_GROUP_HALF = policyIdOf('per_group', 'half_up');

// ── Raccourcis d'écriture ────────────────────────────────────────────────────

function line(
  taxGroup: TaxGroupLetter,
  quantity: DecimalString,
  unitPrice: DecimalString,
  extra: Partial<InvoiceLineInput> = {},
): InvoiceLineInput {
  const itemType = taxGroup === 'L' || taxGroup === 'N' ? 'TAX' : 'BIE';
  return { unitPrice, quantity, taxGroup, itemType, specificTax: null, ...extra };
}

function single(
  group: TaxGroupLetter,
  total: DecimalString,
  ht: DecimalString,
  vat: DecimalString,
  specificTax: DecimalString = '0.00',
): ExpectedTotals {
  return { ok: true, groups: { [group]: { total, ht, vat } }, specificTax, total, vatTotal: vat };
}

function refused(...codes: InvoiceTotalsIssueCode[]): ReferenceExpectation {
  return { ok: false, codes };
}

/** Même attendu sous les quatre politiques. */
function sameUnderAll(expected: ReferenceExpectation): Record<string, ReferenceExpectation> {
  return {
    [P_LINE_UP]: expected,
    [P_LINE_HALF]: expected,
    [P_GROUP_UP]: expected,
    [P_GROUP_HALF]: expected,
  };
}

const B16 = { B: '16' } as const;

// ── Les cas ──────────────────────────────────────────────────────────────────

export const INVOICE_TOTALS_REFERENCE_CASES: readonly InvoiceTotalsReferenceCase[] = Object.freeze([
  // Exemples de la documentation DGI
  {
    id: 'dgi-modele',
    origin: 'dgi_example',
    reliability: 'reliable',
    note: 'Facture modèle de la documentation DGI, mode TTC : exonéré A et taxable B à 16 %. Seul exemple complet et cohérent.',
    input: {
      priceMode: 'ttc',
      lines: [line('A', '5', '720.00'), line('B', '1', '464.00')],
      rates: { A: '0', B: '16' },
    },
    expected: {
      ok: true,
      groups: {
        A: { total: '3600.00', ht: '3600.00', vat: '0.00' },
        B: { total: '464.00', ht: '400.00', vat: '64.00' },
      },
      specificTax: '0.00',
      total: '4064.00',
      vatTotal: '64.00',
    },
  },
  {
    id: 'dgi-remise',
    origin: 'dgi_example',
    reliability: 'reliable',
    note: "Exemple DGI de remise : le prix envoyé est le prix après remise (500 au lieu de 1 000, informatif). Fiable pour le montant de ligne ; la TVA est dérivée, l'exemple ne la donne pas. TVA exacte 2 000 × 16 / 116 = 275,862… → 275,86 au plus proche (relevé DGI du 20 oct. 2026), 275,87 au centime supérieur (dgi-cd-2026.1).",
    input: { priceMode: 'ttc', lines: [line('B', '4', '500.00')], rates: B16 },
    expected: { ...single('B', '2000.00', '1724.14', '275.86'), lineAmounts: ['2000.00'] },
    expectedUnderPolicy20261: {
      ...single('B', '2000.00', '1724.13', '275.87'),
      lineAmounts: ['2000.00'],
    },
  },
  {
    id: 'dgi-ts-19',
    origin: 'dgi_example',
    reliability: 'unreliable',
    note: 'Exemple DGI de taxe spécifique par unité, annoncé à 16 % mais juste seulement à 19 % (voir dgi-ts-a-19). Le moteur ne doit pas produire le total publié. À signaler à la DGI.',
    input: {
      priceMode: 'ttc',
      lines: [line('B', '4', '500.00', { specificTax: { kind: 'per_unit', amount: '75.00' } })],
      rates: B16,
    },
    // TVA exacte 2 348 × 16 / 116 = 323,862… → 323,86 (au plus proche), 323,87 (supérieur).
    expected: single('B', '2348.00', '2024.14', '323.86', '300.00'),
    expectedUnderPolicy20261: single('B', '2348.00', '2024.13', '323.87', '300.00'),
    dgiPublished: { group: 'B', total: '2357.00' },
  },
  {
    id: 'dgi-ts-a-19',
    origin: 'dgi_example',
    reliability: 'unreliable',
    note: "Le même exemple recalculé au taux de 19 % retrouve le total publié au centime : c'est le taux de l'exemple qui est faux, pas la structure du calcul.",
    input: {
      priceMode: 'ttc',
      lines: [line('B', '4', '500.00', { specificTax: { kind: 'per_unit', amount: '75.00' } })],
      rates: { B: '19' },
    },
    expected: single('B', '2357.00', '1980.67', '376.33', '300.00'),
  },
  {
    id: 'dgi-ts-pct-19',
    origin: 'dgi_example',
    reliability: 'unreliable',
    note: 'Exemple DGI de taxe spécifique de 10 %, annoncé à 16 % mais juste seulement à 19 % (voir dgi-ts-pct-a-19). À signaler à la DGI.',
    input: {
      priceMode: 'ttc',
      lines: [line('B', '4', '500.00', { specificTax: { kind: 'percent', rate: '10.00' } })],
      rates: B16,
    },
    expected: single('B', '2200.00', '1896.55', '303.45', '172.41'),
    dgiPublished: { group: 'B', specificTax: '168.00' },
  },
  {
    id: 'dgi-ts-pct-a-19',
    origin: 'dgi_example',
    reliability: 'unreliable',
    note: 'Le même exemple recalculé à 19 % retrouve la taxe spécifique publiée (168,07, arrondie à 168 dans l’exemple).',
    input: {
      priceMode: 'ttc',
      lines: [line('B', '4', '500.00', { specificTax: { kind: 'percent', rate: '10.00' } })],
      rates: { B: '19' },
    },
    // TVA exacte 2 200 × 19 / 119 = 351,260… → 351,26 (au plus proche), 351,27 (supérieur).
    expected: single('B', '2200.00', '1848.74', '351.26', '168.07'),
    expectedUnderPolicy20261: single('B', '2200.00', '1848.73', '351.27', '168.07'),
  },
  {
    id: 'dgi-sous-total-69',
    origin: 'dgi_example',
    reliability: 'unreliable',
    note: "Sous-total d'exemple DGI : TVA 69,00 pour 500 TTC à 16 %, alors que le calcul donne 68,97 sous les deux lectures de l'arrondi (un HT tronqué à l'entier donnerait 69). À signaler à la DGI.",
    input: { priceMode: 'ttc', lines: [line('B', '1', '500.00')], rates: B16 },
    expected: single('B', '500.00', '431.03', '68.97'),
    dgiPublished: { group: 'B', vat: '69.00' },
    variants: sameUnderAll(single('B', '500.00', '431.03', '68.97')),
  },

  // Cas dérivés, fiables
  {
    id: 'mixte-b-c-ttc',
    origin: 'derived',
    reliability: 'reliable',
    note: 'Vente mixte 16 % + 5 % en TTC (cas 1 de l’homologation), montants ronds sans arrondi.',
    input: {
      priceMode: 'ttc',
      lines: [line('B', '1', '1160.00'), line('C', '1', '1050.00')],
      rates: { B: '16', C: '5' },
    },
    expected: {
      ok: true,
      groups: {
        B: { total: '1160.00', ht: '1000.00', vat: '160.00' },
        C: { total: '1050.00', ht: '1000.00', vat: '50.00' },
      },
      specificTax: '0.00',
      total: '2210.00',
      vatTotal: '210.00',
    },
  },
  {
    id: 'mixte-b-c-ht',
    origin: 'derived',
    reliability: 'reliable',
    note: 'La même vente en HT donne les mêmes totaux.',
    input: {
      priceMode: 'ht',
      lines: [line('B', '1', '1000.00'), line('C', '1', '1000.00')],
      rates: { B: '16', C: '5' },
    },
    expected: {
      ok: true,
      groups: {
        B: { total: '1160.00', ht: '1000.00', vat: '160.00' },
        C: { total: '1050.00', ht: '1000.00', vat: '50.00' },
      },
      specificTax: '0.00',
      total: '2210.00',
      vatTotal: '210.00',
    },
  },
  {
    id: 'qte-decimale',
    origin: 'derived',
    reliability: 'reliable',
    note: 'Quantité à 3 décimales (cas 4 de l’homologation) : 2,375 × 1,99 = 4,72625, arrondi à 4,73.',
    input: { priceMode: 'ht', lines: [line('B', '2.375', '1.99')], rates: B16 },
    expected: { ...single('B', '5.49', '4.73', '0.76'), lineAmounts: ['4.73'] },
  },
  {
    id: 'borne-1e12-ttc',
    origin: 'derived',
    reliability: 'reliable',
    note: 'Borne haute : prix de 10¹² CDF × quantité à 3 décimales, exact au centime (un number JavaScript ne le serait pas).',
    input: { priceMode: 'ttc', lines: [line('B', '9.999', '999999999999.99')], rates: B16 },
    expected: {
      ...single('B', '9998999999999.90', '8619827586206.81', '1379172413793.09'),
      lineAmounts: ['9998999999999.90'],
    },
  },
  {
    id: 'groupe-n',
    origin: 'derived',
    reliability: 'to_calibrate',
    note: 'Groupe N : le montant est entièrement de la TVA et s’ajoute au total de TVA. Contenu exact de haa…/vaa… à confirmer en test.',
    input: { priceMode: 'ht', lines: [line('N', '3', '10.00')], rates: { N: '0' } },
    expected: single('N', '30.00', '0.00', '30.00'),
    variants: sameUnderAll(single('N', '30.00', '0.00', '30.00')),
  },

  // Cas de calibrage : ils départagent les lectures (a) arrondi de la TVA et
  // (b) arrondi du montant de ligne, et les points ouverts du § S25d.4.
  {
    id: 'cal-tva-ht',
    origin: 'calibration',
    reliability: 'to_calibrate',
    note: 'Ambiguïté (a) en HT : TVA exacte 68,9648 → 68,97 (centime supérieur) ou 68,96 (plus proche).',
    input: { priceMode: 'ht', lines: [line('B', '1', '431.03')], rates: B16 },
    expected: single('B', '499.99', '431.03', '68.96'),
    variants: {
      [P_LINE_UP]: single('B', '500.00', '431.03', '68.97'),
      [P_LINE_HALF]: single('B', '499.99', '431.03', '68.96'),
      [P_GROUP_UP]: single('B', '500.00', '431.03', '68.97'),
      [P_GROUP_HALF]: single('B', '499.99', '431.03', '68.96'),
    },
  },
  {
    id: 'cal-tva-ttc-1pct',
    origin: 'calibration',
    reliability: 'to_calibrate',
    note: 'Ambiguïté (a) en TTC, groupe O à 1 % : TVA exacte 9,90099 → 9,91 ou 9,90.',
    input: { priceMode: 'ttc', lines: [line('O', '1', '1000.00')], rates: { O: '1' } },
    expected: single('O', '1000.00', '990.10', '9.90'),
    variants: {
      [P_LINE_UP]: single('O', '1000.00', '990.09', '9.91'),
      [P_LINE_HALF]: single('O', '1000.00', '990.10', '9.90'),
      [P_GROUP_UP]: single('O', '1000.00', '990.09', '9.91'),
      [P_GROUP_HALF]: single('O', '1000.00', '990.10', '9.90'),
    },
  },
  {
    id: 'cal-ligne',
    origin: 'calibration',
    reliability: 'to_calibrate',
    note: 'Ambiguïté (b) en HT : trois lignes de 0,335 × 1,00. Arrondies ligne par ligne : 3 × 0,34 = 1,02 ; somme exacte 1,005 arrondie une fois : 1,01.',
    input: {
      priceMode: 'ht',
      lines: [line('B', '0.335', '1.00'), line('B', '0.335', '1.00'), line('B', '0.335', '1.00')],
      rates: B16,
    },
    expected: { ...single('B', '1.18', '1.02', '0.16'), lineAmounts: ['0.34', '0.34', '0.34'] },
    variants: {
      [P_LINE_UP]: single('B', '1.19', '1.02', '0.17'),
      [P_LINE_HALF]: single('B', '1.18', '1.02', '0.16'),
      [P_GROUP_UP]: single('B', '1.18', '1.01', '0.17'),
      [P_GROUP_HALF]: single('B', '1.17', '1.01', '0.16'),
    },
  },
  {
    id: 'cal-ligne-ttc',
    origin: 'calibration',
    reliability: 'to_calibrate',
    note: 'Ambiguïté (b) en TTC, mêmes lignes : le total du groupe vaut 1,02 ou 1,01.',
    input: {
      priceMode: 'ttc',
      lines: [line('B', '0.335', '1.00'), line('B', '0.335', '1.00'), line('B', '0.335', '1.00')],
      rates: B16,
    },
    expected: single('B', '1.02', '0.88', '0.14'),
    variants: {
      [P_LINE_UP]: single('B', '1.02', '0.87', '0.15'),
      [P_LINE_HALF]: single('B', '1.02', '0.88', '0.14'),
      [P_GROUP_UP]: single('B', '1.01', '0.87', '0.14'),
      [P_GROUP_HALF]: single('B', '1.01', '0.87', '0.14'),
    },
  },
  {
    id: 'cal-ts-ht',
    origin: 'calibration',
    reliability: 'to_calibrate',
    note: 'Taxe spécifique par unité en HT : la base de la TVA comprend la taxe spécifique. Vérifie aussi le contenu de haa… quand une taxe spécifique existe.',
    input: {
      priceMode: 'ht',
      lines: [line('B', '4', '431.03', { specificTax: { kind: 'per_unit', amount: '75.00' } })],
      rates: B16,
    },
    expected: single('B', '2347.98', '2024.12', '323.86', '300.00'),
    variants: sameUnderAll(single('B', '2347.98', '2024.12', '323.86', '300.00')),
  },
  {
    id: 'cal-ts-pct-ttc',
    origin: 'calibration',
    reliability: 'to_calibrate',
    note: "Assiette d'une taxe spécifique en pourcentage en TTC : appliquée au HT de la ligne (1 000), elle vaut 100 ; appliquée au TTC (1 160), elle vaudrait 116. Le moteur applique la première lecture.",
    input: {
      priceMode: 'ttc',
      lines: [line('B', '1', '1160.00', { specificTax: { kind: 'percent', rate: '10.00' } })],
      rates: B16,
    },
    expected: single('B', '1276.00', '1100.00', '176.00', '100.00'),
    variants: sameUnderAll(single('B', '1276.00', '1100.00', '176.00', '100.00')),
  },
  {
    id: 'cal-ts-pct-ht',
    origin: 'calibration',
    reliability: 'to_calibrate',
    note: 'La même taxe spécifique de 10 % en HT : mêmes totaux attendus que cal-ts-pct-ttc.',
    input: {
      priceMode: 'ht',
      lines: [line('B', '1', '1000.00', { specificTax: { kind: 'percent', rate: '10.00' } })],
      rates: B16,
    },
    expected: single('B', '1276.00', '1100.00', '176.00', '100.00'),
    variants: sameUnderAll(single('B', '1276.00', '1100.00', '176.00', '100.00')),
  },
  {
    id: 'cal-groupe-m',
    origin: 'calibration',
    reliability: 'to_calibrate',
    note: 'Groupe M (ventes réglementées à TVA spécifique) : le moteur applique le taux renvoyé par la DGI, attendu à 0. Taux réel à relever en test.',
    input: { priceMode: 'ttc', lines: [line('M', '1', '1000.00')], rates: { M: '0' } },
    expected: single('M', '1000.00', '1000.00', '0.00'),
    variants: sameUnderAll(single('M', '1000.00', '1000.00', '0.00')),
  },
  {
    id: 'cal-groupe-n-ttc',
    origin: 'calibration',
    reliability: 'to_calibrate',
    note: 'Groupe N en TTC : mêmes totaux qu’en HT, quel que soit le mode.',
    input: { priceMode: 'ttc', lines: [line('N', '3', '10.00')], rates: { N: '0' } },
    expected: single('N', '30.00', '0.00', '30.00'),
    variants: sameUnderAll(single('N', '30.00', '0.00', '30.00')),
  },

  // Refus : chaque cas vise un seul code
  {
    id: 'refus-prix-zero',
    origin: 'derived',
    reliability: 'reliable',
    note: 'Prix nul : aucun montant nul par article.',
    input: { priceMode: 'ht', lines: [line('B', '1', '0')], rates: B16 },
    expected: refused('PRICE_NOT_POSITIVE'),
  },
  {
    id: 'refus-prix-precis',
    origin: 'derived',
    reliability: 'reliable',
    note: 'Prix à 3 décimales : 2 au plus.',
    input: { priceMode: 'ht', lines: [line('B', '1', '1.234')], rates: B16 },
    expected: refused('PRICE_TOO_PRECISE'),
  },
  {
    id: 'refus-quantite-precise',
    origin: 'derived',
    reliability: 'reliable',
    note: 'Quantité à 4 décimales : 3 au plus.',
    input: { priceMode: 'ht', lines: [line('B', '1.2345', '10.00')], rates: B16 },
    expected: refused('QUANTITY_TOO_PRECISE'),
  },
  {
    id: 'refus-ligne-nulle',
    origin: 'derived',
    reliability: 'reliable',
    note: '0,001 × 0,01 = 0,00001, nul une fois arrondi au centime.',
    input: { priceMode: 'ht', lines: [line('B', '0.001', '0.01')], rates: B16 },
    expected: refused('LINE_AMOUNT_ZERO'),
  },
  {
    id: 'refus-bie-en-l',
    origin: 'derived',
    reliability: 'reliable',
    note: 'Un bien en groupe L : seul le type TAX y est admis.',
    input: {
      priceMode: 'ht',
      lines: [line('L', '1', '10.00', { itemType: 'BIE' })],
      rates: { L: '0' },
    },
    expected: refused('ITEM_TYPE_NOT_ALLOWED'),
  },
  {
    id: 'refus-tax-en-b',
    origin: 'derived',
    reliability: 'reliable',
    note: 'Le type TAX en groupe B : réservé aux groupes L et N.',
    input: { priceMode: 'ht', lines: [line('B', '1', '10.00', { itemType: 'TAX' })], rates: B16 },
    expected: refused('ITEM_TYPE_NOT_ALLOWED'),
  },
  {
    id: 'refus-ts-en-n',
    origin: 'derived',
    reliability: 'reliable',
    note: 'Une taxe spécifique sur un article du groupe N, qui est lui-même de la TVA.',
    input: {
      priceMode: 'ht',
      lines: [line('N', '1', '10.00', { specificTax: { kind: 'per_unit', amount: '1.00' } })],
      rates: { N: '0' },
    },
    expected: refused('SPECIFIC_TAX_NOT_ALLOWED'),
  },
  {
    id: 'refus-groupe-q',
    origin: 'derived',
    reliability: 'reliable',
    note: 'Lettre Q : présente dans la spécification, définie par aucun document.',
    input: {
      priceMode: 'ht',
      lines: [line('Q' as TaxGroupLetter, '1', '10.00')],
      rates: B16,
    },
    expected: refused('UNKNOWN_TAX_GROUP'),
  },
  {
    id: 'refus-groupe-absent',
    origin: 'derived',
    reliability: 'reliable',
    note: 'Groupe C absent de la liste des taux figée par la facture.',
    input: { priceMode: 'ht', lines: [line('C', '1', '10.00')], rates: B16 },
    expected: refused('UNKNOWN_TAX_GROUP'),
  },
  {
    id: 'refus-aucune-ligne',
    origin: 'derived',
    reliability: 'reliable',
    note: 'Une facture sans ligne.',
    input: { priceMode: 'ht', lines: [], rates: B16 },
    expected: refused('NO_LINES'),
  },
  {
    id: 'refus-exposant',
    origin: 'derived',
    reliability: 'reliable',
    note: 'Notation exponentielle « 1e3 » : jamais acceptée.',
    input: { priceMode: 'ht', lines: [line('B', '1', '1e3')], rates: B16 },
    expected: refused('INVALID_DECIMAL'),
  },
  {
    id: 'refus-borne-ht',
    origin: 'derived',
    reliability: 'reliable',
    note: 'La ligne de borne-1e12-ttc en HT : la TVA ajoutée porte le total du groupe au-delà de 10¹³.',
    input: { priceMode: 'ht', lines: [line('B', '9.999', '999999999999.99')], rates: B16 },
    expected: refused('AMOUNT_TOO_LARGE'),
  },
] satisfies InvoiceTotalsReferenceCase[]);

// ── Devise ───────────────────────────────────────────────────────────────────

export type CurrencyReferenceCase =
  | {
      id: string;
      kind: 'counter_value';
      reliability: 'reliable' | 'to_calibrate';
      note: string;
      totalCdf: DecimalString;
      cdfPerUsd: DecimalString;
      expected: DecimalString;
    }
  | {
      id: string;
      kind: 'tolerance';
      reliability: 'reliable';
      note: string;
      rate: DecimalString;
      referenceRate: DecimalString;
      tolerancePercent: DecimalString;
      expected: boolean;
    };

export const CURRENCY_REFERENCE_CASES: readonly CurrencyReferenceCase[] = Object.freeze([
  {
    id: 'devise-contre-valeur',
    kind: 'counter_value',
    reliability: 'to_calibrate',
    note: '4 064,00 CDF au taux de 2 987,33 CDF pour 1 USD = 1,36041… → 1,36 USD. L’arrondi de curTotal par la DGI reste à vérifier.',
    totalCdf: '4064.00',
    cdfPerUsd: '2987.33',
    expected: '1.36',
  },
  {
    id: 'devise-tolerance-acceptee',
    kind: 'tolerance',
    reliability: 'reliable',
    note: '2 929 contre une référence de 2 900 : écart de 1,00 %, borne incluse → accepté.',
    rate: '2929',
    referenceRate: '2900',
    tolerancePercent: '1',
    expected: true,
  },
  {
    id: 'devise-tolerance-refusee',
    kind: 'tolerance',
    reliability: 'reliable',
    note: '2 930 contre 2 900 : écart de 1,03 % → refusé.',
    rate: '2930',
    referenceRate: '2900',
    tolerancePercent: '1',
    expected: false,
  },
] satisfies CurrencyReferenceCase[]);
