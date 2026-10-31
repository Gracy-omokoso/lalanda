// Niveaux par emplacement — ADR-0046 § 2.5 et § 5.1 (`GET /stock/levels`).
// Logique pure : requête et état d'affichage d'une ligne (rupture, sous le seuil).
// Le « sous le seuil » est celui du moteur (`belowReorder` de la réponse : une
// suggestion par article, seuil global ou par emplacement) ; la rupture se lit au
// signe de la quantité servie (nulle ou négative), sans aucun calcul.

import type {
  ListStockLevelsParams,
  StockLevelRowView,
  StockReorderAlertView,
} from '@/lib/api-stock';

import { estEnRupture, estNegatif, type Ton } from './stocks-model';

/** Requête de `GET /stock/levels` : la réponse est complète (pas de pagination). */
export function requeteNiveaux(locationId: string, sousSeuil: boolean): ListStockLevelsParams {
  return {
    ...(locationId ? { locationId } : {}),
    ...(sousSeuil ? { below: 'reorder' as const } : {}),
  };
}

/** Alerte du moteur qui vise cette ligne (même article ; seuil global ou de cet emplacement). */
export function alerteDe(
  r: Pick<StockLevelRowView, 'itemId' | 'locationId'>,
  alertes: readonly StockReorderAlertView[],
): StockReorderAlertView | null {
  return (
    alertes.find(
      (a) => a.itemId === r.itemId && (a.locationId === null || a.locationId === r.locationId),
    ) ?? null
  );
}

export interface EtatNiveau {
  libelle: string | null;
  ton: Ton;
}

export function etatNiveau(r: StockLevelRowView, alerte: StockReorderAlertView | null): EtatNiveau {
  if (estNegatif(r.quantity)) return { libelle: 'Négatif', ton: 'danger' };
  if (estEnRupture(r.quantity)) return { libelle: 'Rupture', ton: 'danger' };
  if (alerte !== null) return { libelle: 'Sous le seuil', ton: 'warning' };
  return { libelle: null, ton: 'neutral' };
}
