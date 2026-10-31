// Inventaires — ADR-0046 § 2.7 et § 5.1. Logique pure : liste, création
// (`stock.manage`), saisie du comptage (`stock.count`, pensée pour un téléphone),
// écarts (rendus par le moteur) et validation (`stock.manage`).
//
// SÉPARATION DES TÂCHES : celui qui a compté une ligne ne valide pas
// (`409 COUNT_SELF_VALIDATION`) ; le bouton reste visible, DÉSACTIVÉ, avec sa
// raison. Exception de l'approbateur unique : seule l'API sait combien de
// gestionnaires effectifs l'organisation compte ; quand elle sert `canValidate`,
// son jugement l'emporte. Comptage à l'aveugle : le compteur ne reçoit pas la
// quantité théorique (l'API la retire), l'écran n'affiche que ce qu'il reçoit.

import { STOCK_LIMITS } from '@lalanda/shared/stock';

import type { OrgAction } from '@/lib/api';
import type {
  ListStockCountsParams,
  StockCountInput,
  StockCountLineView,
  StockCountScope,
  StockCountStatus,
  StockCountView,
} from '@/lib/api-stock';

import {
  lireQuantiteSaisie,
  peutCompter,
  peutGererStocks,
  type LectureSaisie,
} from './stocks-model';

type Actions = readonly OrgAction[] | null;

// ── Liste ───────────────────────────────────────────────────────────────────

export type FiltreInventaires = StockCountStatus | 'tous';

export const FILTRES_INVENTAIRES: readonly { valeur: FiltreInventaires; label: string }[] = [
  { valeur: 'counting', label: 'À compter' },
  { valeur: 'submitted', label: 'À valider' },
  { valeur: 'draft', label: 'En préparation' },
  { valeur: 'validated', label: 'Validés' },
  { valeur: 'tous', label: 'Tous' },
];

export function requeteInventaires(
  f: FiltreInventaires,
  cursor: string | null = null,
): ListStockCountsParams {
  const base: ListStockCountsParams = { limit: 50, ...(cursor ? { cursor } : {}) };
  if (f === 'tous') return base;
  return { ...base, status: f };
}

/** « 12 lignes comptées sur 40 » : décompte des lignes servies (aucune quantité calculée). */
export function progression(c: Pick<StockCountView, 'lines'>): {
  comptees: number;
  total: number;
  phrase: string;
} {
  const total = c.lines.length;
  const comptees = c.lines.filter((l) => l.countedQuantity !== null).length;
  const s = (n: number): string => (n > 1 ? 's' : '');
  return {
    comptees,
    total,
    phrase: `${comptees} ligne${s(comptees)} comptée${s(comptees)} sur ${total}`,
  };
}

// ── Création ────────────────────────────────────────────────────────────────

export interface FormulaireInventaire {
  locationId: string;
  scope: StockCountScope;
  itemIds: string[];
  blind: boolean;
  assignees: string[];
}

export const formulaireInventaire = (locationId = ''): FormulaireInventaire => ({
  locationId,
  scope: 'all',
  itemIds: [],
  blind: true,
  assignees: [],
});

export function preparerInventaire(
  f: FormulaireInventaire,
): { ok: true; corps: StockCountInput } | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  if (f.locationId === '') champs['location'] = 'Choisissez l’emplacement à compter.';
  if (f.scope === 'items') {
    if (f.itemIds.length === 0) champs['items'] = 'Choisissez au moins un article.';
    if (f.itemIds.length > STOCK_LIMITS.countItems) champs['items'] = '500 articles au plus.';
  }
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      locationId: f.locationId,
      scope: f.scope,
      ...(f.scope === 'items' ? { itemIds: [...new Set(f.itemIds)] } : {}),
      blind: f.blind,
      assignees: [...new Set(f.assignees)],
    },
  };
}

// ── Saisie du comptage ──────────────────────────────────────────────────────

export const peutSaisirComptage = (c: Pick<StockCountView, 'status'>, actions: Actions): boolean =>
  c.status === 'counting' && peutCompter(actions);

/** Quantité comptée saisie : zéro permis (un article absent se compte « 0 »). */
export function lireComptage(saisie: string): LectureSaisie {
  return lireQuantiteSaisie(saisie, true);
}

export type FiltreLignes = 'a-compter' | 'comptees' | 'toutes';

/** Lignes affichées au téléphone : filtre et recherche par nom ou code. */
export function lignesAffichees(
  lignes: readonly StockCountLineView[],
  filtre: FiltreLignes,
  recherche: string,
): StockCountLineView[] {
  const q = recherche.trim().toLowerCase();
  return lignes.filter((l) => {
    if (filtre === 'a-compter' && l.countedQuantity !== null) return false;
    if (filtre === 'comptees' && l.countedQuantity === null) return false;
    if (q === '') return true;
    return l.itemName.toLowerCase().includes(q) || (l.itemCode ?? '').toLowerCase().includes(q);
  });
}

/**
 * Quantité théorique à montrer : celle que l'API a servie, jamais pour un
 * inventaire à l'aveugle tant qu'il est en comptage (le compteur ne la voit pas).
 */
export function theoriqueAffichee(
  c: Pick<StockCountView, 'blind' | 'status'>,
  l: StockCountLineView,
): string | null {
  if (c.blind && c.status === 'counting') return null;
  return l.theoreticalQuantity ?? null;
}

// ── Gestes ──────────────────────────────────────────────────────────────────

export type IdGesteInventaire = 'demarrer' | 'soumettre' | 'valider' | 'annuler';

export interface GesteInventaire {
  id: IdGesteInventaire;
  libelle: string;
  actif: boolean;
  raison: string | null;
}

export const RAISON_COMPTEUR =
  'Vous avez compté une ligne de cet inventaire : un autre gestionnaire des stocks doit le valider (séparation des tâches).';
export const RAISON_SANS_GESTION =
  'Réservé aux gestionnaires des stocks (la validation crée les écarts).';
export const RAISON_RIEN_COMPTE = 'Comptez au moins une ligne avant de soumettre.';

/** L'utilisateur a-t-il compté au moins une ligne ? */
export function aCompte(c: Pick<StockCountView, 'lines'>, moi: string | null): boolean {
  return moi !== null && c.lines.some((l) => l.countedBy === moi);
}

/** Gestes proposés selon le statut, les droits et la séparation des tâches. */
export function gestesInventaire(
  c: StockCountView,
  actions: Actions,
  moi: string | null,
): GesteInventaire[] {
  const gerer = peutGererStocks(actions);
  const gestes: GesteInventaire[] = [];
  const annuler = (): void => {
    if (gerer)
      gestes.push({ id: 'annuler', libelle: 'Annuler l’inventaire', actif: true, raison: null });
  };
  switch (c.status) {
    case 'draft':
      if (gerer)
        gestes.push({ id: 'demarrer', libelle: 'Ouvrir le comptage', actif: true, raison: null });
      annuler();
      break;
    case 'counting': {
      if (peutCompter(actions)) {
        const rien = progression(c).comptees === 0;
        gestes.push({
          id: 'soumettre',
          libelle: 'Soumettre le comptage',
          actif: !rien,
          raison: rien ? RAISON_RIEN_COMPTE : null,
        });
      }
      annuler();
      break;
    }
    case 'submitted': {
      let raison: string | null = null;
      if (!gerer) raison = RAISON_SANS_GESTION;
      else if (c.canValidate) raison = c.canValidate.allowed ? null : RAISON_COMPTEUR;
      else if (aCompte(c, moi)) raison = RAISON_COMPTEUR;
      gestes.push({ id: 'valider', libelle: 'Valider les écarts', actif: raison === null, raison });
      annuler();
      break;
    }
    default:
      break;
  }
  return gestes;
}

/** Mention de l'approbateur unique, quand l'API l'annonce. */
export function mentionApprobateurUnique(
  c: Pick<StockCountView, 'canValidate' | 'validation'>,
): string | null {
  if (c.validation?.soleApprover || c.canValidate?.soleApprover) {
    return 'Seul gestionnaire des stocks de l’organisation : la validation de son propre comptage est permise et journalisée.';
  }
  return null;
}
