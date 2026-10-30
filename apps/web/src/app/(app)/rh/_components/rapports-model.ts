// Rapports RH (ADR-0045 § 3.3, § 7) — logique pure, lot H7.
//
// Effectif, entrées et sorties (taux de sortie), absentéisme par service,
// ancienneté par tranches : tous les chiffres viennent de `GET /hr/reports` (moteur
// RH). L'écran ne calcule rien : il choisit une période, met en forme les chaînes
// décimales et donne aux barres une largeur PROPORTIONNELLE d'affichage (la valeur
// est toujours écrite en texte et reprise dans un tableau). Aucune donnée salariale.

import type { OrgAction } from '@/lib/api';
import type { HrReportsView } from '@/lib/api-hr-admin';

import { LIBELLES_SORTIE } from './parcours-model';
import { formatJour } from './rh-model';

type Actions = readonly OrgAction[] | null;

/** Export du registre : `hr.read` ET `hr.manage` (révision du 31 oct. 2026). */
export function peutExporterRegistre(actions: Actions): boolean {
  return actions !== null && actions.includes('hr.read') && actions.includes('hr.manage');
}

export const PERIODES = ['annee', '12-mois', 'annee-precedente'] as const;
export type Periode = (typeof PERIODES)[number];

export const LIBELLES_PERIODE: Record<Periode, string> = {
  annee: 'Année en cours',
  '12-mois': '12 derniers mois',
  'annee-precedente': 'Année précédente',
};

export function periodeDepuis(v: string): Periode {
  return (PERIODES as readonly string[]).includes(v) ? (v as Periode) : 'annee';
}

/** Bornes civiles d'une période choisie, à partir du jour de Kinshasa. */
export function bornesPeriode(p: Periode, aujourdhui: string): { from: string; to: string } {
  const annee = Number(aujourdhui.slice(0, 4));
  switch (p) {
    case 'annee':
      return { from: `${annee}-01-01`, to: aujourdhui };
    case 'annee-precedente':
      return { from: `${annee - 1}-01-01`, to: `${annee - 1}-12-31` };
    case '12-mois': {
      const mj = aujourdhui.slice(5);
      return { from: `${annee - 1}-${mj === '02-29' ? '02-28' : mj}`, to: aujourdhui };
    }
  }
}

export function requeteRapports(
  p: Periode,
  aujourdhui: string,
  departmentId: string,
): { from: string; to: string; departmentId?: string } {
  return { ...bornesPeriode(p, aujourdhui), ...(departmentId ? { departmentId } : {}) };
}

/** Largeur d'affichage d'une barre (0 à 100), bornée ; décorative. */
export function largeur(valeur: number, maximum: number): number {
  if (!(maximum > 0) || !(valeur > 0)) return 0;
  return Math.min(100, Math.max(2, Math.round((valeur / maximum) * 100)));
}

/** Pourcentage rendu par l'API (`"12.50"`) en français ; `null` : non calculable. */
export function formatTaux(valeur: string | null): string {
  if (valeur === null) return 'non calculable';
  const [e = '0', f = ''] = valeur.split('.');
  const frac = f.replace(/0+$/, '');
  return `${e}${frac ? `,${frac}` : ''} %`;
}

/** Nombre décimal rendu par l'API (`"3.50"`) en français, sans unité. */
export function formatDecimal(valeur: string): string {
  const [e = '0', f = ''] = valeur.split('.');
  const frac = f.replace(/0+$/, '');
  return `${e}${frac ? `,${frac}` : ''}`;
}

/** Largeur d'une barre de taux : le pourcentage lui-même, borné à 100. */
export function largeurTaux(valeur: string | null): number {
  if (valeur === null) return 0;
  const n = Number(valeur);
  return Number.isFinite(n) ? Math.min(100, Math.max(n > 0 ? 2 : 0, n)) : 0;
}

export const LIBELLES_ANCIENNETE: Record<
  HrReportsView['seniority']['buckets'][number]['bucket'],
  string
> = {
  lt1: 'Moins d’un an',
  '1to3': 'De 1 à 3 ans',
  '3to5': 'De 3 à 5 ans',
  '5to10': 'De 5 à 10 ans',
  gte10: '10 ans et plus',
};

export function libelleCategorieSortie(c: string | null): string {
  if (c === null) return 'Non précisée';
  return (LIBELLES_SORTIE as Record<string, string>)[c] ?? c;
}

export interface LigneBarre {
  cle: string;
  libelle: string;
  valeur: string;
  largeur: number;
}

/** Lignes de barres pour des comptes (effectif par service, par contrat, ancienneté…). */
export function lignesComptes(
  comptes: readonly { key: string | null; label: string; count: number }[],
): LigneBarre[] {
  const max = Math.max(0, ...comptes.map((c) => c.count));
  return comptes.map((c) => ({
    cle: c.key ?? '∅',
    libelle: c.label,
    valeur: String(c.count),
    largeur: largeur(c.count, max),
  }));
}

export function lignesAnciennete(v: HrReportsView['seniority']): LigneBarre[] {
  return lignesComptes(
    v.buckets.map((b) => ({ key: b.bucket, label: LIBELLES_ANCIENNETE[b.bucket], count: b.count })),
  );
}

export function lignesSorties(v: HrReportsView['movements']): LigneBarre[] {
  return lignesComptes(
    v.exitsByCategory.map((x) => ({
      key: x.category,
      label: libelleCategorieSortie(x.category),
      count: x.count,
    })),
  );
}

export function lignesAbsenteisme(v: HrReportsView['absenteeism']): LigneBarre[] {
  return v.groups.map((g) => ({
    cle: g.departmentId ?? '∅',
    libelle: g.label,
    valeur: formatTaux(g.ratePercent),
    largeur: largeurTaux(g.ratePercent),
  }));
}

export function phrasePeriodeRapport(v: Pick<HrReportsView, 'from' | 'to'>): string {
  return `Du ${formatJour(v.from)} au ${formatJour(v.to)}.`;
}

export const MENTION_TAUX_SORTIE =
  'Taux de sortie : sorties de la période ÷ effectif moyen. Indicateur défini par Lalanda, pas une norme légale.';

export const MENTION_ABSENTEISME =
  'Absentéisme : jours d’absence des types comptés ÷ jours travaillés théoriques, par service — jamais par personne.';
