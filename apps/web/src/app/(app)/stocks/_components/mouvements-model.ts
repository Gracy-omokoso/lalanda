// Grand livre des mouvements — ADR-0046 § 2.3 et § 5.1
// (`GET /stock/items/:id/movements`). Logique pure : filtres → requête, lecture
// d'un mouvement pour l'affichage. Le grand livre est en AJOUT SEUL : une
// annulation est un mouvement inverse, jamais un effacement.

import { STOCK_MOVEMENT_KINDS } from '@lalanda/shared/stock';

import type {
  ListStockMovementsParams,
  StockMovementKind,
  StockMovementView,
} from '@/lib/api-stock';

import { LIBELLES_MOUVEMENT } from './stocks-model';

export interface FiltresMouvements {
  locationId: string;
  kind: StockMovementKind | '';
  from: string;
  to: string;
}

export const FILTRES_VIDES: FiltresMouvements = { locationId: '', kind: '', from: '', to: '' };

export const OPTIONS_NATURE: readonly { valeur: StockMovementKind; label: string }[] =
  STOCK_MOVEMENT_KINDS.map((k) => ({ valeur: k, label: LIBELLES_MOUVEMENT[k] }));

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Filtres → requête. Une période inversée (du > au) est refusée localement :
 * les dates civiles `AAAA-MM-JJ` se comparent comme des chaînes.
 */
export function requeteMouvements(
  f: FiltresMouvements,
  cursor: string | null = null,
): { ok: true; requete: ListStockMovementsParams } | { ok: false; erreur: string } {
  if (f.from !== '' && !JOUR.test(f.from)) return { ok: false, erreur: 'Date de début invalide.' };
  if (f.to !== '' && !JOUR.test(f.to)) return { ok: false, erreur: 'Date de fin invalide.' };
  if (f.from !== '' && f.to !== '' && f.from > f.to) {
    return { ok: false, erreur: 'La date de début doit précéder la date de fin.' };
  }
  return {
    ok: true,
    requete: {
      limit: 50,
      ...(f.locationId ? { locationId: f.locationId } : {}),
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.from ? { from: f.from } : {}),
      ...(f.to ? { to: f.to } : {}),
      ...(cursor ? { cursor } : {}),
    },
  };
}

/** Phrase d'origine : pièce lisible servie par l'API, sinon la nature de la source. */
export function origineMouvement(m: StockMovementView): string | null {
  if (m.sourceLabel) return m.sourceLabel;
  switch (m.source?.kind) {
    case 'reception':
      return 'Réception d’achat';
    case 'invoice':
      return 'Facture de vente';
    case 'voucher':
      return 'Bon';
    case 'count':
      return 'Inventaire';
    case 'pending':
      return 'Ligne à traiter';
    default:
      return null;
  }
}

/** Coût affiché : seulement une entrée valorisée, et seulement si les valeurs sont visibles. */
export function coutAffiche(m: StockMovementView, valeurs: boolean): string | null {
  if (!valeurs) return null;
  if (m.costStatus === 'pending_cost') return 'coût à saisir';
  return m.unitCost;
}
