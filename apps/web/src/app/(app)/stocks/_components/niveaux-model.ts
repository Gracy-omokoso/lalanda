// Niveaux par emplacement — ADR-0046 § 2.5 et § 5.1 (`GET /stock/levels`).
// Logique pure : requête et état d'affichage d'une ligne (rupture, sous le seuil).
// Le « sous le seuil » est celui du moteur (`belowReorder`) ; la rupture se lit
// au signe de la quantité servie (nulle ou négative), sans aucun calcul.

import type { ListStockLevelsParams, StockLevelRowView } from '@/lib/api-stock';

import { estEnRupture, estNegatif, type Ton } from './stocks-model';

export function requeteNiveaux(
  locationId: string,
  sousSeuil: boolean,
  cursor: string | null = null,
): ListStockLevelsParams {
  return {
    limit: 100,
    ...(locationId ? { locationId } : {}),
    ...(sousSeuil ? { below: 'reorder' as const } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

export interface EtatNiveau {
  libelle: string | null;
  ton: Ton;
}

export function etatNiveau(r: StockLevelRowView): EtatNiveau {
  if (estNegatif(r.quantity)) return { libelle: 'Négatif', ton: 'danger' };
  if (estEnRupture(r.quantity)) return { libelle: 'Rupture', ton: 'danger' };
  if (r.belowReorder === true) return { libelle: 'Sous le seuil', ton: 'warning' };
  return { libelle: null, ton: 'neutral' };
}
