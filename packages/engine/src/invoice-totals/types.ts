// ─────────────────────────────────────────────────────────────────────────────
// Calcul conforme des factures — types du contrat (ADR-0022 § S25d.2, jalon D0)
//
// FICHIER FIGÉ par le jalon D0 : le back-end ventes (D1), le front-end (D2) et
// le moteur de calcul (D3) codent contre ces noms et ces formes en parallèle.
// Toute modification passe par le CTO et un amendement d'ADR-0022, sinon les
// trois chantiers divergent sans que le compilateur le voie avant la fusion.
//
// Pourquoi des chaînes et jamais des `number` : docs/26 interdit le flottant
// natif pour les montants officiels, et la DGI recalcule chaque facture au
// centime ; `0.1 + 0.2 !== 0.3` suffirait à provoquer un écart, donc une
// annulation (ADR-0019). L'arithmétique exacte (entiers `bigint` à virgule fixe)
// vit dans le fichier interne `decimal.ts` du chantier D3 ; ici, seules les
// frontières sont décrites.
// ─────────────────────────────────────────────────────────────────────────────

/** Décimal canonique, sans signe ni exposant : /^\d+(\.\d+)?$/. Jamais un number. */
export type DecimalString = string;

/**
 * Les seize groupes de taxation en vigueur depuis février 2026. Les lettres Q à Z
 * existent dans la spécification e-DEF mais aucun document ne les définit : elles
 * sont absentes de cette liste, donc refusées partout où elle sert de référence.
 */
export const TAX_GROUP_LETTERS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
] as const;
export type TaxGroupLetter = (typeof TAX_GROUP_LETTERS)[number];

/** Types d'article de la spécification e-DEF : bien, service, taxe (L et N seulement). */
export const ITEM_TYPES = ['BIE', 'SER', 'TAX'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** Un seul mode de prix par facture (règle DGI n° 1). */
export type PriceMode = 'ttc' | 'ht';

/** Taxe spécifique d'une ligne : elle augmente la base de la TVA (règle DGI n° 7). */
export type SpecificTax =
  | { kind: 'per_unit'; amount: DecimalString } // par unité, 2 déc., > 0
  | { kind: 'percent'; rate: DecimalString }; // en %, 2 déc., > 0 et < 100

export interface InvoiceLineInput {
  unitPrice: DecimalString; // prix APRÈS remise, dans le mode de la facture ; ≤ 2 déc., > 0
  quantity: DecimalString; // ≤ 3 déc., > 0
  taxGroup: TaxGroupLetter;
  itemType: ItemType;
  specificTax: SpecificTax | null;
}

/** Taux en pour cent, lus dans l'instantané DGI figé par la facture. */
export type TaxRateTable = Readonly<Partial<Record<TaxGroupLetter, DecimalString>>>;

/**
 * Politique d'arrondi explicite : les deux ambiguïtés de la documentation DGI
 * (arrondi de la TVA, arrondi du montant de ligne) ne se lèvent qu'en
 * environnement de test (S25f). Changer de lecture est alors une nouvelle
 * politique, pas une réécriture du calcul (ADR-0022 O4).
 */
export interface RoundingPolicy {
  id: string;
  /** Montant de ligne arrondi ligne par ligne, ou somme exacte arrondie par groupe. */
  lineAmount: 'per_line' | 'per_group';
  /** TVA du groupe : centime supérieur, ou arrondi au plus proche (demi vers le haut). */
  vat: 'up' | 'half_up';
}

export interface InvoiceTotalsInput {
  priceMode: PriceMode;
  lines: readonly InvoiceLineInput[];
  rates: TaxRateTable;
  policy?: RoundingPolicy; // défaut : DGI_ROUNDING_POLICY
}

export interface LineTotals {
  index: number;
  amount: DecimalString; // prix × quantité, arrondi selon la politique
  specificTaxAmount: DecimalString; // "0.00" si aucune → taxSpecificAmount
  specificTaxValue: string | null; // forme DGI : "75.00" ou "10.00%" → taxSpecificValue
}

export interface GroupTotals {
  group: TaxGroupLetter;
  ratePercent: DecimalString;
  total: DecimalString; // taa…  (TTC, taxe spécifique et sa TVA comprises)
  ht: DecimalString; // haa…  (base imposable, taxe spécifique comprise)
  vat: DecimalString; // vaa…
  specificTax: DecimalString;
}

export interface InvoiceTotals {
  calculationVersion: string; // INVOICE_TOTALS_VERSION
  policyId: string;
  priceMode: PriceMode;
  lines: readonly LineTotals[];
  groups: readonly GroupTotals[]; // groupes utilisés seulement, ordre A → P
  specificTax: DecimalString; // ts
  total: DecimalString; // total
  vatTotal: DecimalString; // vtotal
}

export type InvoiceTotalsIssueCode =
  | 'NO_LINES'
  | 'INVALID_DECIMAL'
  | 'PRICE_NOT_POSITIVE'
  | 'PRICE_TOO_PRECISE'
  | 'QUANTITY_NOT_POSITIVE'
  | 'QUANTITY_TOO_PRECISE'
  | 'LINE_AMOUNT_ZERO'
  | 'AMOUNT_TOO_LARGE'
  | 'UNKNOWN_TAX_GROUP'
  | 'TAX_RATE_INVALID'
  | 'ITEM_TYPE_NOT_ALLOWED'
  | 'SPECIFIC_TAX_INVALID'
  | 'SPECIFIC_TAX_NOT_ALLOWED';

export interface InvoiceTotalsIssue {
  code: InvoiceTotalsIssueCode;
  lineIndex: number | null;
  field: 'unitPrice' | 'quantity' | 'taxGroup' | 'itemType' | 'specificTax' | 'rates' | null;
  message: string; // français, affichable
}

/**
 * Résultat du calcul. En cas d'échec, TOUS les problèmes sont rendus, pas le
 * premier : l'écran de facture doit pouvoir signaler chaque ligne fautive d'un coup.
 */
export type InvoiceTotalsResult =
  { ok: true; totals: InvoiceTotals } | { ok: false; issues: readonly InvoiceTotalsIssue[] };
