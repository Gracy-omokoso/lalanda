// ─────────────────────────────────────────────────────────────────────────────
// Groupes de taxation par défaut (ADR-0022 § S25d.2, jalon D0 — fichier figé)
//
// Pourquoi une liste par défaut : une organisation sans point de vente testé n'a
// encore aucun instantané DGI (`GET /api/info/taxGroups`), mais doit pouvoir
// créer son catalogue (ADR-0022 O5). Le catalogue n'a besoin que de la lettre,
// du libellé et des types d'article admis.
//
// Pourquoi AUCUN taux ici : ADR-0019 interdit de coder un taux en dur. Le taux
// n'intervient qu'au calcul de la facture et vient alors de l'instantané DGI
// figé par la facture (S25e). Un test vérifie qu'aucun champ de taux n'apparaît
// dans ce fichier ; les pourcentages des libellés sont des NOMS de groupe.
// ─────────────────────────────────────────────────────────────────────────────

import { ITEM_TYPES, TAX_GROUP_LETTERS, type ItemType, type TaxGroupLetter } from './types.js';

/** `vat_only` : groupe N, dont le montant est entièrement de la TVA. */
export type TaxGroupNature = 'standard' | 'vat_only';

export interface TaxGroupDefinition {
  letter: TaxGroupLetter;
  label: string; // libellé court, français
  nature: TaxGroupNature;
  itemTypes: readonly ItemType[]; // ['TAX'] pour L et N, ['BIE','SER'] sinon
  outOfScopeAllowed: boolean; // true pour A seulement
}

// Types d'article admis : `TAX` est réservé aux groupes L et N, `BIE` et `SER`
// valent pour tous les autres (documentation du compte développeur DGI).
const GOODS_AND_SERVICES: readonly ItemType[] = Object.freeze(['BIE', 'SER'] as const);
const TAX_ONLY: readonly ItemType[] = Object.freeze(['TAX'] as const);

function standard(letter: TaxGroupLetter, label: string): TaxGroupDefinition {
  return Object.freeze({
    letter,
    label,
    nature: 'standard',
    itemTypes: GOODS_AND_SERVICES,
    // L'opération hors champ n'existe qu'en groupe A « Exonéré et hors champ ».
    outOfScopeAllowed: letter === 'A',
  });
}

/** Seize groupes en vigueur depuis février 2026 — source : documentation du compte
 *  développeur DGI (groupes de taxation, v1.2). Aucun taux ici (ADR-0019). */
export const DEFAULT_TAX_GROUPS: readonly TaxGroupDefinition[] = Object.freeze([
  standard('A', 'Exonéré et hors champ'),
  standard('B', 'Taxable 16 %'),
  standard('C', 'Taxable 5 %'),
  standard('D', 'Régimes dérogatoires'),
  standard('E', 'Exportation'),
  standard('F', 'Marché public à financement extérieur 16 %'),
  standard('G', 'Marché public à financement extérieur 5 %'),
  standard('H', "Consignation d'emballage"),
  standard('I', 'Garantie et caution'),
  standard('J', 'Débours'),
  standard('K', 'Opérations des non-assujettis'),
  Object.freeze({
    letter: 'L',
    label: 'Prélèvements sur ventes',
    nature: 'standard',
    itemTypes: TAX_ONLY,
    outOfScopeAllowed: false,
  } as const),
  standard('M', 'Ventes réglementées à TVA spécifique'),
  // Groupe N : le montant est entièrement de la TVA et s'ajoute au total de TVA.
  Object.freeze({
    letter: 'N',
    label: 'TVA spécifique',
    nature: 'vat_only',
    itemTypes: TAX_ONLY,
    outOfScopeAllowed: false,
  } as const),
  standard('O', 'Taxable 1 %'),
  standard('P', 'Marché public à financement extérieur 1 %'),
]);

/** Source et date de la liste par défaut, affichées quand aucun instantané DGI n'existe. */
export const DEFAULT_TAX_GROUPS_SOURCE: { label: string; date: '2026-02' } = Object.freeze({
  label: 'Documentation du compte développeur DGI — groupes de taxation, v1.2',
  date: '2026-02',
});

/** Valeur imposée du code d'article pour une opération hors champ (groupe A).
 *  Orthographe à confirmer auprès de la DGI. */
export const OUT_OF_SCOPE_ITEM_CODE = 'HORS CHAMP';

// Index par lettre, construit une fois : `taxGroupDefinition` ne renvoie jamais
// `undefined` pour une lettre valide, et le type l'impose.
const BY_LETTER = new Map<TaxGroupLetter, TaxGroupDefinition>(
  DEFAULT_TAX_GROUPS.map((definition) => [definition.letter, definition]),
);

const LETTERS: readonly string[] = TAX_GROUP_LETTERS;
const TYPES: readonly string[] = ITEM_TYPES;

/** Vrai pour les seize lettres A à P exactement (pas Q à Z, pas de minuscule). */
export function isTaxGroupLetter(value: unknown): value is TaxGroupLetter {
  return typeof value === 'string' && LETTERS.includes(value);
}

/** `TAX` si et seulement si le groupe est L ou N ; `BIE` et `SER` partout ailleurs. */
export function isItemTypeAllowed(group: TaxGroupLetter, type: ItemType): boolean {
  if (!TYPES.includes(type)) return false;
  return taxGroupDefinition(group).itemTypes.includes(type);
}

/** Définition par défaut d'un groupe. Lève une erreur pour une lettre hors A–P,
 *  que le typage interdit déjà : c'est un garde-fou contre une donnée non vérifiée. */
export function taxGroupDefinition(group: TaxGroupLetter): TaxGroupDefinition {
  const definition = BY_LETTER.get(group);
  if (definition === undefined) {
    throw new RangeError(`Groupe de taxation inconnu : ${String(group)}`);
  }
  return definition;
}
