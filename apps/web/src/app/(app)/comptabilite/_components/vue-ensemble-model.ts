// Vue d'ensemble de la comptabilité (ADR-0049 § 13) : mode et bandeau ; réserves EN
// PREMIER ; solde du compte d'attente ; « À comptabiliser » ; dernières clôtures ;
// rapprochement du mois avec le réalisé. Logique pure.
//
// Chaque bloc lit SA route ; une route pas encore livrée (404) donne « bientôt
// disponible », jamais un zéro inventé. Le solde d'attente est celui que le moteur
// rapporte dans la réserve `SUSPENSE_BALANCE` : rien n'est additionné ici.

import type { AccountingMode } from '@lalanda/shared/accounting';

import type {
  AccountingFiscalYearView,
  AccountingPage,
  AccountingPendingView,
  AccountingReserveView,
  AccountingTrialBalanceView,
} from '@/lib/api-accounting';

import { formatValeur, libelleMois, phraseIndisponible, type Lecture } from './comptabilite-model';

export type EtatTuile =
  | { etat: 'connu'; valeur: string; detail: string | null; attention: boolean }
  | { etat: 'indisponible'; phrase: string };

export interface TuileVue {
  id: 'attente' | 'a-comptabiliser' | 'reserves';
  libelle: string;
  lien: string | null;
  contenu: EtatTuile;
}

/**
 * Réserves à afficher en tête : celles que l'API rend avec la balance du mois.
 * `null` si la balance est illisible (la phrase d'indisponibilité s'affiche alors).
 */
export function reservesDe(
  balance: Lecture<AccountingTrialBalanceView>,
): AccountingReserveView[] | null {
  return balance.ok ? balance.valeur.reserves : null;
}

function tuileAttente(balance: Lecture<AccountingTrialBalanceView>): EtatTuile {
  if (!balance.ok) return { etat: 'indisponible', phrase: phraseIndisponible(balance.erreur) };
  const r = balance.valeur.reserves.find((x) => x.code === 'SUSPENSE_BALANCE');
  if (r === undefined) {
    return {
      etat: 'connu',
      valeur: 'Soldé',
      detail: 'Aucune opération à classer',
      attention: false,
    };
  }
  const montant = r.details['balance'];
  return {
    etat: 'connu',
    valeur:
      typeof montant === 'string'
        ? formatValeur(montant, balance.valeur.bookCurrency)
        : 'Non soldé',
    detail: 'Des opérations restent à classer',
    attention: true,
  };
}

function tuileACompter(l: Lecture<AccountingPage<AccountingPendingView>>): EtatTuile {
  if (!l.ok) return { etat: 'indisponible', phrase: phraseIndisponible(l.erreur) };
  const n = l.valeur.items.length;
  const suite = l.valeur.nextCursor !== null;
  return {
    etat: 'connu',
    valeur: suite ? `${n} et plus` : String(n),
    detail: n === 0 ? 'Toutes les pièces sont passées' : 'Pièces non passées en écritures',
    attention: n > 0,
  };
}

function tuileReserves(balance: Lecture<AccountingTrialBalanceView>): EtatTuile {
  if (!balance.ok) return { etat: 'indisponible', phrase: phraseIndisponible(balance.erreur) };
  const n = balance.valeur.reserves.length;
  return {
    etat: 'connu',
    valeur: String(n),
    detail:
      n === 0 ? 'Aucune réserve signalée' : 'Raisons pour lesquelles les chiffres peuvent changer',
    attention: n > 0,
  };
}

export function tuilesVue(lectures: {
  balance: Lecture<AccountingTrialBalanceView>;
  aComptabiliser: Lecture<AccountingPage<AccountingPendingView>>;
}): TuileVue[] {
  return [
    {
      id: 'reserves',
      libelle: 'Réserves',
      lien: null,
      contenu: tuileReserves(lectures.balance),
    },
    {
      id: 'attente',
      libelle: 'Compte d’attente',
      lien: '/comptabilite/balance',
      contenu: tuileAttente(lectures.balance),
    },
    {
      id: 'a-comptabiliser',
      libelle: 'À comptabiliser',
      lien: '/comptabilite/ecritures',
      contenu: tuileACompter(lectures.aComptabiliser),
    },
  ];
}

export interface ClotureVue {
  cle: string;
  libelle: string;
  date: string | null;
}

/** Dernières périodes closes (mois et exercices), les plus récentes d'abord, trois au plus. */
export function dernieresClotures(exercices: readonly AccountingFiscalYearView[]): ClotureVue[] {
  const liste: (ClotureVue & { tri: string })[] = [];
  for (const ex of exercices) {
    if (ex.status === 'closed') {
      liste.push({
        cle: `ex-${ex.year}`,
        libelle: `Exercice ${ex.year}`,
        date: ex.closedAt,
        tri: `${ex.year}-99`,
      });
    }
    for (const p of ex.periods) {
      if (p.status !== 'closed') continue;
      liste.push({
        cle: `m-${ex.year}-${p.month}`,
        libelle: libelleMois(ex.year, p.month),
        date: p.closedAt,
        tri: `${ex.year}-${String(p.month).padStart(2, '0')}`,
      });
    }
  }
  return liste
    .sort((x, y) => (x.tri < y.tri ? 1 : x.tri > y.tri ? -1 : 0))
    .slice(0, 3)
    .map(({ cle, libelle, date }) => ({ cle, libelle, date }));
}

/** Phrase de la vue d'ensemble quand la comptabilité est éteinte ou son mode inconnu. */
export function phraseMode(mode: AccountingMode | null): string | null {
  if (mode === 'off') {
    return 'La comptabilité est éteinte : rien n’est lu, rien n’est calculé. Commencez par la simulation dans les réglages.';
  }
  if (mode === null) return 'Le mode de la comptabilité n’est pas encore lisible sur ce serveur.';
  return null;
}
