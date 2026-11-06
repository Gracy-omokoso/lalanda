// Tableau de bord de l'écran Devis (ADR-0067) : mise en forme seulement.
//
// Tous les montants, comptes et pourcentages viennent de `GET /sales/quotes/stats`
// (moteur `computeQuoteStats`) : ici on choisit des libellés, des couleurs et une
// écriture lisible. Les nombres passés aux graphiques sont des valeurs D'AFFICHAGE
// tirées des chaînes décimales du serveur (`nombre`, repris de l'écran Factures).

import type { DonutSlice, StatusTone } from '@lalanda/ui';
import {
  QUOTE_STATS_STATUSES,
  QUOTE_STATS_STATUS_LABELS,
  type QuoteStats,
  type QuoteStatsStatus,
} from '@lalanda/shared/sales-invoices';

import type { QuoteStatus } from '@/lib/api-crm';

import type { CarteTableau } from '../../_components/dashboard-ui';
import {
  joursEntre,
  moisLong,
  montantEntier,
  nombre,
} from '../../factures/_components/invoice-dashboard-model';

const INSECABLE = ' ';

function pluriel(n: number, un: string, plusieurs: string): string {
  return `${n.toLocaleString('fr-FR')} ${n > 1 ? plusieurs : un}`;
}

/** `+ 1 300 USD` : montants d'une autre devise, jamais convertis (aucun taux sur un devis). */
export function autresDevises(
  liste: readonly { currency: string; total: string }[],
): string | null {
  if (liste.length === 0) return null;
  return liste.map((n) => `+${INSECABLE}${montantEntier(n.total, n.currency)}`).join(' ');
}

function avecAutres(note: string, liste: readonly { currency: string; total: string }[]): string {
  const autres = autresDevises(liste);
  return autres ? `${note} · ${autres}` : note;
}

/** Les quatre cartes de chiffres, dans l'ordre de l'écran. */
export function cartesDevis(s: QuoteStats): CarteTableau[] {
  const d = s.currency;
  const periode = `de ${moisLong(s.from)} à ${moisLong(s.to)}`;
  const c = s.conversion;
  return [
    {
      id: 'en-cours',
      label: 'Devis en cours',
      valeur: montantEntier(s.open.amount, d),
      note: avecAutres(
        s.open.count === 0
          ? 'Aucun devis en attente'
          : pluriel(s.open.count, 'devis envoyé', 'devis envoyés'),
        s.open.notConvertible,
      ),
      ton: 'normal',
      serie: s.months.map((m) => m.sent),
      couleur: 2,
      tendance: `Devis émis par mois ${periode}`,
    },
    {
      id: 'transformation',
      label: `Transformation, ${c.windowDays} j`,
      valeur: c.ratePercent === null ? '—' : `${c.ratePercent}${INSECABLE}%`,
      note:
        c.sent === 0
          ? `Rien d’envoyé sur ${c.windowDays}${INSECABLE}j`
          : `${pluriel(c.accepted, 'accepté', 'acceptés')} sur ${pluriel(c.sent, 'envoyé', 'envoyés')}`,
      ton: 'normal',
      serie: s.months.map((m) => m.accepted),
      couleur: 1,
      tendance: `Devis acceptés par mois ${periode}`,
    },
    {
      id: 'accepte-mois',
      label: 'Accepté ce mois',
      valeur: montantEntier(s.acceptedThisMonth.amount, d),
      note: avecAutres(
        s.acceptedThisMonth.count === 0
          ? 'Aucun devis accepté'
          : pluriel(s.acceptedThisMonth.count, 'devis accepté', 'devis acceptés'),
        s.acceptedThisMonth.notConvertible,
      ),
      ton: 'normal',
      serie: s.months.map((m) => nombre(m.acceptedAmount)),
      couleur: 3,
      tendance: `Montant accepté par mois ${periode}, en ${d}`,
    },
    {
      id: 'expirent',
      label: `Expirent sous ${s.expiringSoon.withinDays} jours`,
      valeur: pluriel(s.expiringSoon.count, 'devis', 'devis'),
      note:
        s.expiringSoon.count === 0
          ? 'Aucun devis à relancer'
          : avecAutres(montantEntier(s.expiringSoon.amount, d), s.expiringSoon.notConvertible),
      ton: s.expiringSoon.count > 0 ? 'attention' : 'normal',
      serie: null,
      couleur: 4,
      tendance: '',
    },
  ];
}

/** Couleur et libellé de chaque statut de l'anneau (le libellé est toujours écrit). */
const COULEUR_STATUT: Readonly<Record<QuoteStatsStatus, 1 | 2 | 3 | 4 | 5 | 6>> = {
  accepted: 1,
  sent: 3,
  expired: 5,
  refused: 4,
  draft: 6,
};

export function tranchesStatutDevis(s: QuoteStats): DonutSlice[] {
  return QUOTE_STATS_STATUSES.map((st) => ({
    id: st,
    label: QUOTE_STATS_STATUS_LABELS[st],
    value: s.statusCounts[st],
    color: COULEUR_STATUT[st],
  }));
}

/** Compteur de chaque onglet de filtre (mêmes définitions que la liste). */
export function compteursDevis(s: QuoteStats): Record<QuoteStatus | 'all', number> {
  return { ...s.statusCounts };
}

/** Phrase sur la devise de référence et les devis écartés des montants. */
export function noteDevisesDevis(s: QuoteStats): string {
  const base =
    s.currencySource === 'accounting_book'
      ? `Montants TTC en ${s.currency}, monnaie de tenue de la comptabilité.`
      : `Montants TTC en ${s.currency}.`;
  const parts: string[] = [];
  for (const n of s.excluded.notConvertible) {
    parts.push(
      `${pluriel(n.count, 'devis', 'devis')} en ${n.currency} (${montantEntier(n.total, n.currency)}) compté${n.count > 1 ? 's' : ''} à part : un devis ne porte aucun taux de change`,
    );
  }
  if (s.excluded.withoutAmount > 0) {
    parts.push(`${pluriel(s.excluded.withoutAmount, 'devis', 'devis')} sans total calculable`);
  }
  if (s.truncated) parts.push('trop de devis : chiffres partiels');
  if (parts.length === 0) return base;
  const suite = parts.join(' ; ');
  return `${base} ${suite[0]!.toUpperCase()}${suite.slice(1)}.`;
}

// ─── Statut d'une ligne de la liste ─────────────────────────────────────────

export interface StatutDevis {
  ton: StatusTone;
  label: string;
}

/**
 * Étiquette de statut d'un devis. Un devis envoyé qui expire sous 7 jours le dit
 * (`asOf` : le jour du serveur, à défaut celui du navigateur).
 */
export function statutDevis(
  d: { status: QuoteStatus; validUntil: string; convertedInvoiceId: string | null },
  asOf: string,
): StatutDevis {
  switch (d.status) {
    case 'draft':
      return { ton: 'draft', label: 'Brouillon' };
    case 'accepted':
      return { ton: 'ok', label: d.convertedInvoiceId ? 'Accepté · facturé' : 'Accepté' };
    case 'refused':
      return { ton: 'late', label: 'Refusé' };
    case 'expired':
      return { ton: 'wait', label: 'Expiré' };
    case 'sent': {
      const jours = joursEntre(asOf, d.validUntil);
      if (jours !== null && jours >= 0 && jours <= 7) {
        return {
          ton: 'wait',
          label:
            jours === 0 ? 'Expire aujourd’hui' : `Expire dans${INSECABLE}${jours}${INSECABLE}j`,
        };
      }
      return { ton: 'open', label: 'Envoyé' };
    }
  }
}
