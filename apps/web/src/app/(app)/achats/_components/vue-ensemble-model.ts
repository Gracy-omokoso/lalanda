// Vue d'ensemble des achats — ADR-0044 § 8 : à approuver, à recevoir, factures en
// écart, à payer cette semaine, en retard. Logique pure.
//
// Chaque tuile lit SA route ; une route absente (404 : lot pas encore fusionné),
// refusée (403) ou en panne donne une PHRASE à la place du chiffre, jamais un
// zéro inventé. Les montants sont ceux de l'API, une devise par ligne.

import type { OrgAction } from '@/lib/api';
import type { PayablesView } from '@/lib/api-purchases';

import { formatMontant } from '../../ventes/_components/sales-model';

import { ACHATS_BASE, peutApprouverAchats, statutDe } from './achats-model';

export type Lecture<T> = { ok: true; valeur: T } | { ok: false; erreur: unknown };

export type EtatTuile =
  | {
      etat: 'connu';
      /** Une ligne par devise pour un montant ; une seule pour un nombre. */
      lignes: string[];
      detail: string | null;
      attention: boolean;
    }
  | { etat: 'indisponible'; phrase: string };

export interface TuileVue {
  id: 'a-approuver' | 'a-recevoir' | 'factures-ecart' | 'a-payer' | 'en-retard';
  libelle: string;
  lien: string | null;
  contenu: EtatTuile;
}

export function phraseIndisponible(erreur: unknown): string {
  const s = statutDe(erreur);
  if (s === 404) return 'Pas encore disponible';
  if (s === 403) return 'Réservé à d’autres rôles';
  return 'Lecture impossible pour le moment';
}

/** « 3 », ou « 50 et plus » quand la page suivante existe (aucun total inventé). */
export function compteDePage(page: PageLue): string {
  const n = page.items.length;
  return page.nextCursor ? `${n} et plus` : String(n);
}

function tuileCompte(lu: Lecture<PageLue>, attentionSiNonVide: boolean): EtatTuile {
  if (!lu.ok) return { etat: 'indisponible', phrase: phraseIndisponible(lu.erreur) };
  return {
    etat: 'connu',
    lignes: [compteDePage(lu.valeur)],
    detail: null,
    attention: attentionSiNonVide && lu.valeur.items.length > 0,
  };
}

/**
 * Montants par devise lus dans l'échéancier du moteur. Tant que l'échéancier n'est
 * pas livré (404), la liste filtrée des factures (`due=soon|overdue`, lot P4) donne
 * au moins leur NOMBRE ; à défaut, une phrase (ADR-0044 — P8).
 */
function tuileMontants(
  lu: Lecture<PayablesView>,
  champ: 'dueSoon' | 'overdue',
  repli?: Lecture<PageLue>,
): EtatTuile {
  if (!lu.ok && repli?.ok) {
    const n = compteDePage(repli.valeur);
    const vide = repli.valeur.items.length === 0;
    return {
      etat: 'connu',
      lignes: [vide ? 'Aucune' : `${n} facture${n === '1' ? '' : 's'}`],
      detail: vide ? null : 'Montants par devise sur l’échéancier',
      attention: champ === 'overdue' && !vide,
    };
  }
  if (!lu.ok) return { etat: 'indisponible', phrase: phraseIndisponible(lu.erreur) };
  const lignes = lu.valeur.schedule
    .filter((c) => c[champ].count > 0)
    .map((c) => {
      const n = c[champ].count;
      return `${formatMontant(c[champ].amount, c.currency)} · ${n} facture${n > 1 ? 's' : ''}`;
    });
  return {
    etat: 'connu',
    lignes: lignes.length === 0 ? ['Aucune'] : lignes,
    detail: champ === 'dueSoon' ? `Échéance sous ${lu.valeur.dueSoonDays} jours` : null,
    attention: champ === 'overdue' && lignes.length > 0,
  };
}

/** Une page de liste : seul son nombre d'éléments et sa suite comptent ici. */
export interface PageLue {
  items: readonly unknown[];
  nextCursor: string | null;
}

export interface LecturesVue {
  enAttente: Lecture<PageLue> | null;
  aRecevoir: Lecture<PageLue>;
  facturesEcart: Lecture<PageLue>;
  echeancier: Lecture<PayablesView>;
  // ADR-0044 — P8 : listes filtrées des factures, repli de l'échéancier.
  bientot?: Lecture<PageLue>;
  enRetard?: Lecture<PageLue>;
}

/**
 * Tuiles de la vue d'ensemble. « À approuver » n'existe que pour qui approuve
 * (`purchase.approve`) : `enAttente` vaut alors `null` et la tuile est omise.
 */
export function tuilesVue(actions: readonly OrgAction[] | null, l: LecturesVue): TuileVue[] {
  const tuiles: TuileVue[] = [];
  if (peutApprouverAchats(actions) && l.enAttente !== null) {
    tuiles.push({
      id: 'a-approuver',
      libelle: 'Demandes à approuver',
      lien: `${ACHATS_BASE}/validations`,
      contenu: tuileCompte(l.enAttente, true),
    });
  }
  tuiles.push(
    {
      id: 'a-recevoir',
      libelle: 'Commandes envoyées à recevoir',
      lien: `${ACHATS_BASE}/commandes`,
      contenu: tuileCompte(l.aRecevoir, false),
    },
    {
      id: 'factures-ecart',
      libelle: 'Factures en écart',
      lien: `${ACHATS_BASE}/factures?filtre=ecart`,
      contenu: tuileCompte(l.facturesEcart, true),
    },
    {
      id: 'a-payer',
      libelle: 'À payer bientôt',
      lien: `${ACHATS_BASE}/a-payer`,
      contenu: tuileMontants(l.echeancier, 'dueSoon', l.bientot),
    },
    {
      id: 'en-retard',
      libelle: 'Factures en retard',
      lien: `${ACHATS_BASE}/a-payer`,
      contenu: tuileMontants(l.echeancier, 'overdue', l.enRetard),
    },
  );
  return tuiles;
}

/** Transforme une promesse en lecture, sans jamais rejeter. */
export function lire<T>(p: Promise<T>): Promise<Lecture<T>> {
  return p.then(
    (valeur) => ({ ok: true as const, valeur }),
    (erreur: unknown) => ({ ok: false as const, erreur }),
  );
}
