// Préremplissage d'une demande d'achat depuis les suggestions de
// réapprovisionnement des stocks — ADR-0046 § 6.1 (lot S8). Logique pure.
//
// L'URL ne porte que des IDENTIFIANTS d'articles de stock et des QUANTITÉS
// (`?articles=<id>:<quantité>,…`) : jamais un nom, un prix ni une note. Les
// désignations et unités sont relues sur l'API des stocks à l'ouverture. Aucune
// logique d'achat ne change : la demande reste un brouillon que l'utilisateur
// complète (prix du devis) et enregistre lui-même.

import { STOCK_ITEM_REF_PREFIX } from '@lalanda/shared/stock';

import { ligneVide, type LigneSaisie } from './commandes-model';

export interface ArticlePrerempli {
  itemId: string;
  quantity: string;
}

const ID = /^[0-9a-f]{24}$/i;
const QUANTITE = /^\d{1,9}(\.\d{1,3})?$/;

/** Lit `articles` ; toute entrée mal formée est ignorée, 100 lignes au plus, sans doublon. */
export function lireArticlesPreremplis(brut: string | null): ArticlePrerempli[] {
  if (brut === null || brut.trim() === '') return [];
  const vus = new Set<string>();
  const liste: ArticlePrerempli[] = [];
  for (const morceau of brut.split(',')) {
    const [id, q] = morceau.split(':');
    if (id === undefined || q === undefined || !ID.test(id) || !QUANTITE.test(q)) continue;
    const cle = id.toLowerCase();
    if (vus.has(cle) || /^[0.]+$/.test(q)) continue;
    vus.add(cle);
    liste.push({ itemId: cle, quantity: q });
    if (liste.length >= 100) break;
  }
  return liste;
}

/** Référence d'article portée par la ligne de commande (`stk:<id>`, § 6.1). */
export const refStock = (itemId: string): string => `${STOCK_ITEM_REF_PREFIX}${itemId}`;

/**
 * Lignes de la demande : désignation et unité relues sur l'article quand il est
 * lisible, sinon laissées à compléter. Le prix reste vide : il vient du devis.
 */
export function lignesPreremplies(
  articles: readonly ArticlePrerempli[],
  details: ReadonlyMap<string, { name: string; unit: string }>,
): LigneSaisie[] {
  return articles.map((a) => {
    const d = details.get(a.itemId);
    return {
      ...ligneVide(),
      label: d?.name ?? '',
      unit: d?.unit ?? '',
      quantity: a.quantity,
      kind: 'goods',
      itemRef: refStock(a.itemId),
    };
  });
}
