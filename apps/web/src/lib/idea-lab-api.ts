// Client de l'Idea Lab (ADR-0036).
//
// Les types reprennent la forme des réponses de `apps/api/src/idea-lab` (elles-mêmes
// produites par `packages/engine/src/idea-lab`). Le web ne calcule rien : score,
// taux, seuils et classement viennent du moteur par l'API.

import { jsonRequest } from './api';

export const CRITERION_IDS = [
  'probleme',
  'disposition_payer',
  'alternatives',
  'cible',
  'marche',
  'faisabilite',
  'modele_revenus',
] as const;
export type CriterionId = (typeof CRITERION_IDS)[number];

export const EXPERIMENT_TYPES = ['entretiens', 'page_attente', 'pre_commande', 'autre'] as const;
export type ExperimentType = (typeof EXPERIMENT_TYPES)[number];
export const EXPERIMENT_STATUSES = ['a_faire', 'en_cours', 'terminee'] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];
export const EXPERIMENT_CONCLUSIONS = ['confirmee', 'infirmee', 'non_concluante'] as const;
export type ExperimentConclusion = (typeof EXPERIMENT_CONCLUSIONS)[number];
export const HYPOTHESIS_STATUSES = ['a_tester', 'confirmee', 'infirmee'] as const;
export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];
export const MARKET_UNITS = ['personnes', 'menages', 'entreprises', 'montant'] as const;
export type MarketUnit = (typeof MARKET_UNITS)[number];

export interface Alternative {
  name: string;
  description: string;
  source: string | null;
}
export interface Hypothesis {
  id: string;
  text: string;
  status: HypothesisStatus;
}
export interface MarketSize {
  value: string;
  unit: MarketUnit;
  currency: string | null;
  scope: string;
  source: string;
  sourceDate: string | null;
  sourceUrl: string | null;
}

export interface IdeaFicheBody {
  title: string;
  problem: string;
  target: string;
  solution: string;
  alternatives: Alternative[];
  revenueModel: string;
  country: string | null;
  market: string;
  hypotheses: Hypothesis[];
  marketSize: MarketSize | null;
}

export type CriterionState =
  'renseigne' | 'non_renseigne' | 'preuve_manquante' | 'source_manquante';
export type ValidationLevel = 'fragile' | 'a_consolider' | 'prometteuse';

export interface CriterionResult {
  id: CriterionId;
  libelle: string;
  poids: number;
  preuveAttendue: string;
  etat: CriterionState;
  note: number | null;
  preuve: string | null;
  experiences: string[];
}

export type ValidationScore =
  | { disponible: true; valeur: number; niveau: ValidationLevel; libelleNiveau: string }
  | {
      disponible: false;
      raison: 'CRITERES_INSUFFISANTS';
      message: string;
      manquants: CriterionId[];
    };

export interface ValidationResult {
  ideaLabVersion: string;
  grilleVersion: string;
  criteres: CriterionResult[];
  couverture: {
    criteresRenseignes: number;
    criteresTotal: number;
    poidsRenseigne: number;
    poidsTotal: number;
    criteresMin: number;
    couvertureMinPct: number;
  };
  score: ValidationScore;
  signaux: { code: 'CRITERE_CONTREDIT'; critere: CriterionId; message: string }[];
  methode: string;
}

export interface ExperimentResults {
  realises: number | null;
  confirmant: number | null;
  visiteurs: number | null;
  inscrits: number | null;
  sollicites: number | null;
  precommandes: number | null;
  montant: string | null;
  devise: string | null;
}

export interface ExperimentSummary {
  id: string;
  type: ExperimentType;
  libelleType: string;
  statut: ExperimentStatus;
  taux: { numerateur: number; denominateur: number; valeur: number; libelle: string } | null;
  tauxIndisponible: { raison: string; message: string } | null;
  seuilPct: number | null;
  atteint: boolean | null;
  conclusion: ExperimentConclusion | null;
  ecartConclusion: boolean;
  termineeAvecResultat: boolean;
}

export interface ExperimentBody {
  type: ExperimentType;
  title: string;
  hypothesis: string;
  targetPct: number | null;
  status: ExperimentStatus;
  results: ExperimentResults;
  conclusion: ExperimentConclusion | null;
  notes: string;
}

export interface ExperimentView extends ExperimentBody {
  id: string;
  createdAt: string;
  updatedAt: string;
  summary: ExperimentSummary;
}

export interface IdeaView extends IdeaFicheBody {
  id: string;
  gridVersion: string;
  ratings: {
    criterionId: CriterionId;
    note: number;
    proof: string;
    experimentIds: string[];
    ratedAt: string;
  }[];
  experiments: ExperimentView[];
  experimentChecklist: {
    version: string;
    points: {
      type: ExperimentType;
      libelle: string;
      etat: 'a_prevoir' | 'prevue' | 'terminee';
      experiences: number;
    }[];
  };
  validation: ValidationResult;
  archived: boolean;
  promotions: { projectId: string; at: string; cards: number }[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface IdeaSummary {
  id: string;
  title: string;
  problem: string;
  archived: boolean;
  validation: ValidationScore;
  poidsRenseigne: number;
  experiments: number;
  completedExperiments: number;
  promotions: number;
  updatedAt: string;
}

export interface ComparisonRow {
  id: string;
  titre: string;
  rang: number | null;
  score: number | null;
  niveau: ValidationLevel | null;
  poidsRenseigne: number;
  criteresRenseignes: number;
  notes: Record<CriterionId, number | null>;
}

export interface AiQuota {
  limit: number | null;
  used: number;
  remaining: number | null;
  unlimited: boolean;
}

export interface IdeaListResponse {
  ideas: IdeaSummary[];
  comparison: ComparisonRow[];
  grid: {
    version: string;
    criteres: { id: CriterionId; libelle: string; poids: number; preuveAttendue: string }[];
    notes: { note: number; libelle: string }[];
    criteresMin: number;
    couvertureMinPct: number;
  };
  limits: { ideas: number; experimentsPerIdea: number };
  ai: {
    enabled: boolean;
    disabledBy: 'organization' | 'platform' | null;
    quota: AiQuota | null;
    mention: string;
  };
  canEdit: boolean;
  canManageAi: boolean;
}

export type AssistIntent = 'reformuler' | 'questions_entretien' | 'hypotheses';
export type AssistAnswer =
  | { intent: 'reformuler'; reformulation: { probleme: string; cible: string; solution: string } }
  | { intent: 'questions_entretien'; questions: string[] }
  | { intent: 'hypotheses'; hypotheses: { texte: string; test: string }[] };

export interface AssistResponse {
  intent: AssistIntent;
  answer: AssistAnswer;
  source: 'llm' | 'fallback';
  reason: 'desactivee_plateforme' | 'desactivee_organisation' | 'indisponible' | 'rejetee' | null;
  mention: string;
}

export interface PromotionResponse {
  idea: IdeaView;
  projectId: string;
  canvasVersion: number | null;
  added: { field: string; bloc: string; cardId: string; truncated: boolean }[];
  present: { field: string; cardId: string }[];
  ignored: { field: string; bloc: string; reason: 'BLOC_PLEIN' }[];
  empty: string[];
}

const base = '/idea-lab';
const idea = (id: string) => `${base}/ideas/${encodeURIComponent(id)}`;

export const ideaLabApi = {
  list: () => jsonRequest<IdeaListResponse>(`${base}/ideas`, { method: 'GET' }),
  get: (id: string) => jsonRequest<IdeaView>(idea(id), { method: 'GET' }),
  create: (body: IdeaFicheBody) => jsonRequest<IdeaView>(`${base}/ideas`, { method: 'POST', body }),
  update: (id: string, body: IdeaFicheBody) =>
    jsonRequest<IdeaView>(idea(id), { method: 'PUT', body }),
  setArchived: (id: string, archived: boolean) =>
    jsonRequest<IdeaView>(`${idea(id)}/archived`, { method: 'PUT', body: { archived } }),
  rate: (
    id: string,
    criterionId: CriterionId,
    body: { note: number; proof: string; experimentIds: string[] },
  ) => jsonRequest<IdeaView>(`${idea(id)}/ratings/${criterionId}`, { method: 'PUT', body }),
  clearRating: (id: string, criterionId: CriterionId) =>
    jsonRequest<IdeaView>(`${idea(id)}/ratings/${criterionId}`, { method: 'DELETE' }),
  addExperiment: (id: string, body: ExperimentBody) =>
    jsonRequest<IdeaView>(`${idea(id)}/experiments`, { method: 'POST', body }),
  updateExperiment: (id: string, experimentId: string, body: ExperimentBody) =>
    jsonRequest<IdeaView>(`${idea(id)}/experiments/${encodeURIComponent(experimentId)}`, {
      method: 'PUT',
      body,
    }),
  deleteExperiment: (id: string, experimentId: string) =>
    jsonRequest<IdeaView>(`${idea(id)}/experiments/${encodeURIComponent(experimentId)}`, {
      method: 'DELETE',
    }),
  promote: (id: string, projectId: string) =>
    jsonRequest<PromotionResponse>(`${idea(id)}/promote`, { method: 'POST', body: { projectId } }),
  assist: (id: string, intent: AssistIntent) =>
    jsonRequest<AssistResponse>(`${idea(id)}/assist`, { method: 'POST', body: { intent } }),
  putSettings: (aiEnabled: boolean) =>
    jsonRequest<{ aiEnabled: boolean; disabledBy: 'organization' | 'platform' | null }>(
      `${base}/settings`,
      { method: 'PUT', body: { aiEnabled } },
    ),
};
