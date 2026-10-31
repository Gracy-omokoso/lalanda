// « À traiter » — ADR-0046 § 2.6 : ce qui arrive des achats ou des ventes et ne
// peut pas devenir seul un mouvement juste. Logique pure : droit par motif, ce
// qu'il faut saisir pour résoudre, corps de `POST /stock/pending/:id/resolve`.
//
// Résoudre exige `stock.move`, sauf un motif qui porte un COÛT (`pending_cost`,
// `cost_differs`) : `stock.manage`. Le coût se saisit dans la devise de
// l'article ; AUCUN taux de change n'est proposé ni appliqué.

import { STOCK_PENDING_REASONS_REQUIRING_MANAGE } from '@lalanda/shared/stock';

import type { OrgAction } from '@/lib/api';
import type {
  StockPendingLineView,
  StockPendingReason,
  StockPendingResolveInput,
} from '@/lib/api-stock';

import {
  lireCoutSaisi,
  lireQuantiteSaisie,
  peutGererStocks,
  peutMouvementer,
  peutVoirValeurs,
} from './stocks-model';

type Actions = readonly OrgAction[] | null;

export type FiltreATraiter = 'tous' | StockPendingReason;

export const FILTRES_A_TRAITER: readonly { valeur: FiltreATraiter; label: string }[] = [
  { valeur: 'tous', label: 'Tout' },
  { valeur: 'unknown_item', label: 'Articles non reconnus' },
  { valeur: 'unknown_unit', label: 'Unités inconnues' },
  { valeur: 'pending_cost', label: 'Coûts à saisir' },
  { valeur: 'sale_return_proposed', label: 'Retours de vente' },
  { valeur: 'cost_differs', label: 'Coûts différents' },
];

export const RAISON_COUT =
  'Saisir un coût change la valeur du stock : réservé aux gestionnaires des stocks.';
export const RAISON_SANS_MOUVEMENT = 'Réservé aux rôles qui mouvementent le stock.';

/** Peut-on résoudre ou classer une ligne de ce motif ? Sinon, pourquoi. */
export function droitATraiter(
  reason: StockPendingReason,
  actions: Actions,
): { actif: boolean; raison: string | null } {
  if (STOCK_PENDING_REASONS_REQUIRING_MANAGE.includes(reason)) {
    return peutGererStocks(actions)
      ? { actif: true, raison: null }
      : { actif: false, raison: RAISON_COUT };
  }
  return peutMouvementer(actions)
    ? { actif: true, raison: null }
    : { actif: false, raison: RAISON_SANS_MOUVEMENT };
}

/** Ce que la résolution demande, motif par motif (§ 2.6). */
export interface ChampsResolution {
  article: boolean;
  facteur: boolean;
  quantite: boolean;
  cout: boolean;
  emplacement: boolean;
  /** Phrase d'explication en tête de la fenêtre. */
  explication: string;
  /** Libellé du bouton de classement (« ne pas stocker », « pas de retour »…). */
  classer: string;
}

export function champsResolution(reason: StockPendingReason): ChampsResolution {
  const rien = { article: false, facteur: false, quantite: false, cout: false, emplacement: false };
  switch (reason) {
    case 'unknown_item':
      return {
        ...rien,
        article: true,
        explication:
          'Cette ligne de réception ne désigne aucun article. Rattachez-la : le rattachement servira aux réceptions suivantes de la même commande.',
        classer: 'Ne pas stocker',
      };
    case 'unknown_unit':
      return {
        ...rien,
        facteur: true,
        explication:
          'L’unité de la ligne n’est pas une unité de l’article. Indiquez combien d’unités de stock elle vaut : la conversion est ajoutée à l’article.',
        classer: 'Ne pas stocker',
      };
    case 'pending_cost':
      return {
        ...rien,
        cout: true,
        explication:
          'La commande est dans une autre devise que celle de l’article. Saisissez le coût unitaire dans la devise de l’article : aucun taux n’est appliqué.',
        classer: 'Classer',
      };
    case 'sale_return_proposed':
      return {
        ...rien,
        quantite: true,
        emplacement: true,
        explication:
          'Un avoir vise cet article. Confirmez la quantité physiquement revenue et où elle est rangée ; une remise ou une correction de prix n’a pas de retour.',
        classer: 'Pas de retour physique',
      };
    case 'cost_differs':
      return {
        ...rien,
        cout: true,
        explication:
          'Le coût d’entrée diffère du prix de la facture fournisseur. Corrigez le coût, ou classez si l’écart est justifié.',
        classer: 'Classer',
      };
  }
}

export interface SaisieResolution {
  itemId: string;
  factor: string;
  quantity: string;
  unitCost: string;
  locationId: string;
}

export const SAISIE_VIDE: SaisieResolution = {
  itemId: '',
  factor: '',
  quantity: '',
  unitCost: '',
  locationId: '',
};

/** Corps de la résolution, ou les erreurs par champ (`article`, `facteur`, `quantite`, `cout`, `emplacement`). */
export function preparerResolution(
  ligne: Pick<StockPendingLineView, 'reason' | 'revision'>,
  s: SaisieResolution,
): { ok: true; corps: StockPendingResolveInput } | { ok: false; champs: Record<string, string> } {
  const c = champsResolution(ligne.reason);
  const champs: Record<string, string> = {};
  const corps: StockPendingResolveInput = { expectedRevision: ligne.revision };
  if (c.article) {
    if (s.itemId === '') champs['article'] = 'Choisissez l’article.';
    else corps.itemId = s.itemId;
  }
  if (c.facteur) {
    const f = lireCoutSaisi(s.factor);
    if (!f.ok || /^[0.]+$/.test(f.valeur))
      champs['facteur'] = 'Facteur positif, six décimales au plus.';
    else corps.factor = f.valeur;
  }
  if (c.quantite) {
    const q = lireQuantiteSaisie(s.quantity);
    if (!q.ok) champs['quantite'] = q.erreur;
    else corps.quantity = q.valeur;
  }
  if (c.cout) {
    const k = lireCoutSaisi(s.unitCost);
    if (!k.ok) champs['cout'] = k.erreur;
    else corps.unitCost = k.valeur;
  }
  if (c.emplacement) {
    if (s.locationId === '') champs['emplacement'] = 'Choisissez l’emplacement.';
    else corps.locationId = s.locationId;
  }
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return { ok: true, corps };
}

/**
 * Lignes affichées : celles d'un motif de COÛT ne montrent leur devise et leur
 * coût qu'aux rôles qui voient les valeurs ; le Magasinier voit qu'elles existent.
 */
export function deviseVisible(ligne: StockPendingLineView, actions: Actions): string | null {
  return peutVoirValeurs(actions) ? (ligne.currency ?? null) : null;
}
