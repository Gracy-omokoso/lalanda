// Tableau de bord de l'écran Factures (ADR-0056) : mise en forme seulement.
//
// Tous les montants, comptes et pourcentages viennent de `GET /sales/invoices/stats`
// (moteur `computeInvoiceStats`) : ici on choisit des libellés, des couleurs de série
// et une écriture lisible. Les nombres passés aux graphiques sont des valeurs
// D'AFFICHAGE tirées des chaînes décimales du serveur ; rien n'en est recalculé.

import type { ChartColor, DonutSlice, StatusTone } from '@lalanda/ui';
import {
  INVOICE_STATS_CATEGORY_LABELS,
  type InvoiceStats,
  type InvoiceStatsCategory,
} from '@lalanda/shared/sales-invoices';

import type { InvoiceSummary, SettlementView } from '@/lib/api';

import type { FiltreStatut } from './invoice-model';

const INSECABLE = ' ';

const MOIS_COURTS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
] as const;
const MOIS_LONGS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

function indexMois(mois: string): number | null {
  const m = /^\d{4}-(\d{2})$/.exec(mois);
  const i = m ? Number(m[1]) - 1 : -1;
  return i >= 0 && i < 12 ? i : null;
}

/** `2026-10` → `oct.` ; illisible : rendu tel quel. */
export function moisCourt(mois: string): string {
  const i = indexMois(mois);
  return i === null ? mois : MOIS_COURTS[i]!;
}

/** `2026-10` → `octobre 2026`. */
export function moisLong(mois: string): string {
  const i = indexMois(mois);
  return i === null ? mois : `${MOIS_LONGS[i]} ${mois.slice(0, 4)}`;
}

/** Chaîne décimale du serveur → nombre d'affichage (0 si illisible). */
export function nombre(valeur: string): number {
  const n = Number(valeur);
  return Number.isFinite(n) ? n : 0;
}

function grouper(entier: string): string {
  return entier.replace(/\B(?=(\d{3})+(?!\d))/g, INSECABLE);
}

/**
 * Montant arrondi à l'unité pour une carte de chiffres : `"4812300.40"` →
 * `4 812 300 CDF`. Arrondi d'AFFICHAGE au plus proche (demi vers le haut, en
 * valeur absolue), sur la chaîne : aucun flottant.
 */
export function montantEntier(valeur: string, devise: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(valeur);
  if (!m) return `${valeur}${INSECABLE}${devise}`;
  const [, signe, entier, dec = ''] = m;
  let n = BigInt(entier!);
  if (dec.length > 0 && Number(dec[0]) >= 5) n += 1n;
  const negatif = signe === '-' && n !== 0n;
  return `${negatif ? '−' : ''}${grouper(n.toString())}${INSECABLE}${devise}`;
}

/** Écriture courte d'une graduation ou d'un classement : `12,9 M`, `350 k`, `0`. */
export function compact(valeur: number): string {
  const abs = Math.abs(valeur);
  const signe = valeur < 0 ? '−' : '';
  const un = (x: number) => {
    const arrondi = Math.round(x * 10) / 10;
    return Number.isInteger(arrondi) ? String(arrondi) : arrondi.toFixed(1).replace('.', ',');
  };
  if (abs >= 1e9) return `${signe}${un(abs / 1e9)}${INSECABLE}Md`;
  if (abs >= 1e6) return `${signe}${un(abs / 1e6)}${INSECABLE}M`;
  if (abs >= 1e3) return `${signe}${Math.round(abs / 1e3)}${INSECABLE}k`;
  return `${signe}${Math.round(abs)}`;
}

function pluriel(n: number, un: string, plusieurs: string): string {
  return `${n.toLocaleString('fr-FR')} ${n > 1 ? plusieurs : un}`;
}

export interface CarteChiffre {
  id: 'facture' | 'encaisse' | 'reste' | 'retard';
  label: string;
  valeur: string;
  note: string;
  /** Ton de la valeur : `alerte` pour un retard non nul. */
  ton: 'normal' | 'alerte';
  serie: number[];
  couleur: ChartColor;
  /** Nom accessible de la mini-courbe. */
  tendance: string;
}

/** Les quatre cartes de chiffres, dans l'ordre de l'écran. */
export function cartesChiffres(s: InvoiceStats): CarteChiffre[] {
  const d = s.currency;
  const periode = `de ${moisLong(s.from)} à ${moisLong(s.to)}`;
  const factures = pluriel(s.totals.invoiceCount, 'facture', 'factures');
  const avoirs =
    s.totals.creditNoteCount > 0
      ? ` · ${pluriel(s.totals.creditNoteCount, 'avoir', 'avoirs')} déduit${s.totals.creditNoteCount > 1 ? 's' : ''}`
      : '';
  return [
    {
      id: 'facture',
      label: 'Facturé, 12 mois',
      valeur: montantEntier(s.totals.billed, d),
      note: `${factures}${avoirs}`,
      ton: 'normal',
      serie: s.months.map((m) => nombre(m.billed)),
      couleur: 2,
      tendance: `Facturé par mois ${periode}`,
    },
    {
      id: 'encaisse',
      label: 'Encaissé, 12 mois',
      valeur: montantEntier(s.totals.collected, d),
      note:
        s.totals.collectedRatePercent === null
          ? 'Rien de facturé sur la période'
          : `${s.totals.collectedRatePercent}${INSECABLE}% du facturé`,
      ton: 'normal',
      serie: s.months.map((m) => nombre(m.collected)),
      couleur: 1,
      tendance: `Encaissé par mois ${periode}`,
    },
    {
      id: 'reste',
      label: 'Reste à encaisser',
      valeur: montantEntier(s.outstanding.amount, d),
      note: pluriel(s.outstanding.count, 'facture ouverte', 'factures ouvertes'),
      ton: 'normal',
      serie: s.months.map((m) => nombre(m.outstanding)),
      couleur: 3,
      tendance: `Reste à encaisser à la fin de chaque mois ${periode}`,
    },
    {
      id: 'retard',
      label: 'En retard',
      valeur: montantEntier(s.overdue.amount, d),
      note:
        s.overdue.count === 0
          ? 'Aucune échéance dépassée'
          : pluriel(s.overdue.count, 'facture échue', 'factures échues'),
      ton: s.overdue.count > 0 ? 'alerte' : 'normal',
      serie: s.months.map((m) => nombre(m.overdue)),
      couleur: 4,
      tendance: `Montant en retard à la fin de chaque mois ${periode}`,
    },
  ];
}

/** Couleur de chaque catégorie de l'anneau (le libellé est toujours écrit). */
export const COULEUR_CATEGORIE: Readonly<Record<InvoiceStatsCategory, ChartColor>> = {
  paid: 1,
  to_collect: 3,
  overdue: 4,
  pending_normalization: 5,
  normalization_failed: 2,
  draft: 6,
  credit_note: 6,
  other_final: 6,
};

export function tranchesStatut(s: InvoiceStats): DonutSlice[] {
  return s.categories.map((c) => ({
    id: c.category,
    label: INVOICE_STATS_CATEGORY_LABELS[c.category],
    value: c.count,
    color: COULEUR_CATEGORIE[c.category],
  }));
}

/** Compteur de chaque onglet de filtre (mêmes définitions que la liste). */
export function compteursFiltres(s: InvoiceStats): Record<FiltreStatut, number> {
  return {
    all: s.statusCounts.all,
    draft: s.statusCounts.draft,
    pending_normalization: s.statusCounts.pending_normalization,
    normalization_failed: s.statusCounts.normalization_failed,
    final: s.statusCounts.final,
  };
}

/**
 * Phrase sous les graphiques quand des documents sont écartés des montants
 * (ADR-0056) ; `null` s'il n'y a rien à dire.
 */
export function noteExclusions(s: InvoiceStats): string | null {
  const parts: string[] = [];
  for (const n of s.excluded.notConvertible) {
    parts.push(
      `${pluriel(n.count, 'document', 'documents')} en ${n.currency} sans taux figé (${montantEntier(n.total, n.currency)}) non converti${n.count > 1 ? 's' : ''}`,
    );
  }
  if (s.excluded.deposits > 0) {
    parts.push(`${pluriel(s.excluded.deposits, 'acompte', 'acomptes')} hors facturé`);
  }
  if (s.truncated) parts.push('trop de documents : chiffres partiels');
  return parts.length === 0 ? null : `${parts.join(' ; ')}.`;
}

/** Phrase sur la devise de référence. */
export function noteDevise(s: InvoiceStats): string {
  return s.currencySource === 'accounting_book'
    ? `Montants TTC en ${s.currency}, monnaie de tenue de la comptabilité, au taux figé sur chaque facture.`
    : `Montants TTC en ${s.currency}, au taux figé sur chaque facture.`;
}

// ─── Statut d'une ligne de la liste ─────────────────────────────────────────

/** Jours entre deux dates civiles `AAAA-MM-JJ` (b − a), `null` si illisibles. */
export function joursEntre(a: string, b: string): number | null {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round((db - da) / 86_400_000);
}

export interface StatutLigne {
  ton: StatusTone;
  label: string;
}

/**
 * Étiquette de statut d'une ligne : l'état du document, puis — pour une facture
 * définitive — son règlement servi par l'API (`GET /sales/settlements`).
 */
export function statutLigne(
  doc: Pick<InvoiceSummary, 'status' | 'type'>,
  reglement: SettlementView | undefined,
): StatutLigne {
  switch (doc.status) {
    case 'draft':
      return { ton: 'draft', label: 'Brouillon' };
    case 'pending_normalization':
      return { ton: 'wait', label: 'En attente DGI' };
    case 'normalization_failed':
      return { ton: 'late', label: 'Normalisation refusée' };
    default:
      break;
  }
  if (doc.type === 'FA' || doc.type === 'EA') return { ton: 'draft', label: 'Avoir émis' };
  if (!reglement || reglement.status === 'not_applicable') {
    return { ton: 'draft', label: doc.status === 'normalized' ? 'Normalisée' : 'Émise' };
  }
  switch (reglement.status) {
    case 'paid':
      return { ton: 'ok', label: 'Payée' };
    case 'partially_paid':
      return { ton: 'open', label: 'Payée en partie' };
    case 'unpaid':
      return { ton: 'open', label: 'À encaisser' };
    case 'overdue': {
      const jours = reglement.dueDate ? joursEntre(reglement.dueDate, reglement.asOf) : null;
      return {
        ton: 'late',
        label:
          jours !== null && jours > 0
            ? `En retard${INSECABLE}·${INSECABLE}${jours}${INSECABLE}j`
            : 'En retard',
      };
    }
  }
}

// ─── Colonnes de la liste ───────────────────────────────────────────────────

/** Date d'émission courte, au jour de Kinshasa : `03/11/2026` ; absente : `—`. */
export function dateCourte(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa' });
}

const TYPES_AFFICHES: Readonly<Record<string, string>> = {
  FV: 'Facture',
  FT: 'Acompte',
  FA: 'Avoir',
  EV: 'Facture export',
  ET: 'Acompte export',
  EA: 'Avoir export',
};

/** Colonne « Type » : un document non définitif est un pro forma (§ S25e.1). */
export function typeAffiche(doc: Pick<InvoiceSummary, 'status' | 'type'>): string {
  if (doc.status !== 'issued' && doc.status !== 'normalized') return 'Pro forma';
  return TYPES_AFFICHES[doc.type] ?? doc.type;
}
