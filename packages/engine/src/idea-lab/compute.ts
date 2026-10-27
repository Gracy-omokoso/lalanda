// ─────────────────────────────────────────────────────────────────────────────
// Idea Lab — score de validation, expériences, comparaison, faits du parcours
// (ADR-0036 § 2, § 1, § 5)
//
// Module PUR : ni horloge, ni base, ni réseau. Le moteur ne JUGE pas une idée :
// il agrège des notes SAISIES par l'utilisateur, chacune avec sa preuve, selon
// les poids publiés d'une grille versionnée. Aucune valeur n'est inventée : un
// score qui ne repose pas sur assez de critères est « indisponible » et le dit.
// Arithmétique entière (score, taux) : aucun flottant ne décide d'un arrondi.
// ─────────────────────────────────────────────────────────────────────────────

import {
  IDEA_EXPERIMENT_CHECKLIST_V1,
  IDEA_EXPERIMENT_LABELS,
  IDEA_LAB_VERSION,
  IDEA_NOTE_MAX,
  ideaValidationGrid,
  type IdeaCriterionId,
  type IdeaExperimentConclusion,
  type IdeaExperimentStatus,
  type IdeaExperimentType,
} from './grid.js';

// ─── Score de validation ─────────────────────────────────────────────────────

export interface IdeaRatingInput {
  criterionId: string;
  /** Note entière 0 à 4. */
  note: number;
  /** Preuve saisie par l'utilisateur. */
  preuve: string;
  /** Expériences de l'idée citées comme preuve. */
  experimentIds?: readonly string[];
}

export interface IdeaValidationInput {
  gridVersion: string;
  ratings: readonly IdeaRatingInput[];
  /** Taille de marché déclarée ; seule sa source compte ici (ADR-0036 § 2.3). */
  marketSize: { source: string } | null;
}

/** Longueur minimale d'une preuve (caractères utiles). */
export const IDEA_PROOF_MIN_LENGTH = 3;

export type IdeaCriterionState =
  'renseigne' | 'non_renseigne' | 'preuve_manquante' | 'source_manquante';

export interface IdeaCriterionResult {
  id: IdeaCriterionId;
  libelle: string;
  poids: number;
  preuveAttendue: string;
  etat: IdeaCriterionState;
  /** Note retenue, `null` si le critère n'est pas renseigné. */
  note: number | null;
  preuve: string | null;
  experiences: string[];
}

export type IdeaValidationLevel = 'fragile' | 'a_consolider' | 'prometteuse';

export const IDEA_LEVEL_LABELS: Readonly<Record<IdeaValidationLevel, string>> = Object.freeze({
  fragile: 'Preuves fragiles',
  a_consolider: 'Preuves à consolider',
  prometteuse: 'Preuves prometteuses',
});

export type IdeaValidationScore =
  | {
      disponible: true;
      valeur: number;
      niveau: IdeaValidationLevel;
      libelleNiveau: string;
    }
  | {
      disponible: false;
      raison: 'CRITERES_INSUFFISANTS';
      message: string;
      /** Critères non renseignés, poids décroissants. */
      manquants: IdeaCriterionId[];
    };

export interface IdeaValidationSignal {
  code: 'CRITERE_CONTREDIT';
  critere: IdeaCriterionId;
  message: string;
}

export interface IdeaValidationResult {
  ideaLabVersion: string;
  grilleVersion: string;
  criteres: IdeaCriterionResult[];
  couverture: {
    criteresRenseignes: number;
    criteresTotal: number;
    /** Somme des poids des critères renseignés (sur 100). */
    poidsRenseigne: number;
    poidsTotal: number;
    criteresMin: number;
    couvertureMinPct: number;
  };
  score: IdeaValidationScore;
  signaux: IdeaValidationSignal[];
  /** Méthode, en une phrase, pour l'écran. */
  methode: string;
}

/** Arrondi au plus proche, demi vers le haut, de num ÷ den (entiers ≥ 0, den > 0). */
function roundHalfUp(num: number, den: number): number {
  return Math.floor((2 * num + den) / (2 * den));
}

function isValidNote(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= IDEA_NOTE_MAX;
}

function hasProof(text: string | undefined | null): boolean {
  return typeof text === 'string' && text.trim().length >= IDEA_PROOF_MIN_LENGTH;
}

/** Score de validation d'une idée (ADR-0036 § 2.2). */
export function computeValidationScore(input: IdeaValidationInput): IdeaValidationResult {
  const grid = ideaValidationGrid(input.gridVersion);
  // Une note par critère : en cas de doublon, la dernière saisie l'emporte.
  const byCriterion = new Map<string, IdeaRatingInput>();
  for (const r of input.ratings) byCriterion.set(r.criterionId, r);
  const marketSourced = input.marketSize !== null && hasProof(input.marketSize.source);

  const criteres: IdeaCriterionResult[] = grid.criteres.map((c) => {
    const r = byCriterion.get(c.id);
    const base = {
      id: c.id,
      libelle: c.libelle,
      poids: c.poids,
      preuveAttendue: c.preuveAttendue,
    };
    if (!r || !isValidNote(r.note)) {
      return { ...base, etat: 'non_renseigne', note: null, preuve: null, experiences: [] };
    }
    const experiences = [...new Set(r.experimentIds ?? [])];
    if (!hasProof(r.preuve)) {
      return { ...base, etat: 'preuve_manquante', note: null, preuve: null, experiences };
    }
    if (c.exigeTailleDeMarcheSourcee && !marketSourced) {
      return {
        ...base,
        etat: 'source_manquante',
        note: null,
        preuve: r.preuve.trim(),
        experiences,
      };
    }
    return { ...base, etat: 'renseigne', note: r.note, preuve: r.preuve.trim(), experiences };
  });

  const renseignes = criteres.filter((c) => c.etat === 'renseigne');
  const poidsTotal = grid.criteres.reduce((s, c) => s + c.poids, 0);
  const poidsRenseigne = renseignes.reduce((s, c) => s + c.poids, 0);
  const somme = renseignes.reduce((s, c) => s + c.poids * (c.note ?? 0), 0);

  const assez =
    renseignes.length >= grid.criteresMin &&
    poidsRenseigne * 100 >= grid.couvertureMinPct * poidsTotal;

  let score: IdeaValidationScore;
  if (!assez) {
    const manquants = criteres
      .filter((c) => c.etat !== 'renseigne')
      .sort((a, b) => b.poids - a.poids)
      .map((c) => c.id);
    score = {
      disponible: false,
      raison: 'CRITERES_INSUFFISANTS',
      message:
        `Score indisponible : ${renseignes.length} critère(s) renseigné(s) avec une preuve, ` +
        `couvrant ${poidsRenseigne} % du poids. Il en faut au moins ${grid.criteresMin}, ` +
        `couvrant au moins ${grid.couvertureMinPct} %.`,
      manquants,
    };
  } else {
    const valeur = roundHalfUp(100 * somme, IDEA_NOTE_MAX * poidsRenseigne);
    const niveau: IdeaValidationLevel =
      valeur < grid.niveaux.fragile
        ? 'fragile'
        : valeur < grid.niveaux.aConsolider
          ? 'a_consolider'
          : 'prometteuse';
    score = { disponible: true, valeur, niveau, libelleNiveau: IDEA_LEVEL_LABELS[niveau] };
  }

  const signaux: IdeaValidationSignal[] = renseignes
    .filter((c) => c.note === 0)
    .map((c) => ({
      code: 'CRITERE_CONTREDIT',
      critere: c.id,
      message: `Vos preuves contredisent le critère « ${c.libelle} ».`,
    }));

  return {
    ideaLabVersion: IDEA_LAB_VERSION,
    grilleVersion: grid.version,
    criteres,
    couverture: {
      criteresRenseignes: renseignes.length,
      criteresTotal: grid.criteres.length,
      poidsRenseigne,
      poidsTotal,
      criteresMin: grid.criteresMin,
      couvertureMinPct: grid.couvertureMinPct,
    },
    score,
    signaux,
    methode:
      `Moyenne des notes (0 à ${IDEA_NOTE_MAX}) des critères renseignés avec une preuve, ` +
      `pondérée par les poids de la grille ${grid.version}, ramenée sur 100.`,
  };
}

// ─── Expériences ─────────────────────────────────────────────────────────────

export interface IdeaExperimentResultsInput {
  realises?: number | null;
  confirmant?: number | null;
  visiteurs?: number | null;
  inscrits?: number | null;
  sollicites?: number | null;
  precommandes?: number | null;
}

export interface IdeaExperimentInput {
  id: string;
  type: IdeaExperimentType;
  status: IdeaExperimentStatus;
  /** Critère de réussite chiffré, en % entier, ou `null`. */
  targetPct: number | null;
  conclusion: IdeaExperimentConclusion | null;
  results: IdeaExperimentResultsInput;
}

export type IdeaRateUnavailableReason =
  'NON_APPLICABLE' | 'RESULTATS_NON_SAISIS' | 'DENOMINATEUR_NUL' | 'RESULTATS_INCOHERENTS';

export interface IdeaExperimentSummary {
  id: string;
  type: IdeaExperimentType;
  libelleType: string;
  statut: IdeaExperimentStatus;
  /** Taux observé : fraction exacte et ratio arrondi à 4 décimales. */
  taux: { numerateur: number; denominateur: number; valeur: number; libelle: string } | null;
  tauxIndisponible: { raison: IdeaRateUnavailableReason; message: string } | null;
  seuilPct: number | null;
  /** Seuil atteint (taux ≥ seuil), `null` si l'un des deux manque. */
  atteint: boolean | null;
  conclusion: IdeaExperimentConclusion | null;
  /** Le seuil calculé contredit la conclusion déclarée : montré, jamais corrigé. */
  ecartConclusion: boolean;
  /** Terminée, conclue, et (hors « autre ») avec un taux lisible. */
  termineeAvecResultat: boolean;
}

const RATE_FIELDS: Readonly<
  Record<
    Exclude<IdeaExperimentType, 'autre'>,
    {
      num: keyof IdeaExperimentResultsInput;
      den: keyof IdeaExperimentResultsInput;
      libelle: string;
    }
  >
> = {
  entretiens: { num: 'confirmant', den: 'realises', libelle: 'Entretiens confirmant le problème' },
  page_attente: { num: 'inscrits', den: 'visiteurs', libelle: 'Visiteurs inscrits' },
  pre_commande: {
    num: 'precommandes',
    den: 'sollicites',
    libelle: 'Personnes sollicitées ayant pré-commandé',
  },
};

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** Résumé d'une expérience (ADR-0036 § 2.4). */
export function summarizeExperiment(e: IdeaExperimentInput): IdeaExperimentSummary {
  let taux: IdeaExperimentSummary['taux'] = null;
  let tauxIndisponible: IdeaExperimentSummary['tauxIndisponible'] = null;

  if (e.type === 'autre') {
    tauxIndisponible = {
      raison: 'NON_APPLICABLE',
      message: 'Cette expérience n’a pas de taux : son résultat est votre conclusion.',
    };
  } else {
    const f = RATE_FIELDS[e.type];
    const n = e.results[f.num];
    const d = e.results[f.den];
    if (!isCount(n) || !isCount(d)) {
      tauxIndisponible = {
        raison: 'RESULTATS_NON_SAISIS',
        message: 'Saisissez les résultats pour obtenir le taux.',
      };
    } else if (d === 0) {
      tauxIndisponible = {
        raison: 'DENOMINATEUR_NUL',
        message: 'Le taux ne se calcule pas sur zéro personne.',
      };
    } else if (n > d) {
      tauxIndisponible = {
        raison: 'RESULTATS_INCOHERENTS',
        message: 'Le nombre de réponses positives dépasse le nombre de personnes : à corriger.',
      };
    } else {
      taux = {
        numerateur: n,
        denominateur: d,
        valeur: roundHalfUp(10_000 * n, d) / 10_000,
        libelle: f.libelle,
      };
    }
  }

  const seuilPct = typeof e.targetPct === 'number' ? e.targetPct : null;
  // n/d ≥ s/100 ⇔ 100·n ≥ s·d — comparaison exacte en entiers.
  const atteint =
    taux === null || seuilPct === null
      ? null
      : 100 * taux.numerateur >= seuilPct * taux.denominateur;
  const ecartConclusion =
    atteint !== null &&
    ((atteint && e.conclusion === 'infirmee') || (!atteint && e.conclusion === 'confirmee'));
  const termineeAvecResultat =
    e.status === 'terminee' && e.conclusion !== null && (e.type === 'autre' || taux !== null);

  return {
    id: e.id,
    type: e.type,
    libelleType: IDEA_EXPERIMENT_LABELS[e.type],
    statut: e.status,
    taux,
    tauxIndisponible,
    seuilPct,
    atteint,
    conclusion: e.conclusion,
    ecartConclusion,
    termineeAvecResultat,
  };
}

export type IdeaChecklistState = 'a_prevoir' | 'prevue' | 'terminee';

export interface IdeaExperimentChecklistItem {
  type: IdeaExperimentType;
  libelle: string;
  etat: IdeaChecklistState;
  experiences: number;
}

/** Checklist d'expériences recommandées (IDEA_EXPERIMENT_CHECKLIST_V1). */
export function experimentChecklist(summaries: readonly IdeaExperimentSummary[]): {
  version: string;
  points: IdeaExperimentChecklistItem[];
} {
  return {
    version: IDEA_EXPERIMENT_CHECKLIST_V1.version,
    points: IDEA_EXPERIMENT_CHECKLIST_V1.points.map((p) => {
      const of = summaries.filter((s) => s.type === p.type);
      const etat: IdeaChecklistState =
        of.length === 0
          ? 'a_prevoir'
          : of.some((s) => s.termineeAvecResultat)
            ? 'terminee'
            : 'prevue';
      return { type: p.type, libelle: p.libelle, etat, experiences: of.length };
    }),
  };
}

// ─── Comparaison des idées (ADR-0036 § 1) ────────────────────────────────────

export interface IdeaComparisonInput {
  id: string;
  titre: string;
  validation: IdeaValidationResult;
}

export interface IdeaComparisonRow {
  id: string;
  titre: string;
  /** Rang parmi les idées au score disponible ; `null` sinon. */
  rang: number | null;
  score: number | null;
  niveau: IdeaValidationLevel | null;
  poidsRenseigne: number;
  criteresRenseignes: number;
  notes: Record<IdeaCriterionId, number | null>;
}

/**
 * Classement : score disponible d'abord, score décroissant, puis couverture
 * décroissante, puis titre. Une idée non notée n'est JAMAIS classée devant une
 * idée notée, et ne reçoit pas de rang.
 */
export function compareIdeas(rows: readonly IdeaComparisonInput[]): IdeaComparisonRow[] {
  const mapped = rows.map((r) => {
    const s = r.validation.score;
    const notes = Object.fromEntries(
      r.validation.criteres.map((c) => [c.id, c.etat === 'renseigne' ? c.note : null]),
    ) as Record<IdeaCriterionId, number | null>;
    return {
      id: r.id,
      titre: r.titre,
      rang: null as number | null,
      score: s.disponible ? s.valeur : null,
      niveau: s.disponible ? s.niveau : null,
      poidsRenseigne: r.validation.couverture.poidsRenseigne,
      criteresRenseignes: r.validation.couverture.criteresRenseignes,
      notes,
    };
  });
  mapped.sort((a, b) => {
    if ((a.score === null) !== (b.score === null)) return a.score === null ? 1 : -1;
    if (a.score !== null && b.score !== null && a.score !== b.score) return b.score - a.score;
    if (a.poidsRenseigne !== b.poidsRenseigne) return b.poidsRenseigne - a.poidsRenseigne;
    const t = a.titre.localeCompare(b.titre, 'fr');
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });
  let rang = 0;
  for (const m of mapped) if (m.score !== null) m.rang = ++rang;
  return mapped;
}

// ─── Faits pour le parcours GROW (ADR-0036 § 5) ──────────────────────────────

export interface IdeaLabJourneyFacts {
  /** Idées actives (non archivées). */
  ideas: number;
  /** Idées actives dont le problème, la cible et la solution sont renseignés. */
  ideasDescribed: number;
  /** Idées actives au score de validation disponible. */
  scoredIdeas: number;
  bestScore: number | null;
  /** Expériences terminées avec résultat, sur les idées actives. */
  completedExperiments: number;
}

export interface IdeaJourneyInput {
  archived: boolean;
  problem: string;
  target: string;
  solution: string;
  validation: IdeaValidationResult;
  experiments: readonly IdeaExperimentSummary[];
}

export function ideaLabJourneyFacts(ideas: readonly IdeaJourneyInput[]): IdeaLabJourneyFacts {
  const active = ideas.filter((i) => !i.archived);
  const scores = active.flatMap((i) =>
    i.validation.score.disponible ? [i.validation.score.valeur] : [],
  );
  return {
    ideas: active.length,
    ideasDescribed: active.filter(
      (i) => i.problem.trim() !== '' && i.target.trim() !== '' && i.solution.trim() !== '',
    ).length,
    scoredIdeas: scores.length,
    bestScore: scores.length > 0 ? Math.max(...scores) : null,
    completedExperiments: active.reduce(
      (s, i) => s + i.experiments.filter((e) => e.termineeAvecResultat).length,
      0,
    ),
  };
}
