// Mise en forme des tableaux de bord des écrans Achats (ADR-0071) : Factures
// fournisseurs, À payer, Commandes. AUCUN calcul.
//
// Montants, comptes, délais et pourcentages viennent des routes `…/stats` (moteur
// `computeSupplierInvoiceStats`, `computePayablesStats`, `computePurchaseOrderStats`) ;
// ici on choisit des libellés, des tons et une écriture lisible. Les nombres passés
// aux graphiques sont des valeurs D'AFFICHAGE (`nombre`) ; rien n'en est recalculé.
// Une devise à la fois, jamais convertie (ADR-0044 § 7).

import type { BarItem, StatusTone } from '@lalanda/ui';
import type { PurchaseOrderStatus } from '@lalanda/shared/purchases';

import type { CarteTableau } from '@/components/tableau-de-bord/briques';
import {
  compact,
  jours,
  moisCourt,
  moisLong,
  montantEntier,
  nombre,
  pluriel,
  variation,
} from '@/components/tableau-de-bord/format';
import type { PayablesStats, PurchaseOrderStats, SupplierInvoiceStats } from '@/lib/api-run-stats';

import { LIBELLES_STATUT, type TonStatut } from './achats-model';
import type { FiltreCommandes } from './commandes-model';
import type { FiltreFactures } from './factures-model';

type Devise = 'CDF' | 'USD';

/** Ton d'une pastille de statut (`StatusPill`) depuis le ton des badges des achats. */
export function tonPastille(t: TonStatut): StatusTone {
  switch (t) {
    case 'success':
      return 'ok';
    case 'info':
      return 'open';
    case 'warning':
      return 'wait';
    case 'danger':
      return 'late';
    default:
      return 'draft';
  }
}

/** Devises servies (l'ordre du serveur : la plus fournie d'abord). */
export function devisesDe(s: { byCurrency: readonly { currency: Devise }[] } | null): Devise[] {
  return s ? s.byCurrency.map((c) => c.currency) : [];
}

/** Bloc de la devise choisie ; à défaut, la première servie ; `null` sans donnée. */
export function blocDevise<T extends { currency: Devise }>(
  blocs: readonly T[],
  devise: Devise | null,
): T | null {
  return blocs.find((b) => b.currency === devise) ?? blocs[0] ?? null;
}

function periode(s: { from: string; to: string }): string {
  return `de ${moisLong(s.from)} à ${moisLong(s.to)}`;
}

/** Phrase sous les graphiques : devise non convertie, chiffres partiels éventuels. */
export function noteDeviseAchats(
  s: { truncated: boolean; byCurrency: readonly unknown[] },
  devise: Devise,
): string {
  const parts = [`Montants en ${devise}, jamais convertis ni additionnés à une autre devise.`];
  if (s.byCurrency.length > 1) parts.push('Choisissez la devise pour voir l’autre.');
  if (s.truncated) parts.push('Trop de documents : chiffres partiels.');
  return parts.join(' ');
}

// ─── Factures fournisseurs ──────────────────────────────────────────────────

type BlocFactures = SupplierInvoiceStats['byCurrency'][number];

export function cartesFactures(s: SupplierInvoiceStats, b: BlocFactures): CarteTableau[] {
  const d = b.currency;
  return [
    {
      id: 'facture',
      label: 'Facturé ce mois',
      valeur: montantEntier(b.thisMonth.amount, d),
      note:
        b.changePercent === null
          ? pluriel(b.thisMonth.count, 'facture validée', 'factures validées')
          : `${variation(b.changePercent)} vs ${moisCourt(b.previousMonth.month)}`,
      ton: 'normal',
      serie: b.months.map((m) => nombre(m.amount)),
      couleur: 1,
      tendance: `Facturé par les fournisseurs, par mois, ${periode(s)}`,
    },
    {
      id: 'reste',
      label: 'Reste à payer',
      valeur: montantEntier(b.outstanding.amount, d),
      note:
        b.disputed.count > 0
          ? `dont ${montantEntier(b.disputed.amount, d)} en litige`
          : pluriel(b.outstanding.count, 'facture ouverte', 'factures ouvertes'),
      ton: 'normal',
      serie: null,
      couleur: 3,
      tendance: '',
    },
    {
      id: 'retard',
      label: 'En retard',
      valeur: montantEntier(b.overdue.amount, d),
      note:
        b.overdue.count === 0
          ? 'Aucune échéance passée'
          : pluriel(b.overdue.count, 'facture échue', 'factures échues'),
      ton: b.overdue.count > 0 ? 'alerte' : 'normal',
      serie: null,
      couleur: 4,
      tendance: '',
    },
    {
      id: 'traiter',
      label: 'À traiter',
      valeur: s.statusCounts.draft.toLocaleString('fr-FR'),
      note:
        s.statusCounts.variance > 0
          ? `dont ${pluriel(s.statusCounts.variance, 'en écart', 'en écart')}`
          : s.statusCounts.draft === 0
            ? 'Aucun brouillon'
            : pluriel(s.statusCounts.draft, 'brouillon', 'brouillons'),
      ton: s.statusCounts.variance > 0 ? 'attention' : 'normal',
      serie: null,
      couleur: 2,
      tendance: '',
    },
  ];
}

export function barresCategories(b: BlocFactures): BarItem[] {
  return b.byCategory.map((c) => ({
    id: c.category,
    label: c.label,
    value: nombre(c.amount),
    display: compact(nombre(c.amount)),
  }));
}

/** Compteurs des onglets (mêmes définitions que les filtres de la liste). */
export function compteursFactures(s: SupplierInvoiceStats): Record<FiltreFactures, number> {
  const c = s.statusCounts;
  return {
    toutes: c.all,
    brouillons: c.draft,
    ecart: c.variance,
    validees: c.validated,
    'en-retard': c.overdue,
    litiges: c.disputed,
  };
}

// ─── À payer ────────────────────────────────────────────────────────────────

type BlocPayer = PayablesStats['byCurrency'][number];

export function cartesAPayer(s: PayablesStats, b: BlocPayer): CarteTableau[] {
  const d = b.currency;
  const delai = b.averageDelay;
  return [
    {
      id: 'du',
      label: 'Dû aux fournisseurs',
      valeur: montantEntier(b.due.amount, d),
      note:
        b.disputed.count > 0
          ? `+ ${montantEntier(b.disputed.amount, d)} en litige`
          : pluriel(b.due.count, 'facture à payer', 'factures à payer'),
      ton: 'normal',
      serie: b.months.map((m) => nombre(m.amount)),
      couleur: 1,
      tendance: `Payé aux fournisseurs, par mois, ${periode(s)}`,
    },
    {
      id: 'echu',
      label: 'Échu',
      valeur: montantEntier(b.overdue.amount, d),
      note:
        b.overdue.count === 0
          ? 'Rien en retard'
          : pluriel(b.overdue.count, 'facture en retard', 'factures en retard'),
      ton: b.overdue.count > 0 ? 'alerte' : 'normal',
      serie: null,
      couleur: 4,
      tendance: '',
    },
    {
      id: 'sept',
      label: 'À payer sous 7 jours',
      valeur: montantEntier(b.dueWithin7.amount, d),
      note: `${montantEntier(b.dueWithin30.amount, d)} sous 30 jours`,
      ton: b.dueWithin7.count > 0 ? 'attention' : 'normal',
      serie: null,
      couleur: 2,
      tendance: '',
    },
    {
      id: 'delai',
      label: 'Délai moyen de paiement',
      valeur: jours(delai.days),
      note:
        delai.allocations === 0
          ? `Aucun paiement sur ${delai.windowDays} jours`
          : `${delai.windowDays} derniers jours · ${pluriel(delai.allocations, 'règlement', 'règlements')}`,
      ton: 'normal',
      serie: null,
      couleur: 5,
      tendance: '',
    },
  ];
}

/** Ancienneté du dû (tranches de `payablesAging`), hors litiges. */
export function barresAnciennete(b: BlocPayer): BarItem[] {
  const a = b.aging;
  return (
    [
      ['notDue', 'Pas encore échu', a.notDue],
      ['days1To30', 'En retard de 1 à 30 j', a.days1To30],
      ['days31To60', 'De 31 à 60 j', a.days31To60],
      ['days61To90', 'De 61 à 90 j', a.days61To90],
      ['over90', 'Plus de 90 j', a.over90],
    ] as const
  )
    .filter(([, , x]) => x.count > 0)
    .map(([id, label, x]) => ({
      id,
      label: `${label} · ${x.count.toLocaleString('fr-FR')}`,
      value: nombre(x.amount),
      display: compact(nombre(x.amount)),
    }));
}

export function barresFournisseurs(b: BlocPayer): BarItem[] {
  return b.topSuppliers.map((f) => ({
    id: f.supplierId,
    label: `${f.supplierName ?? 'Fournisseur'} · ${f.count.toLocaleString('fr-FR')}`,
    value: nombre(f.amount),
    display: compact(nombre(f.amount)),
  }));
}

export type OngletAPayer = 'en-retard' | 'bientot' | 'plus-tard' | 'litiges';

export function ongletsAPayer(
  s: PayablesStats | null,
): readonly { valeur: OngletAPayer; label: string }[] {
  return [
    { valeur: 'en-retard', label: 'En retard' },
    { valeur: 'bientot', label: s ? `Sous ${s.dueSoonDays} jours` : 'Bientôt' },
    { valeur: 'plus-tard', label: 'Plus tard' },
    { valeur: 'litiges', label: 'En litige' },
  ];
}

export function compteursAPayer(s: PayablesStats): Record<OngletAPayer, number> {
  const g = s.groupCounts;
  return { 'en-retard': g.overdue, bientot: g.soon, 'plus-tard': g.later, litiges: g.disputed };
}

// ─── Commandes ──────────────────────────────────────────────────────────────

type BlocCommandes = PurchaseOrderStats['byCurrency'][number];

export function cartesCommandes(s: PurchaseOrderStats, b: BlocCommandes): CarteTableau[] {
  const d = b.currency;
  const delai = b.averageApprovalDelay;
  return [
    {
      id: 'commande',
      label: 'Commandé ce mois',
      valeur: montantEntier(b.thisMonth.amount, d),
      note:
        b.changePercent === null
          ? pluriel(b.thisMonth.count, 'commande approuvée', 'commandes approuvées')
          : `${variation(b.changePercent)} vs ${moisCourt(b.previousMonth.month)}`,
      ton: 'normal',
      serie: b.months.map((m) => nombre(m.amount)),
      couleur: 1,
      tendance: `Commandes approuvées, par mois, ${periode(s)}`,
    },
    {
      id: 'ouvertes',
      label: 'Commandes ouvertes',
      valeur: montantEntier(b.open.amount, d),
      note: pluriel(b.open.count, 'commande en cours', 'commandes en cours'),
      ton: 'normal',
      serie: null,
      couleur: 3,
      tendance: '',
    },
    {
      id: 'approuver',
      label: 'À approuver',
      valeur: s.statusCounts.submitted.toLocaleString('fr-FR'),
      note:
        b.pendingApproval.count === 0
          ? 'Aucune demande en attente'
          : `${montantEntier(b.pendingApproval.amount, d)} en attente`,
      ton: s.statusCounts.submitted > 0 ? 'attention' : 'normal',
      serie: null,
      couleur: 2,
      tendance: '',
    },
    {
      id: 'delai',
      label: 'Délai moyen d’approbation',
      valeur: jours(delai.days),
      note:
        delai.approvals === 0
          ? `Aucune approbation sur ${delai.windowDays} jours`
          : `${delai.windowDays} derniers jours · ${pluriel(delai.approvals, 'approbation', 'approbations')}`,
      ton: 'normal',
      serie: null,
      couleur: 5,
      tendance: '',
    },
  ];
}

export function barresStatutsCommandes(s: PurchaseOrderStats): BarItem[] {
  return s.byStatus.map((x) => ({
    id: x.status,
    label: LIBELLES_STATUT[x.status as PurchaseOrderStatus] ?? x.status,
    value: x.count,
    display: x.count.toLocaleString('fr-FR'),
  }));
}

export function compteursCommandes(s: PurchaseOrderStats): Record<FiltreCommandes, number> {
  const c = s.statusCounts;
  return {
    toutes: c.all,
    miennes: c.mine,
    brouillons: c.draft,
    'a-approuver': c.submitted,
    commandes: c.order,
  };
}
