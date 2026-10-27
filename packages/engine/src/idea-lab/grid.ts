// ─────────────────────────────────────────────────────────────────────────────
// Idea Lab — grille de validation d'idée (ADR-0036 § 2.1)
//
// Grille EXPLICITE et VERSIONNÉE. Les poids et seuils sont des propositions de
// l'équipe, non sourcées (ADR-0036, décision ouverte n° 1) : changer un poids,
// c'est publier `IDEA_VALIDATION_GRID_V2`, jamais réécrire V1 — une idée garde la
// version de grille qui l'a notée.
// ─────────────────────────────────────────────────────────────────────────────

export const IDEA_LAB_VERSION = '1.0.0';

export const IDEA_CRITERION_IDS = [
  'probleme',
  'disposition_payer',
  'alternatives',
  'cible',
  'marche',
  'faisabilite',
  'modele_revenus',
] as const;
export type IdeaCriterionId = (typeof IDEA_CRITERION_IDS)[number];

export function isIdeaCriterionId(value: unknown): value is IdeaCriterionId {
  return typeof value === 'string' && (IDEA_CRITERION_IDS as readonly string[]).includes(value);
}

/** Note la plus haute de l'échelle (0 à 4). */
export const IDEA_NOTE_MAX = 4;

export const IDEA_NOTE_LABELS: Readonly<Record<number, string>> = Object.freeze({
  0: 'Les preuves contredisent le critère',
  1: 'Signal faible',
  2: 'Signal partiel',
  3: 'Signal solide',
  4: 'Signal fort, plusieurs preuves concordantes',
});

export interface IdeaCriterionDef {
  id: IdeaCriterionId;
  libelle: string;
  /** Poids entier ; la somme des poids d'une grille vaut 100. */
  poids: number;
  preuveAttendue: string;
  /**
   * `marche` : le critère n'est évaluable que si la fiche porte une taille de
   * marché AVEC sa source (ADR-0036 § 2.3).
   */
  exigeTailleDeMarcheSourcee?: true;
}

export interface IdeaValidationGrid {
  version: string;
  criteres: readonly IdeaCriterionDef[];
  /** Nombre minimal de critères renseignés pour publier un score. */
  criteresMin: number;
  /** Part minimale du poids total couverte par les critères renseignés, en %. */
  couvertureMinPct: number;
  /** Bornes des niveaux : < `fragile` → fragile ; < `aConsolider` → à consolider. */
  niveaux: { fragile: number; aConsolider: number };
}

export const IDEA_VALIDATION_GRID_V1: IdeaValidationGrid = Object.freeze({
  version: 'IDEA_VALIDATION_GRID_V1',
  criteres: Object.freeze([
    {
      id: 'probleme',
      libelle: 'Le problème est confirmé par des clients',
      poids: 25,
      preuveAttendue: 'Entretiens clients : combien, et ce qui a été entendu.',
    },
    {
      id: 'disposition_payer',
      libelle: 'Des clients sont prêts à payer',
      poids: 25,
      preuveAttendue: 'Pré-commandes, acomptes, lettres d’intention ou pré-ventes.',
    },
    {
      id: 'alternatives',
      libelle: 'Les alternatives et concurrents sont connus',
      poids: 15,
      preuveAttendue: 'Alternatives existantes, prix observés et d’où vient l’information.',
    },
    {
      id: 'cible',
      libelle: 'La cible est précise et joignable',
      poids: 10,
      preuveAttendue: 'Qui, où, et par quel canal on l’atteint.',
    },
    {
      id: 'marche',
      libelle: 'La taille du marché est déclarée avec sa source',
      poids: 10,
      preuveAttendue: 'Taille, périmètre et source saisis dans la fiche de l’idée.',
      exigeTailleDeMarcheSourcee: true,
    },
    {
      id: 'faisabilite',
      libelle: 'L’équipe peut réaliser la solution',
      poids: 10,
      preuveAttendue: 'Compétences, ressources et autorisations nécessaires.',
    },
    {
      id: 'modele_revenus',
      libelle: 'Le modèle de revenus est testé',
      poids: 5,
      preuveAttendue: 'Prix proposé et réaction des clients.',
    },
  ] satisfies IdeaCriterionDef[]),
  criteresMin: 4,
  couvertureMinPct: 60,
  niveaux: Object.freeze({ fragile: 40, aConsolider: 70 }),
});

/** Grilles publiées, par version. Une version inconnue est une erreur, jamais un défaut. */
export const IDEA_VALIDATION_GRIDS: Readonly<Record<string, IdeaValidationGrid>> = Object.freeze({
  [IDEA_VALIDATION_GRID_V1.version]: IDEA_VALIDATION_GRID_V1,
});

/** Grille appliquée aux nouvelles idées. */
export const CURRENT_IDEA_VALIDATION_GRID = IDEA_VALIDATION_GRID_V1;

export function ideaValidationGrid(version: string): IdeaValidationGrid {
  const grid = IDEA_VALIDATION_GRIDS[version];
  if (!grid) throw new Error(`Grille de validation inconnue : ${version}`);
  return grid;
}

// ─── Expériences de validation (ADR-0036 § 2.4) ──────────────────────────────

export const IDEA_EXPERIMENT_TYPES = [
  'entretiens',
  'page_attente',
  'pre_commande',
  'autre',
] as const;
export type IdeaExperimentType = (typeof IDEA_EXPERIMENT_TYPES)[number];

export const IDEA_EXPERIMENT_STATUSES = ['a_faire', 'en_cours', 'terminee'] as const;
export type IdeaExperimentStatus = (typeof IDEA_EXPERIMENT_STATUSES)[number];

export const IDEA_EXPERIMENT_CONCLUSIONS = ['confirmee', 'infirmee', 'non_concluante'] as const;
export type IdeaExperimentConclusion = (typeof IDEA_EXPERIMENT_CONCLUSIONS)[number];

export const IDEA_EXPERIMENT_LABELS: Readonly<Record<IdeaExperimentType, string>> = Object.freeze({
  entretiens: 'Entretiens clients',
  page_attente: 'Page d’attente',
  pre_commande: 'Pré-commande',
  autre: 'Autre expérience',
});

/** Checklist d'expériences recommandées, versionnée. */
export const IDEA_EXPERIMENT_CHECKLIST_V1 = Object.freeze({
  version: 'IDEA_EXPERIMENT_CHECKLIST_V1',
  points: Object.freeze([
    {
      type: 'entretiens' as const,
      libelle: 'Mener des entretiens avec des clients potentiels',
    },
    {
      type: 'page_attente' as const,
      libelle: 'Publier une page d’attente et mesurer les inscriptions',
    },
    {
      type: 'pre_commande' as const,
      libelle: 'Proposer une pré-commande et compter les engagements',
    },
  ]),
});
