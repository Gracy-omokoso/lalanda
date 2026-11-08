// Mise en forme des tableaux de bord des écrans Trésorerie (ADR-0071) : Dépenses,
// Comptes. AUCUN calcul.
//
// Montants, comptes et pourcentages viennent de `GET /treasury/expenses/stats` et
// `GET /treasury/accounts/stats` (moteur `computeExpenseStats`, `computeAccountStats`) ;
// ici on choisit des libellés, des tons et une écriture lisible. Les nombres passés
// aux graphiques sont des valeurs D'AFFICHAGE (`nombre`). Une devise à la fois,
// jamais convertie (ADR-0034). Les soldes sont ceux des comptes RÉELS : la
// trésorerie mensuelle des plans BUILD est une vue simplifiée, jamais la référence.

import type { BarItem, StatusTone } from '@lalanda/ui';

import type { CarteTableau } from '@/components/tableau-de-bord/briques';
import {
  compact,
  moisCourt,
  moisLong,
  montantEntier,
  nombre,
  pluriel,
  variation,
} from '@/components/tableau-de-bord/format';
import type { AccountStats, ExpenseStats } from '@/lib/api-run-stats';

type BlocDepenses = ExpenseStats['byCurrency'][number];
type BlocComptes = AccountStats['byCurrency'][number];

/** `-12.50` → `−13 USD` (arrondi d'affichage, signe typographique). */
function signe(valeur: string, devise: string): string {
  return montantEntier(valeur, devise);
}

/** Phrase sous les graphiques des dépenses. */
export function noteDepenses(s: ExpenseStats, devise: string): string {
  const parts = [
    `Montants payés en ${devise}, jamais convertis ni additionnés à une autre devise ; dépenses annulées exclues.`,
  ];
  if (s.byCurrency.length > 1) parts.push('Choisissez la devise pour voir l’autre.');
  if (s.truncated) parts.push('Trop de dépenses : chiffres partiels.');
  return parts.join(' ');
}

/** Phrase sous les graphiques des comptes : comptes réels, pas la vue des plans. */
export function noteComptes(s: AccountStats, devise: string): string {
  const parts = [
    `Soldes réels des comptes actifs en ${devise} (ouverture + entrées − sorties), jamais convertis.`,
    'La trésorerie mensuelle des plans BUILD est une vue simplifiée : ces soldes-ci font référence.',
  ];
  if (s.byCurrency.length > 1) parts.push('Choisissez la devise pour voir l’autre.');
  return parts.join(' ');
}

// ─── Dépenses ───────────────────────────────────────────────────────────────

export function cartesDepenses(s: ExpenseStats, b: BlocDepenses): CarteTableau[] {
  const d = b.currency;
  const periode = `de ${moisLong(s.from)} à ${moisLong(s.to)}`;
  const premiere = b.byCategoryThisMonth[0] ?? null;
  return [
    {
      id: 'mois',
      label: 'Dépensé ce mois',
      valeur: montantEntier(b.thisMonth.amount, d),
      note:
        b.thisMonth.count === 0
          ? 'Aucune dépense ce mois'
          : pluriel(b.thisMonth.count, 'dépense', 'dépenses'),
      ton: 'normal',
      serie: b.months.map((m) => nombre(m.amount)),
      couleur: 1,
      tendance: `Dépensé par mois ${periode}`,
    },
    {
      id: 'precedent',
      label: 'Vs mois précédent',
      valeur: b.changePercent === null ? '—' : variation(b.changePercent),
      note: `${montantEntier(b.previousMonth.amount, d)} en ${moisCourt(b.previousMonth.month)}`,
      ton: 'normal',
      serie: b.months.map((m) => m.count),
      couleur: 2,
      tendance: `Nombre de dépenses par mois ${periode}`,
    },
    {
      id: 'categorie',
      label: 'Première catégorie du mois',
      valeur: premiere ? montantEntier(premiere.amount, d) : '—',
      note: premiere ? premiere.label : 'Aucune dépense ce mois',
      ton: 'normal',
      serie: null,
      couleur: 3,
      tendance: '',
    },
    {
      id: 'piece',
      label: 'Sans pièce justificative',
      valeur: b.withoutAttachmentThisMonth.count.toLocaleString('fr-FR'),
      note:
        b.withoutAttachmentThisMonth.count === 0
          ? 'Toutes justifiées ce mois'
          : `${montantEntier(b.withoutAttachmentThisMonth.amount, d)} ce mois`,
      ton: b.withoutAttachmentThisMonth.count > 0 ? 'attention' : 'normal',
      serie: null,
      couleur: 5,
      tendance: '',
    },
  ];
}

export function barresCategoriesDepenses(b: BlocDepenses): BarItem[] {
  return b.byCategoryThisMonth.map((c) => ({
    id: c.category,
    label: `${c.label} · ${c.count.toLocaleString('fr-FR')}`,
    value: nombre(c.amount),
    display: compact(nombre(c.amount)),
  }));
}

export type OngletDepenses = 'recorded' | 'cancelled' | 'all';

export const ONGLETS_DEPENSES: readonly { valeur: OngletDepenses; label: string }[] = [
  { valeur: 'recorded', label: 'Enregistrées' },
  { valeur: 'cancelled', label: 'Annulées' },
  { valeur: 'all', label: 'Toutes' },
];

/** Compteurs des onglets, pour le mois affiché par la liste. */
export function compteursDepenses(s: ExpenseStats): Record<OngletDepenses, number> {
  return { ...s.statusCounts };
}

export function statutDepense(d: { status: 'recorded' | 'cancelled' }): {
  ton: StatusTone;
  label: string;
} {
  return d.status === 'cancelled'
    ? { ton: 'late', label: 'Annulée' }
    : { ton: 'ok', label: 'Enregistrée' };
}

// ─── Comptes ────────────────────────────────────────────────────────────────

export function cartesComptes(s: AccountStats, b: BlocComptes): CarteTableau[] {
  const d = b.currency;
  const periode = `de ${moisLong(s.from)} à ${moisLong(s.to)}`;
  const negatif = b.balance.startsWith('-');
  return [
    {
      id: 'solde',
      label: 'Solde total',
      valeur: signe(b.balance, d),
      note: pluriel(b.activeAccounts, 'compte actif', 'comptes actifs'),
      ton: negatif ? 'alerte' : 'normal',
      serie: b.months.map((m) => nombre(m.closingBalance)),
      couleur: 1,
      tendance: `Solde de fin de mois ${periode}`,
    },
    {
      id: 'entrees',
      label: 'Entrées du mois',
      valeur: montantEntier(b.thisMonth.inflows, d),
      note: `Variation nette ${signe(b.thisMonth.net, d)}`,
      ton: 'normal',
      serie: b.months.map((m) => nombre(m.inflows)),
      couleur: 2,
      tendance: `Entrées par mois ${periode}`,
    },
    {
      id: 'sorties',
      label: 'Sorties du mois',
      valeur: montantEntier(b.thisMonth.outflows, d),
      note: 'Dépenses, virements et autres sorties',
      ton: 'normal',
      serie: b.months.map((m) => nombre(m.outflows)),
      couleur: 4,
      tendance: `Sorties par mois ${periode}`,
    },
    {
      id: 'decouvert',
      label: 'Comptes à découvert',
      valeur: b.overdrawn.toLocaleString('fr-FR'),
      note: b.overdrawn === 0 ? 'Aucun solde négatif' : 'Solde négatif à régulariser',
      ton: b.overdrawn > 0 ? 'alerte' : 'normal',
      serie: null,
      couleur: 5,
      tendance: '',
    },
  ];
}

/** Solde par compte (les soldes négatifs sont listés sans barre, valeur 0). */
export function barresComptes(b: BlocComptes): BarItem[] {
  return b.accounts.map((a) => {
    const v = nombre(a.balance);
    return {
      id: a.accountId,
      label: a.name,
      value: v > 0 ? v : 0,
      display: signe(a.balance, b.currency),
    };
  });
}
