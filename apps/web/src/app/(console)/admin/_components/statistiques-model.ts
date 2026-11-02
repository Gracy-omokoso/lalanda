// Module « Statistiques » de la console (ADR-0053 § 6.7 — lot P7). Fonctions pures,
// testées. L'API applique le seuil de diffusion ; ces fonctions l'AFFICHENT sans jamais
// le contourner : une case masquée s'écrit « < 5 », jamais une estimation.

import type { Plan } from '@/lib/api';
import { jsonRequest } from '@/lib/api';

import { LIBELLES_PLAN } from './admin-model';

export interface CaseStat {
  value: number | null;
  masked: boolean;
}

export interface LigneStat {
  key: string;
  cell: CaseStat;
}

/** Réponse de `GET /admin/stats` (agrégats seulement, aucun identifiant). */
export interface StatistiquesView {
  version: string;
  generatedAt: string;
  windowDays: number;
  minCell: number;
  organizations: {
    total: CaseStat;
    activeInWindow: CaseStat;
    createdInWindow: CaseStat;
    byPlan: LigneStat[];
    byCountry: LigneStat[];
    bySubscriptionStatus: LigneStat[];
    byType: LigneStat[];
  };
  users: { total: CaseStat; activeInWindow: CaseStat; createdInWindow: CaseStat };
  trials: { started: CaseStat; converted: CaseStat; ongoing: CaseStat };
  modules: LigneStat[];
  usage: { aiCallsInWindow: CaseStat; pdfExportsInWindow: CaseStat };
}

export const chargerStatistiques = (): Promise<StatistiquesView> =>
  jsonRequest<StatistiquesView>('/admin/stats', { method: 'GET' });

/** Valeur affichée : le nombre, ou « < seuil » pour une case masquée. */
export function afficherCase(c: CaseStat | null | undefined, seuil = 5): string {
  if (!c || c.masked || c.value === null) return `< ${seuil}`;
  return new Intl.NumberFormat('fr-FR').format(c.value);
}

const LIBELLES_ETAT: Record<string, string> = {
  none: 'Sans abonnement (gratuit)',
  trialing: 'Essai',
  active: 'Actif',
  past_due: 'Paiement en échec',
  grace: 'Période de grâce',
  suspended: 'Suspendu (impayé)',
  canceled: 'Résilié',
};

const LIBELLES_TYPE: Record<string, string> = {
  solo: 'Entrepreneur seul',
  agence: 'Agence ou cabinet',
  incubateur: 'Incubateur',
  banque: 'Banque',
  ecole: 'École',
};

const LIBELLES_MODULE: Record<string, string> = {
  projets: 'Projets et plans financiers',
  canvas: 'Business Model Canvas',
  idea_lab: 'Idea Lab',
  business_plan: 'Business plan',
  objectifs: 'Objectifs',
  crm: 'CRM',
  devis_factures: 'Devis et factures',
  contrats: 'Contrats',
  achats: 'Achats et fournisseurs',
  tresorerie: 'Trésorerie',
  travail: 'Projets du RUN',
  rh: 'Ressources humaines',
  stock: 'Stock',
  immobilisations: 'Immobilisations',
  comptabilite: 'Comptabilité',
};

export function libelleEtat(cle: string): string {
  return LIBELLES_ETAT[cle] ?? cle;
}

export function libelleType(cle: string): string {
  return LIBELLES_TYPE[cle] ?? cle;
}

export function libelleModule(cle: string): string {
  return LIBELLES_MODULE[cle] ?? cle;
}

export function libelleOffre(cle: string): string {
  return LIBELLES_PLAN[cle as Plan] ?? cle;
}

/** Nom d'un pays (code ISO-2), en français ; le code s'il est inconnu. */
export function libellePays(code: string): string {
  try {
    const nom = new Intl.DisplayNames(['fr'], { type: 'region' }).of(code);
    return nom && nom !== code ? `${nom} (${code})` : code;
  } catch {
    return code;
  }
}

/** Lignes d'une répartition : visibles d'abord par valeur décroissante, masquées ensuite. */
export function lignesTriees(lignes: readonly LigneStat[]): LigneStat[] {
  return [...lignes].sort((a, b) => {
    if (a.cell.masked !== b.cell.masked) return a.cell.masked ? 1 : -1;
    return (b.cell.value ?? 0) - (a.cell.value ?? 0) || a.key.localeCompare(b.key);
  });
}
