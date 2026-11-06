// Tableau de bord de l'écran Encaissements (ADR-0067) : mise en forme seulement.
//
// Tous les montants, comptes, délais et pourcentages viennent de
// `GET /sales/receipts/stats` (moteur `computeReceiptStats`) : ici on choisit des
// libellés, des couleurs et une écriture lisible. Les nombres passés aux
// graphiques sont des valeurs D'AFFICHAGE tirées des chaînes décimales du serveur
// (`nombre`, repris de l'écran Factures) ; rien n'en est recalculé.

import type { BarItem, StatusTone } from '@lalanda/ui';
import { RECEIPT_STATS_METHOD_LABELS, type ReceiptStats } from '@lalanda/shared/sales-invoices';

import type { ReceiptView } from '@/lib/api';

import type { CarteTableau } from '../../_components/dashboard-ui';
import {
  compact,
  moisCourt,
  moisLong,
  montantEntier,
  nombre,
} from '../../factures/_components/invoice-dashboard-model';

const INSECABLE = ' ';

function pluriel(n: number, un: string, plusieurs: string): string {
  return `${n.toLocaleString('fr-FR')} ${n > 1 ? plusieurs : un}`;
}

/** `+12 %`, `−40 %`, `0 %` : variation servie par le moteur, signe typographique. */
export function variation(pourcent: number): string {
  if (pourcent > 0) return `+${pourcent}${INSECABLE}%`;
  if (pourcent < 0) return `−${-pourcent}${INSECABLE}%`;
  return `0${INSECABLE}%`;
}

/** Les quatre cartes de chiffres, dans l'ordre de l'écran. */
export function cartesEncaissements(s: ReceiptStats): CarteTableau[] {
  const d = s.currency;
  const periode = `de ${moisLong(s.from)} à ${moisLong(s.to)}`;
  const serie = s.months.map((m) => nombre(m.collected));
  const delai = s.averageDelay;
  return [
    {
      id: 'mois',
      label: 'Encaissé ce mois',
      valeur: montantEntier(s.thisMonth.amount, d),
      note:
        s.thisMonth.count === 0
          ? 'Rien de reçu ce mois'
          : pluriel(s.thisMonth.count, 'encaissement', 'encaissements'),
      ton: 'normal',
      serie,
      couleur: 1,
      tendance: `Encaissé par mois ${periode}`,
    },
    {
      id: 'precedent',
      label: 'Vs mois précédent',
      valeur: s.changePercent === null ? '—' : variation(s.changePercent),
      note: `${montantEntier(s.previousMonth.amount, d)} en ${moisCourt(s.previousMonth.month)}`,
      ton: 'normal',
      serie: s.months.map((m) => m.count),
      couleur: 2,
      tendance: `Nombre d’encaissements par mois ${periode}`,
    },
    {
      id: 'delai',
      label: 'Délai moyen d’encaissement',
      valeur: delai.days === null ? '—' : `${delai.days.toLocaleString('fr-FR')}${INSECABLE}j`,
      note:
        delai.allocations === 0
          ? `Aucun règlement sur ${delai.windowDays} jours`
          : `${delai.windowDays} derniers jours · ${pluriel(delai.allocations, 'règlement', 'règlements')}`,
      ton: 'normal',
      serie: null,
      couleur: 5,
      tendance: '',
    },
    {
      id: 'restant',
      label: 'Restant dû',
      valeur: montantEntier(s.outstanding.amount, d),
      note:
        s.overdue.count > 0
          ? `dont ${montantEntier(s.overdue.amount, d)} en retard`
          : pluriel(s.outstanding.count, 'facture ouverte', 'factures ouvertes'),
      ton: s.overdue.count > 0 ? 'alerte' : 'normal',
      serie: null,
      couleur: 3,
      tendance: '',
    },
  ];
}

/** Barres de la répartition par moyen de paiement (moyens sans encaissement masqués). */
export function barresMoyens(s: ReceiptStats): BarItem[] {
  return s.byMethod
    .filter((m) => m.count > 0)
    .map((m) => ({ ...m, valeur: nombre(m.amount) }))
    .sort((a, b) => b.valeur - a.valeur)
    .map((m) => ({
      id: m.method,
      label: `${RECEIPT_STATS_METHOD_LABELS[m.method]} · ${m.count.toLocaleString('fr-FR')}`,
      value: m.valeur,
      display: compact(m.valeur),
    }));
}

/** Compteurs des onglets de la liste (mêmes définitions que `GET /sales/receipts`). */
export function compteursEncaissements(
  s: ReceiptStats,
): Record<'recorded' | 'cancelled' | 'all', number> {
  return { ...s.statusCounts };
}

/** Phrase sur la devise de référence et les lettrages écartés des montants. */
export function noteDevisesEncaissements(s: ReceiptStats): string {
  const base =
    s.currencySource === 'accounting_book'
      ? `Montants en ${s.currency}, monnaie de tenue de la comptabilité, au taux figé sur chaque facture.`
      : `Montants en ${s.currency}, au taux figé sur chaque facture.`;
  const parts: string[] = [];
  for (const n of s.excluded.notConvertible) {
    parts.push(
      `${pluriel(n.count, 'règlement', 'règlements')} en ${n.currency} sur une facture sans taux figé (${montantEntier(n.total, n.currency)}) non converti${n.count > 1 ? 's' : ''}`,
    );
  }
  if (s.truncated) parts.push('trop de documents : chiffres partiels');
  parts.push('les paiements déclarés à l’émission restent dans l’écran Factures');
  const suite = parts.join(' ; ');
  return `${base} ${suite[0]!.toUpperCase()}${suite.slice(1)}.`;
}

// ─── Liste ──────────────────────────────────────────────────────────────────

export const FILTRES_ENCAISSEMENTS: readonly {
  valeur: 'recorded' | 'cancelled' | 'all';
  label: string;
}[] = [
  { valeur: 'recorded', label: 'Enregistrés' },
  { valeur: 'cancelled', label: 'Annulés' },
  { valeur: 'all', label: 'Tous' },
];

export function statutEncaissement(r: Pick<ReceiptView, 'status'>): {
  ton: StatusTone;
  label: string;
} {
  return r.status === 'cancelled'
    ? { ton: 'late', label: 'Annulé' }
    : { ton: 'ok', label: 'Enregistré' };
}

/** Recherche dans la page chargée : numéro de facture, référence ou note. */
export function correspond(r: ReceiptView, terme: string): boolean {
  const t = terme.trim().toLocaleLowerCase('fr-FR');
  if (t === '') return true;
  return [r.reference ?? '', r.note ?? '', ...r.allocations.map((a) => a.invoiceNumber ?? '')].some(
    (v) => v.toLocaleLowerCase('fr-FR').includes(t),
  );
}
