// Client de l'espace Croissance (GROW — ADR-0032).
//
// Les types reprennent la forme des réponses de `apps/api/src/grow` (elles-mêmes
// produites par `packages/engine/src/grow`). Le web ne calcule rien : il affiche
// les valeurs, sources, périodes et hypothèses que l'API lui sert.

import { jsonRequest } from './api';

export const JOURNEY_STAGES = [
  'IDEA',
  'VALIDATION',
  'MVP',
  'FIRST_CUSTOMER',
  'PMF',
  'GROWTH',
  'SCALE',
  'FUNDRAISING',
] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

export type GrowSource = 'build.actuals' | 'run.sales' | 'grow.declared_cash';
export interface GrowSourceRef {
  source: GrowSource;
  libelle: string;
}
export interface GrowPeriod {
  libelle: string;
  mois: string[];
}

export type GrowIndicatorCode =
  | 'mrr'
  | 'arr'
  | 'burn_rate'
  | 'runway'
  | 'croissance_ventes'
  | 'croissance_ca_realise'
  | 'marge_brute'
  | 'marge_nette'
  | 'concentration_clients'
  | 'clients_revenants';

export interface GrowTopCustomer {
  rang: number;
  cle: string;
  nom: string | null;
  montant: number;
  part: number;
}

export interface GrowIndicatorAvailable {
  code: GrowIndicatorCode;
  libelle: string;
  disponible: true;
  valeur: number;
  unite: 'montant' | 'ratio' | 'mois';
  devise: string | null;
  sources: GrowSourceRef[];
  periode: GrowPeriod;
  methode: string;
  hypotheses: string[];
  premiersClients?: GrowTopCustomer[];
  partTroisPremiers?: number;
}
export interface GrowIndicatorUnavailable {
  code: GrowIndicatorCode;
  libelle: string;
  disponible: false;
  raison: string;
  message: string;
  sources: GrowSourceRef[];
  hypotheses: string[];
}
export type GrowIndicator = GrowIndicatorAvailable | GrowIndicatorUnavailable;

export interface GrowFacts {
  devise: string | null;
  projet: { id: string; nom: string; selection: 'declared' | 'only_project' } | null;
  moisClotures: number;
  derniereCloture: string | null;
  caRealisePositif: boolean;
  documentsRetenus: number;
  documentsExclus: { acomptes: number; serieEssai: number; autreDevise: number };
  premiereVente: string | null;
  clientsDistincts12Mois: number;
  dernierMoisComplet: string;
}

export interface GrowIndicatorsView {
  growVersion: string;
  asOf: string;
  indicateurs: Record<GrowIndicatorCode, GrowIndicator>;
  faits: GrowFacts;
}

export type HealthAxis = 'finance' | 'tresorerie' | 'ventes' | 'fidelisation';
export interface HealthMetric {
  code: GrowIndicatorCode;
  libelle: string;
  disponible: boolean;
  valeur: number | null;
  note: number | null;
  raison: string | null;
  message: string | null;
  sources: GrowSourceRef[];
}
export interface HealthAxisView {
  axe: HealthAxis;
  libelle: string;
  poids: number;
  disponible: boolean;
  note: number | null;
  metriques: HealthMetric[];
}
export type RiskSeverity = 'critique' | 'haute' | 'moyenne' | 'faible';
export interface HealthRisk {
  code: string;
  gravite: RiskSeverity;
  titre: string;
  message: string;
  preuve: { donnee: string; valeur: string; seuil: string; regle: string };
  sources: GrowSourceRef[];
}
export interface HealthAction {
  code: string;
  titre: string;
  detail: string;
  pourquoi: string;
  variable: string;
  origine: 'risque' | 'donnees';
}
export type HealthGlobal =
  | { disponible: true; valeur: number; couverture: number }
  | {
      disponible: false;
      raison: 'DONNEES_INSUFFISANTES';
      message: string;
      couverture: number;
      manquants: string[];
    };
export interface HealthScoreView {
  growVersion: string;
  baremesVersion: string;
  ponderationsVersion: string;
  risquesVersion: string;
  etape: JourneyStage;
  groupe: 'amorcage' | 'traction' | 'croissance';
  score: HealthGlobal;
  axes: HealthAxisView[];
  axesNonCouverts: { axe: string; libelle: string; raison: string }[];
  risques: HealthRisk[];
  actions: HealthAction[];
}
export interface GrowHealthResponse {
  asOf: string;
  health: HealthScoreView;
  faits: GrowFacts;
}

export type ConditionState = 'remplie' | 'non_remplie' | 'inconnue';
export interface JourneyCondition {
  code: string;
  libelle: string;
  etat: ConditionState;
  valeur: string | null;
  seuil: string;
}
export interface ChecklistItem {
  id: string;
  libelle: string;
  mode: 'auto' | 'manuel';
  fait: boolean | null;
}
export interface JourneyStageView {
  etape: JourneyStage;
  libelle: string;
  atteinte: boolean;
  suggerable: boolean;
  conditions: JourneyCondition[];
  checklist: ChecklistItem[];
}
export interface JourneyView {
  growVersion: string;
  reglesVersion: string;
  suggeree: JourneyStage;
  declaree: JourneyStage | null;
  retenue: JourneyStage;
  ecart: boolean;
  etapes: JourneyStageView[];
}
export interface GrowJourneyResponse {
  asOf: string;
  journey: JourneyView;
}

export interface GrowDeclaredCash {
  amount: string;
  currency: string;
  asOf: string;
  declaredBy: string;
  declaredAt: string;
}
export interface GrowProfileView {
  referenceProjectId: string | null;
  declaredStage: JourneyStage | null;
  recurringCatalogItemIds: string[];
  checklistDone: string[];
  declaredCash: GrowDeclaredCash | null;
  updatedAt: string | null;
}
export interface GrowProfileResponse extends GrowProfileView {
  projects: { id: string; name: string; currency: string }[];
  planAllowsGrow: boolean;
  plan: string;
}

export interface PutGrowProfileBody {
  referenceProjectId: string | null;
  declaredStage: JourneyStage | null;
  recurringCatalogItemIds: string[];
}

export const growApi = {
  getProfile: () => jsonRequest<GrowProfileResponse>('/grow/profile', { method: 'GET' }),
  getJourney: () => jsonRequest<GrowJourneyResponse>('/grow/journey', { method: 'GET' }),
  getHealth: () => jsonRequest<GrowHealthResponse>('/grow/health', { method: 'GET' }),
  getIndicators: () => jsonRequest<GrowIndicatorsView>('/grow/indicators', { method: 'GET' }),
  putProfile: (body: PutGrowProfileBody) =>
    jsonRequest<GrowProfileView>('/grow/profile', { method: 'PUT', body }),
  putChecklist: (itemId: string, done: boolean) =>
    jsonRequest<GrowProfileView>(`/grow/checklist/${encodeURIComponent(itemId)}`, {
      method: 'PUT',
      body: { done },
    }),
  putDeclaredCash: (body: { amount: string; currency: string; asOf: string }) =>
    jsonRequest<GrowProfileView>('/grow/declared-cash', { method: 'PUT', body }),
  deleteDeclaredCash: () =>
    jsonRequest<GrowProfileView>('/grow/declared-cash', { method: 'DELETE' }),
};
