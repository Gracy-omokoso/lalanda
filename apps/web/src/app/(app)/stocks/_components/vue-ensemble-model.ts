// Vue d'ensemble des stocks — ADR-0046 § 5.1, § 6.6 : ruptures, sous le seuil,
// « À traiter », valeur (si autorisée). Logique pure.
//
// Chaque tuile lit SA route ; une route absente (404 : lot pas encore fusionné),
// refusée (403) ou en panne donne une PHRASE à la place du chiffre, jamais un
// zéro inventé. La valeur vient du moteur (`GET /stock/valuation`), une ligne
// par devise, jamais de total toutes devises ; elle n'existe que pour un rôle
// qui voit les valeurs.

import type { OrgAction } from '@/lib/api';
import type { StockLevelRowView, StockPage, StockValuationView } from '@/lib/api-stock';

import {
  STOCKS_BASE,
  estEnRupture,
  formatValeur,
  phraseIndisponible,
  valeursAffichees,
  type Lecture,
} from './stocks-model';

export type EtatTuile =
  | { etat: 'connu'; lignes: string[]; detail: string | null; attention: boolean }
  | { etat: 'indisponible'; phrase: string };

export interface TuileVue {
  id: 'ruptures' | 'sous-seuil' | 'a-traiter' | 'valeur';
  libelle: string;
  lien: string | null;
  contenu: EtatTuile;
}

export interface PageLue {
  items: readonly unknown[];
  nextCursor: string | null;
}

export interface LecturesVue {
  /** `GET /stock/levels` : toutes les lignes (`levels`), réponse complète. */
  niveaux: Lecture<StockPage<StockLevelRowView>>;
  /** `GET /stock/levels?below=reorder`. */
  sousSeuil: Lecture<PageLue>;
  /** `GET /stock/pending?status=open`. */
  aTraiter: Lecture<PageLue>;
  /** `GET /stock/valuation` ; `null` : non demandée (rôle sans valeurs). */
  valorisation: Lecture<StockValuationView> | null;
}

/** « 3 », ou « 50 et plus » quand la page suivante existe (aucun total inventé). */
export function compteDePage(n: number, suite: boolean): string {
  return suite ? `${n} et plus` : String(n);
}

function tuileCompte(lu: Lecture<PageLue>): EtatTuile {
  if (!lu.ok) return { etat: 'indisponible', phrase: phraseIndisponible(lu.erreur) };
  const n = lu.valeur.items.length;
  return {
    etat: 'connu',
    lignes: [compteDePage(n, lu.valeur.nextCursor !== null)],
    detail: null,
    attention: n > 0,
  };
}

/** Lignes (article × emplacement) en rupture : quantité nulle ou négative. */
export function lignesEnRupture(rows: readonly StockLevelRowView[]): StockLevelRowView[] {
  return rows.filter((r) => estEnRupture(r.quantity));
}

function tuileRuptures(lu: Lecture<StockPage<StockLevelRowView>>): EtatTuile {
  if (!lu.ok) return { etat: 'indisponible', phrase: phraseIndisponible(lu.erreur) };
  const n = lignesEnRupture(lu.valeur.items).length;
  // Page incomplète : on ne sait que « au moins n ».
  const suite = lu.valeur.nextCursor !== null;
  return {
    etat: 'connu',
    lignes: [suite ? `Au moins ${n}` : String(n)],
    detail: 'Quantité nulle ou négative à un emplacement',
    attention: n > 0,
  };
}

function tuileValeur(
  lu: Lecture<StockValuationView>,
  actions: readonly OrgAction[] | null,
): EtatTuile {
  if (!lu.ok) return { etat: 'indisponible', phrase: phraseIndisponible(lu.erreur) };
  // `GET /stock/valuation` exige de voir les valeurs (403 sinon) : la réponse n'a pas
  // de champ masqué, seul le rôle décide.
  if (!valeursAffichees(actions, false)) {
    return { etat: 'indisponible', phrase: 'Masquée pour votre rôle' };
  }
  const lignes = lu.valeur.byCurrency.map((c) => formatValeur(c.value, c.currency));
  const incomplete = lu.valeur.byCurrency.some((c) => !c.complete);
  return {
    etat: 'connu',
    lignes: lignes.length === 0 ? ['Aucune'] : lignes,
    detail: incomplete
      ? 'Incomplète : des entrées attendent leur coût'
      : 'Coût moyen pondéré, mesure de gestion',
    attention: false,
  };
}

/**
 * Tuiles de la vue d'ensemble. La tuile « Valeur du stock » n'existe que pour
 * un rôle qui voit les valeurs (`valorisation !== null`) : le Magasinier ne la
 * voit pas, même vide.
 */
export function tuilesVue(actions: readonly OrgAction[] | null, l: LecturesVue): TuileVue[] {
  const tuiles: TuileVue[] = [
    {
      id: 'ruptures',
      libelle: 'Ruptures',
      lien: `${STOCKS_BASE}/niveaux`,
      contenu: tuileRuptures(l.niveaux),
    },
    {
      id: 'sous-seuil',
      libelle: 'Sous le seuil',
      lien: `${STOCKS_BASE}/reapprovisionnement`,
      contenu: tuileCompte(l.sousSeuil),
    },
    {
      id: 'a-traiter',
      libelle: 'À traiter',
      lien: `${STOCKS_BASE}/a-traiter`,
      contenu: tuileCompte(l.aTraiter),
    },
  ];
  if (l.valorisation !== null) {
    tuiles.push({
      id: 'valeur',
      libelle: 'Valeur du stock',
      lien: null,
      contenu: tuileValeur(l.valorisation, actions),
    });
  }
  return tuiles;
}
