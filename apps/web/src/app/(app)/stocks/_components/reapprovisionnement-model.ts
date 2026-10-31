// Réapprovisionnement — ADR-0046 § 5.1, § 6.1 (`GET /stock/replenishment`).
// Logique pure : regroupement des suggestions du moteur par fournisseur
// habituel, et lien vers le formulaire EXISTANT de demande d'achat (R3),
// prérempli par des IDENTIFIANTS et des QUANTITÉS seulement (aucun nom, aucun
// prix dans l'URL). Rien n'est jamais créé ni envoyé d'ici : la demande n'existe
// que si l'utilisateur, détenteur de `purchase.request`, l'enregistre.

import type { OrgAction } from '@/lib/api';
import type { StockReplenishmentSuggestionView } from '@/lib/api-stock';

import { estNul } from './stocks-model';

export interface GroupeFournisseur {
  /** `null` : articles sans fournisseur habituel. */
  supplierId: string | null;
  supplierName: string | null;
  suggestions: StockReplenishmentSuggestionView[];
}

/** Regroupe par fournisseur habituel, dans l'ordre d'arrivée ; « sans fournisseur » en dernier. */
export function groupesParFournisseur(
  suggestions: readonly StockReplenishmentSuggestionView[],
): GroupeFournisseur[] {
  const groupes = new Map<string, GroupeFournisseur>();
  for (const s of suggestions) {
    const cle = s.preferredSupplierId ?? '';
    const g = groupes.get(cle) ?? {
      supplierId: s.preferredSupplierId,
      // Le nom du fournisseur n'est pas servi par l'API des stocks (un Magasinier ne
      // lit pas les fiches fournisseurs) : l'écran affiche un libellé générique.
      supplierName: null,
      suggestions: [],
    };
    g.suggestions.push(s);
    groupes.set(cle, g);
  }
  const liste = [...groupes.values()];
  return [
    ...liste.filter((g) => g.supplierId !== null),
    ...liste.filter((g) => g.supplierId === null),
  ];
}

/** Paramètre d'URL des articles préremplis : `id:quantité` séparés par des virgules. */
export const PARAM_ARTICLES = 'articles';

/**
 * Lien « Préparer une demande d'achat » : formulaire R3 ouvert (`?nouvelle=1`),
 * fournisseur et lignes `stk:<id>` préremplis. Une suggestion nulle est omise ;
 * `null` si rien n'est à commander. Au plus 100 lignes (borne d'une commande).
 */
export function lienDemandeAchat(
  supplierId: string | null,
  suggestions: readonly Pick<StockReplenishmentSuggestionView, 'itemId' | 'suggestedQuantity'>[],
): string | null {
  const lignes = suggestions
    .filter((s) => !estNul(s.suggestedQuantity))
    .slice(0, 100)
    .map((s) => `${s.itemId}:${s.suggestedQuantity}`);
  if (lignes.length === 0) return null;
  const q = new URLSearchParams({ nouvelle: '1' });
  if (supplierId) q.set('fournisseur', supplierId);
  q.set(PARAM_ARTICLES, lignes.join(','));
  return `/achats/commandes?${q.toString()}`;
}

export const RAISON_SANS_DEMANDE =
  'Préparer une demande d’achat est réservé aux rôles qui demandent des achats.';

/** Le bouton « Préparer une demande d'achat » : visible pour tous, actif avec `purchase.request`. */
export function boutonDemande(actions: readonly OrgAction[] | null): {
  actif: boolean;
  raison: string | null;
} {
  const ok =
    actions !== null && actions.includes('purchase.request') && actions.includes('purchase.read');
  return ok ? { actif: true, raison: null } : { actif: false, raison: RAISON_SANS_DEMANDE };
}
