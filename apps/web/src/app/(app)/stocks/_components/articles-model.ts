// Articles stockés — ADR-0046 § 2.1 et § 5.1. Logique pure.
//
// Liste filtrable, formulaire de création et de modification (fenêtre modale,
// `stock.manage`), gestes de la fiche. Quantités, coût moyen et valeur viennent
// de l'API ; ce module n'en calcule aucun.

import { STOCK_LIMITS } from '@lalanda/shared/stock';

import type { OrgAction } from '@/lib/api';
import type {
  ListStockItemsParams,
  StockCurrency,
  StockItemInput,
  StockItemKind,
  StockItemView,
} from '@/lib/api-stock';

import {
  estNul,
  lireCoutSaisi,
  lireQuantiteSaisie,
  peutGererStocks,
  quantitePourSaisie,
} from './stocks-model';

type Actions = readonly OrgAction[] | null;

// ── Liste ───────────────────────────────────────────────────────────────────

export type FiltreArticles = 'actifs' | StockItemKind | 'archives';

export const FILTRES_ARTICLES: readonly { valeur: FiltreArticles; label: string }[] = [
  { valeur: 'actifs', label: 'Tous les actifs' },
  { valeur: 'goods', label: 'Marchandises' },
  { valeur: 'consumable', label: 'Consommables' },
  { valeur: 'material', label: 'Matières et pièces' },
  { valeur: 'archives', label: 'Archivés' },
];

export function requeteArticles(
  filtre: FiltreArticles,
  q: string,
  cursor: string | null = null,
): ListStockItemsParams {
  const base: ListStockItemsParams = {
    limit: 50,
    ...(cursor ? { cursor } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  };
  if (filtre === 'archives') return { ...base, active: 'false' };
  if (filtre === 'actifs') return { ...base, active: 'true' };
  return { ...base, active: 'true', kind: filtre };
}

// ── Formulaire ──────────────────────────────────────────────────────────────

export interface ConversionSaisie {
  unit: string;
  factor: string;
}

export interface FormulaireArticle {
  code: string;
  name: string;
  description: string;
  kind: StockItemKind;
  unit: string;
  costCurrency: StockCurrency;
  tracked: boolean;
  defaultLocationId: string;
  catalogItemId: string;
  preferredSupplierId: string;
  minQuantity: string;
  targetQuantity: string;
  reorderLocationId: string;
  conversions: ConversionSaisie[];
}

/** Formulaire vide, ou prérempli d'un article existant (modification). */
export function formulaireArticle(
  article: StockItemView | null,
  devise: StockCurrency = 'USD',
): FormulaireArticle {
  if (article === null) {
    return {
      code: '',
      name: '',
      description: '',
      kind: 'goods',
      unit: 'pièce',
      costCurrency: devise,
      tracked: true,
      defaultLocationId: '',
      catalogItemId: '',
      preferredSupplierId: '',
      minQuantity: '',
      targetQuantity: '',
      reorderLocationId: '',
      conversions: [],
    };
  }
  return {
    code: article.code ?? '',
    name: article.name,
    description: article.description ?? '',
    kind: article.kind,
    unit: article.unit,
    costCurrency: article.costCurrency,
    tracked: article.tracked,
    defaultLocationId: article.defaultLocationId ?? '',
    catalogItemId: article.catalogItemId ?? '',
    preferredSupplierId: article.preferredSupplierId ?? '',
    minQuantity: quantitePourSaisie(article.reorder?.minQuantity ?? null),
    targetQuantity: quantitePourSaisie(article.reorder?.targetQuantity ?? null),
    reorderLocationId: article.reorder?.locationId ?? '',
    conversions: article.unitConversions.map((c) => ({
      unit: c.unit,
      factor: quantitePourSaisie(c.factor),
    })),
  };
}

const ouNul = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/**
 * Vérification locale et corps de `POST /stock/items` (ou `PUT`). L'API reste
 * juge (code unique, article du catalogue de type bien, unité verrouillée).
 * Clés d'erreur : `name`, `code`, `unit`, `description`, `minQuantity`,
 * `targetQuantity`, `conversion-<i>-unit|factor`.
 */
export function preparerArticle(
  f: FormulaireArticle,
): { ok: true; corps: StockItemInput } | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  const name = f.name.trim();
  if (name === '') champs['name'] = 'Le nom de l’article est obligatoire.';
  else if (name.length > STOCK_LIMITS.itemName) champs['name'] = '200 caractères au plus.';
  if (f.code.trim().length > STOCK_LIMITS.itemCode) champs['code'] = '40 caractères au plus.';
  if (f.description.length > STOCK_LIMITS.itemDescription) {
    champs['description'] = '2 000 caractères au plus.';
  }
  const unit = f.unit.trim();
  if (unit === '') champs['unit'] = 'L’unité de stock est obligatoire (pièce, kg, carton…).';
  else if (unit.length > STOCK_LIMITS.unit) champs['unit'] = '20 caractères au plus.';

  let reorder: StockItemInput['reorder'] = null;
  if (f.minQuantity.trim() !== '' || f.targetQuantity.trim() !== '') {
    const min = lireQuantiteSaisie(f.minQuantity, true);
    if (!min.ok) champs['minQuantity'] = min.erreur;
    let cible: string | null = null;
    if (f.targetQuantity.trim() !== '') {
      const t = lireQuantiteSaisie(f.targetQuantity, true);
      if (!t.ok) champs['targetQuantity'] = t.erreur;
      else cible = t.valeur;
    }
    if (min.ok) {
      reorder = {
        minQuantity: min.valeur,
        targetQuantity: cible,
        locationId: ouNul(f.reorderLocationId),
      };
    }
  }

  if (f.conversions.length > STOCK_LIMITS.unitConversions) {
    champs['conversions'] = 'Cinq conversions au plus.';
  }
  const vues = new Set<string>();
  const conversions: { unit: string; factor: string }[] = [];
  f.conversions.forEach((c, i) => {
    const u = c.unit.trim();
    if (u === '') champs[`conversion-${i}-unit`] = 'Unité obligatoire.';
    else if (u.toLowerCase() === unit.toLowerCase()) {
      champs[`conversion-${i}-unit`] = 'C’est déjà l’unité de stock.';
    } else if (vues.has(u.toLowerCase())) champs[`conversion-${i}-unit`] = 'Unité en double.';
    vues.add(u.toLowerCase());
    const facteur = lireCoutSaisi(c.factor);
    if (!facteur.ok || /^[0.]+$/.test(facteur.valeur)) {
      champs[`conversion-${i}-factor`] = 'Facteur positif, six décimales au plus.';
    } else if (u !== '') {
      conversions.push({ unit: u, factor: facteur.valeur });
    }
  });

  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      code: ouNul(f.code),
      name,
      description: ouNul(f.description),
      kind: f.kind,
      unit,
      unitConversions: conversions,
      costCurrency: f.costCurrency,
      tracked: f.tracked,
      defaultLocationId: ouNul(f.defaultLocationId),
      catalogItemId: ouNul(f.catalogItemId),
      preferredSupplierId: ouNul(f.preferredSupplierId),
      reorder,
    },
  };
}

// ── Fiche ───────────────────────────────────────────────────────────────────

export interface GesteArticle {
  id: 'modifier' | 'archiver' | 'restaurer';
  libelle: string;
  actif: boolean;
  raison: string | null;
}

export const RAISON_STOCK_RESTANT =
  'Il reste du stock de cet article : sortez-le ou ajustez-le avant de l’archiver.';

/**
 * Gestes proposés sur la fiche d'un article (`stock.manage`). Archiver un article
 * dont la quantité n'est pas nulle reste visible mais désactivé, avec sa raison.
 */
export function gestesArticle(article: StockItemView, actions: Actions): GesteArticle[] {
  if (!peutGererStocks(actions)) return [];
  const gestes: GesteArticle[] = [
    { id: 'modifier', libelle: 'Modifier', actif: true, raison: null },
  ];
  if (article.active) {
    const vide = estNul(article.quantity);
    gestes.push({
      id: 'archiver',
      libelle: 'Archiver',
      actif: vide,
      raison: vide ? null : RAISON_STOCK_RESTANT,
    });
  } else {
    gestes.push({ id: 'restaurer', libelle: 'Restaurer', actif: true, raison: null });
  }
  return gestes;
}

/** Phrase du seuil : « Seuil 10, cible 30 (Magasin principal) », ou « Aucun seuil ». */
export function phraseSeuil(
  article: Pick<StockItemView, 'reorder' | 'unit'>,
  nomEmplacement: (id: string) => string | null,
  formatQ: (q: string, u?: string | null) => string,
): string {
  const r = article.reorder;
  if (r === null) return 'Aucun seuil';
  const ou =
    r.locationId === null
      ? 'tous emplacements'
      : (nomEmplacement(r.locationId) ?? 'un emplacement');
  const cible = r.targetQuantity === null ? '' : `, cible ${formatQ(r.targetQuantity)}`;
  return `Seuil ${formatQ(r.minQuantity, article.unit)}${cible} (${ou})`;
}
