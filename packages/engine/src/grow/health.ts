// ─────────────────────────────────────────────────────────────────────────────
// GROW — Business Health Score (ADR-0032 § 4)
//
// Score synthétique sur les axes couverts par une donnée réelle, pondéré selon le
// stade de l'entreprise, INDISPONIBLE si les données sont insuffisantes. Trois
// risques et trois actions, par règles déterministes et sourcées : chaque message
// dit « pourquoi » (donnée, valeur, seuil, règle). Aucun LLM.
//
// Toutes les tables sont versionnées : changer un seuil, c'est publier une
// nouvelle version, jamais modifier silencieusement un score déjà montré.
// ─────────────────────────────────────────────────────────────────────────────

import { daysBetween, kinshasaDateOf } from './periods.js';
import {
  JOURNEY_STAGE_LABELS,
  stageGroup,
  type JourneyStage,
  type JourneyStageGroup,
} from './journey.js';
import type {
  GrowIndicator,
  GrowIndicatorCode,
  GrowIndicatorsResult,
  GrowSourceRef,
} from './types.js';

export const HEALTH_AXES = ['finance', 'tresorerie', 'ventes', 'fidelisation'] as const;
export type HealthAxis = (typeof HEALTH_AXES)[number];

const AXIS_LABELS: Readonly<Record<HealthAxis, string>> = {
  finance: 'Finance',
  tresorerie: 'Trésorerie',
  ventes: 'Ventes',
  fidelisation: 'Fidélisation',
};

/** Axes du brief sans source de données dans ce lot (ADR-0032 § 4, § 9). */
export const HEALTH_AXES_NOT_COVERED: readonly { axe: string; libelle: string; raison: string }[] =
  Object.freeze([
    {
      axe: 'marketing',
      libelle: 'Marketing',
      raison: 'Aucun connecteur publicitaire ni d’analyse d’audience (lot ultérieur).',
    },
    {
      axe: 'operations',
      libelle: 'Opérations',
      raison: 'Aucune donnée d’opérations dans Lalanda.',
    },
    { axe: 'rh', libelle: 'Ressources humaines', raison: 'Aucune donnée RH dans Lalanda.' },
  ]);

type Anchors = readonly (readonly [number, number])[];

/** Barèmes : points d'ancrage (valeur → note 0–100), interpolation linéaire. */
export const GROW_SCORING_V1 = Object.freeze({
  version: 'GROW_SCORING_V1',
  marge_nette: [
    [-0.2, 0],
    [0, 50],
    [0.15, 100],
  ] as Anchors,
  runway: [
    [0, 0],
    [3, 15],
    [6, 40],
    [12, 75],
    [18, 100],
  ] as Anchors,
  croissance: [
    [-0.3, 0],
    [0, 50],
    [0.3, 100],
  ] as Anchors,
  clients_revenants: [
    [0, 0],
    [0.6, 100],
  ] as Anchors,
  concentration_clients: [
    [0.2, 100],
    [0.5, 40],
    [0.8, 0],
  ] as Anchors,
});

/** Pondérations par groupe d'étapes (somme = 100 par groupe). */
export const GROW_WEIGHTS_V1: Readonly<{
  version: string;
  groupes: Readonly<Record<JourneyStageGroup, Readonly<Record<HealthAxis, number>>>>;
  /** Couverture minimale du poids total pour publier un score global. */
  couvertureMin: number;
  /** Nombre minimal d'axes disponibles. */
  axesMin: number;
}> = Object.freeze({
  version: 'GROW_WEIGHTS_V1',
  groupes: {
    amorcage: { finance: 15, tresorerie: 45, ventes: 25, fidelisation: 15 },
    traction: { finance: 20, tresorerie: 35, ventes: 25, fidelisation: 20 },
    croissance: { finance: 30, tresorerie: 25, ventes: 25, fidelisation: 20 },
  },
  couvertureMin: 0.6,
  axesMin: 2,
});

/** Interpolation linéaire bornée entre points d'ancrage triés par valeur croissante. */
export function interpolateScore(anchors: Anchors, x: number): number {
  if (!Number.isFinite(x) || anchors.length === 0) {
    throw new RangeError('Barème ou valeur invalide');
  }
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i += 1) {
    const [x1, y1] = anchors[i]!;
    const [x0, y0] = anchors[i - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return last[1];
}

function pct(v: number): string {
  return `${Math.round(v * 1000) / 10} %`;
}

// ─── Axes ────────────────────────────────────────────────────────────────────

export interface HealthMetric {
  code: GrowIndicatorCode;
  libelle: string;
  disponible: boolean;
  /** Valeur de l'indicateur (ratio ou mois), `null` si indisponible. */
  valeur: number | null;
  /** Note 0–100, `null` si indisponible. */
  note: number | null;
  /** Raison d'indisponibilité, ou précision (« pas de consommation »). */
  raison: string | null;
  message: string | null;
  sources: readonly GrowSourceRef[];
}

export interface HealthAxisView {
  axe: HealthAxis;
  libelle: string;
  poids: number;
  disponible: boolean;
  /** Moyenne des notes disponibles de l'axe, arrondie à l'entier. */
  note: number | null;
  metriques: readonly HealthMetric[];
}

function metric(ind: GrowIndicator, anchors: Anchors): HealthMetric {
  if (!ind.disponible) {
    return {
      code: ind.code,
      libelle: ind.libelle,
      disponible: false,
      valeur: null,
      note: null,
      raison: ind.raison,
      message: ind.message,
      sources: ind.sources,
    };
  }
  return {
    code: ind.code,
    libelle: ind.libelle,
    disponible: true,
    valeur: ind.valeur,
    note: interpolateScore(anchors, ind.valeur),
    raison: null,
    message: null,
    sources: ind.sources,
  };
}

function axisMetrics(axis: HealthAxis, r: GrowIndicatorsResult): HealthMetric[] {
  const I = r.indicateurs;
  const S = GROW_SCORING_V1;
  switch (axis) {
    case 'finance':
      return [metric(I.marge_nette, S.marge_nette)];
    case 'tresorerie': {
      const runway = I.runway;
      // Burn nul : l'exploitation ne consomme pas la trésorerie — état favorable,
      // dit comme tel, et non un trou de données.
      if (!runway.disponible && runway.raison === 'PAS_DE_CONSOMMATION') {
        return [
          {
            code: 'runway',
            libelle: runway.libelle,
            disponible: true,
            valeur: null,
            note: 100,
            raison: runway.raison,
            message: runway.message,
            sources: runway.sources,
          },
        ];
      }
      return [metric(runway, S.runway)];
    }
    case 'ventes':
      // La croissance des ventes RUN prime ; à défaut, celle du CA réalisé BUILD.
      return [
        metric(
          I.croissance_ventes.disponible
            ? I.croissance_ventes
            : I.croissance_ca_realise.disponible
              ? I.croissance_ca_realise
              : I.croissance_ventes,
          S.croissance,
        ),
      ];
    case 'fidelisation':
      return [
        metric(I.clients_revenants, S.clients_revenants),
        metric(I.concentration_clients, S.concentration_clients),
      ];
  }
}

// ─── Risques et actions ──────────────────────────────────────────────────────

export type RiskSeverity = 'critique' | 'haute' | 'moyenne' | 'faible';
const SEVERITY_RANK: Readonly<Record<RiskSeverity, number>> = {
  critique: 0,
  haute: 1,
  moyenne: 2,
  faible: 3,
};

export interface HealthEvidence {
  /** Donnée lue (code d'indicateur ou fait). */
  donnee: string;
  valeur: string;
  seuil: string;
  regle: string;
}

export interface HealthRisk {
  code: string;
  gravite: RiskSeverity;
  titre: string;
  message: string;
  preuve: HealthEvidence;
  sources: readonly GrowSourceRef[];
}

export interface HealthAction {
  code: string;
  titre: string;
  detail: string;
  /** « Pourquoi ce message » : donnée, valeur, seuil, règle. */
  pourquoi: string;
  /** Variable actionnable nommée (docs/10). */
  variable: string;
  origine: 'risque' | 'donnees';
}

/** Seuils des règles de risque, versionnés (ADR-0032 § 4). */
export const GROW_RISK_RULES_V1 = Object.freeze({
  version: 'GROW_RISK_RULES_V1',
  runwayCritique: 3,
  runwayCourt: 6,
  pertesCritiques: -0.2,
  baisseVentes: -0.1,
  baisseVentesForte: -0.3,
  concentration: 0.5,
  concentrationForte: 0.7,
  fidelisationFaible: 0.2,
  joursSansCloture: 60,
});

interface RiskCandidate extends HealthRisk {
  order: number;
  action: Omit<HealthAction, 'pourquoi' | 'origine'>;
}

function evidenceText(e: HealthEvidence): string {
  return `${e.donnee} = ${e.valeur} ; seuil ${e.seuil} (règle ${e.regle}).`;
}

function detectRisks(r: GrowIndicatorsResult): RiskCandidate[] {
  const R = GROW_RISK_RULES_V1;
  const I = r.indicateurs;
  const out: RiskCandidate[] = [];
  const v = R.version;

  if (I.runway.disponible && I.runway.valeur < R.runwayCourt) {
    const critical = I.runway.valeur < R.runwayCritique;
    out.push({
      order: critical ? 0 : 1,
      code: critical ? 'RUNWAY_CRITIQUE' : 'RUNWAY_COURT',
      gravite: critical ? 'critique' : 'haute',
      titre: critical ? 'Trésorerie critique' : 'Autonomie de trésorerie courte',
      message: `Au rythme des derniers mois clôturés, la trésorerie déclarée couvre ${I.runway.valeur} mois de consommation.`,
      preuve: {
        donnee: 'runway',
        valeur: `${I.runway.valeur} mois`,
        seuil: `< ${critical ? R.runwayCritique : R.runwayCourt} mois`,
        regle: v,
      },
      sources: I.runway.sources,
      action: {
        code: 'PROLONGER_AUTONOMIE',
        titre: 'Prolonger votre autonomie',
        detail:
          'Passez en revue les charges opérationnelles du réalisé et les encaissements attendus ; si l’écart persiste, préparez un financement avant l’échéance.',
        variable: 'charges_operationnelles',
      },
    });
  }

  if (I.marge_nette.disponible && I.marge_nette.valeur < 0) {
    const critical = I.marge_nette.valeur < R.pertesCritiques;
    out.push({
      order: 2,
      code: 'PERTES',
      gravite: critical ? 'critique' : 'haute',
      titre: 'L’activité est en perte',
      message: `Le résultat net réalisé représente ${pct(I.marge_nette.valeur)} du chiffre d’affaires sur ${I.marge_nette.periode.libelle}.`,
      preuve: {
        donnee: 'marge_nette',
        valeur: pct(I.marge_nette.valeur),
        seuil: critical ? `< ${pct(R.pertesCritiques)}` : '< 0 %',
        regle: v,
      },
      sources: I.marge_nette.sources,
      action: {
        code: 'ANALYSER_PERTES',
        titre: 'Identifier ce qui creuse la perte',
        detail:
          'Comparez ligne par ligne le réalisé au plan validé (onglet Réalisé du projet) pour repérer les charges au-dessus du prévu et le chiffre d’affaires en dessous.',
        variable: 'resultat_net',
      },
    });
  }

  const growth = I.croissance_ventes.disponible
    ? I.croissance_ventes
    : I.croissance_ca_realise.disponible
      ? I.croissance_ca_realise
      : null;
  if (growth && growth.disponible && growth.valeur < R.baisseVentes) {
    const strong = growth.valeur < R.baisseVentesForte;
    out.push({
      order: 3,
      code: 'VENTES_EN_BAISSE',
      gravite: strong ? 'haute' : 'moyenne',
      titre: 'Ventes en baisse',
      message: `${growth.libelle} : ${pct(growth.valeur)} sur ${growth.periode.libelle}.`,
      preuve: {
        donnee: growth.code,
        valeur: pct(growth.valeur),
        seuil: `< ${pct(strong ? R.baisseVentesForte : R.baisseVentes)}`,
        regle: v,
      },
      sources: growth.sources,
      action: {
        code: 'ANALYSER_BAISSE_VENTES',
        titre: 'Comprendre la baisse des ventes',
        detail:
          'Repérez les clients et les articles dont les ventes ont reculé entre les deux périodes, puis recontactez les clients concernés.',
        variable: 'ca',
      },
    });
  }

  if (I.concentration_clients.disponible && I.concentration_clients.valeur > R.concentration) {
    const strong = I.concentration_clients.valeur > R.concentrationForte;
    out.push({
      order: 4,
      code: 'CONCENTRATION_CLIENT',
      gravite: strong ? 'haute' : 'moyenne',
      titre: 'Dépendance à un client',
      message: `Votre premier client pèse ${pct(I.concentration_clients.valeur)} des ventes sur ${I.concentration_clients.periode.libelle}.`,
      preuve: {
        donnee: 'concentration_clients',
        valeur: pct(I.concentration_clients.valeur),
        seuil: `> ${pct(strong ? R.concentrationForte : R.concentration)}`,
        regle: v,
      },
      sources: I.concentration_clients.sources,
      action: {
        code: 'DIVERSIFIER_CLIENTS',
        titre: 'Réduire la dépendance au premier client',
        detail:
          'Fixez-vous un objectif de nouveaux clients et suivez la part du premier client mois après mois.',
        variable: 'part_premier_client',
      },
    });
  }

  if (I.clients_revenants.disponible && I.clients_revenants.valeur < R.fidelisationFaible) {
    out.push({
      order: 5,
      code: 'FIDELISATION_FAIBLE',
      gravite: 'moyenne',
      titre: 'Peu de clients reviennent',
      message: `Les clients déjà servis représentent ${pct(I.clients_revenants.valeur)} des ventes des 6 derniers mois.`,
      preuve: {
        donnee: 'clients_revenants',
        valeur: pct(I.clients_revenants.valeur),
        seuil: `< ${pct(R.fidelisationFaible)}`,
        regle: v,
      },
      sources: I.clients_revenants.sources,
      action: {
        code: 'RELANCER_CLIENTS',
        titre: 'Relancer vos clients des mois précédents',
        detail:
          'Contactez les clients facturés il y a 6 à 12 mois qui n’ont rien acheté depuis, et demandez-leur ce qui les ferait revenir.',
        variable: 'clients_revenants',
      },
    });
  }

  const last = r.faits.derniereCloture;
  const lastDate = last ? kinshasaDateOf(last) : null;
  if (lastDate !== null) {
    const days = daysBetween(lastDate, r.asOf);
    if (days > R.joursSansCloture) {
      out.push({
        order: 6,
        code: 'REALISE_NON_A_JOUR',
        gravite: 'faible',
        titre: 'Réalisé non tenu à jour',
        message: `Aucun mois n’a été clôturé depuis ${days} jours : les indicateurs reflètent une situation ancienne.`,
        preuve: {
          donnee: 'derniere_cloture',
          valeur: `${days} jours`,
          seuil: `> ${R.joursSansCloture} jours`,
          regle: v,
        },
        sources: [],
        action: {
          code: 'CLOTURER_MOIS',
          titre: 'Clôturer les mois écoulés',
          detail:
            'Saisissez et clôturez le réalisé des mois écoulés : seule la clôture transforme une saisie en observation.',
          variable: 'actual_periods',
        },
      });
    }
  }

  return out.sort(
    (a, b) => SEVERITY_RANK[a.gravite] - SEVERITY_RANK[b.gravite] || a.order - b.order,
  );
}

/** Action de complétion des données associée à une raison d'indisponibilité. */
const DATA_ACTIONS: Readonly<Record<string, Omit<HealthAction, 'pourquoi' | 'origine'>>> = {
  AUCUN_PROJET: {
    code: 'CREER_PROJET',
    titre: 'Créer un projet et valider son plan',
    detail: 'Le réalisé, et donc la finance et la trésorerie, se suivent dans un projet validé.',
    variable: 'projet',
  },
  PROJET_DE_REFERENCE_A_CHOISIR: {
    code: 'CHOISIR_PROJET_REFERENCE',
    titre: 'Choisir le projet de référence',
    detail: 'Indiquez le projet dont le réalisé représente l’entreprise.',
    variable: 'projet_de_reference',
  },
  DEVISE_DE_REFERENCE_INDETERMINEE: {
    code: 'CHOISIR_PROJET_REFERENCE',
    titre: 'Choisir le projet de référence',
    detail: 'Sa devise servira de référence pour lire vos ventes.',
    variable: 'projet_de_reference',
  },
  MOIS_CLOTURES_INSUFFISANTS: {
    code: 'CLOTURER_MOIS',
    titre: 'Clôturer vos mois réalisés',
    detail: 'Trois mois clôturés au moins sont nécessaires aux moyennes.',
    variable: 'actual_periods',
  },
  BURN_INDISPONIBLE: {
    code: 'CLOTURER_MOIS',
    titre: 'Clôturer vos mois réalisés',
    detail: 'La consommation mensuelle se calcule sur trois mois clôturés.',
    variable: 'actual_periods',
  },
  TRESORERIE_NON_DECLAREE: {
    code: 'DECLARER_TRESORERIE',
    titre: 'Déclarer votre solde de trésorerie',
    detail: 'Indiquez le solde de vos comptes à une date : l’autonomie en dépend.',
    variable: 'solde_tresorerie',
  },
  SOLDE_PERIME: {
    code: 'METTRE_A_JOUR_TRESORERIE',
    titre: 'Mettre à jour votre solde de trésorerie',
    detail: 'Le solde déclaré est trop ancien pour calculer une autonomie fiable.',
    variable: 'solde_tresorerie',
  },
  AUCUNE_VENTE: {
    code: 'FACTURER_DANS_LALANDA',
    titre: 'Facturer vos ventes dans Lalanda',
    detail: 'Les indicateurs de ventes et de fidélisation se calculent sur vos factures.',
    variable: 'sales_invoices',
  },
};

// ─── Score ───────────────────────────────────────────────────────────────────

export type HealthGlobal =
  | { disponible: true; valeur: number; couverture: number }
  | {
      disponible: false;
      raison: 'DONNEES_INSUFFISANTES';
      message: string;
      couverture: number;
      manquants: readonly string[];
    };

export interface HealthScoreResult {
  growVersion: string;
  baremesVersion: string;
  ponderationsVersion: string;
  risquesVersion: string;
  etape: JourneyStage;
  groupe: JourneyStageGroup;
  score: HealthGlobal;
  axes: readonly HealthAxisView[];
  axesNonCouverts: typeof HEALTH_AXES_NOT_COVERED;
  /** Trois risques prioritaires au plus. */
  risques: readonly HealthRisk[];
  /** Trois actions au plus. */
  actions: readonly HealthAction[];
}

/** Score de santé (ADR-0032 § 4) à partir des indicateurs et de l'étape retenue. */
export function computeHealthScore(
  r: GrowIndicatorsResult,
  stage: JourneyStage,
): HealthScoreResult {
  const groupe = stageGroup(stage);
  const weights = GROW_WEIGHTS_V1.groupes[groupe];
  const axes: HealthAxisView[] = HEALTH_AXES.map((axe) => {
    const metriques = axisMetrics(axe, r);
    const notes = metriques.map((m) => m.note).filter((n): n is number => n !== null);
    return {
      axe,
      libelle: AXIS_LABELS[axe],
      poids: weights[axe],
      disponible: notes.length > 0,
      note: notes.length > 0 ? Math.round(notes.reduce((s, n) => s + n, 0) / notes.length) : null,
      metriques,
    };
  });

  const totalWeight = HEALTH_AXES.reduce((s, a) => s + weights[a], 0);
  const avail = axes.filter((a) => a.disponible && a.note !== null);
  const availWeight = avail.reduce((s, a) => s + a.poids, 0);
  const couverture = Math.round((availWeight / totalWeight) * 100) / 100;
  const manquants = axes.filter((a) => !a.disponible).map((a) => a.libelle);
  let score: HealthGlobal;
  if (
    avail.length < GROW_WEIGHTS_V1.axesMin ||
    availWeight / totalWeight < GROW_WEIGHTS_V1.couvertureMin
  ) {
    score = {
      disponible: false,
      raison: 'DONNEES_INSUFFISANTES',
      message: `Score non publié : ${avail.length} axe${avail.length > 1 ? 's' : ''} sur ${HEALTH_AXES.length} disponible${avail.length > 1 ? 's' : ''}, couvrant ${Math.round(couverture * 100)} % du poids (minimum ${GROW_WEIGHTS_V1.axesMin} axes et ${GROW_WEIGHTS_V1.couvertureMin * 100} %).`,
      couverture,
      manquants,
    };
  } else {
    const weighted = avail.reduce((s, a) => s + a.poids * a.note!, 0) / availWeight;
    score = { disponible: true, valeur: Math.round(weighted), couverture };
  }

  const candidates = detectRisks(r);
  const risques: HealthRisk[] = candidates
    .slice(0, 3)
    .map(({ order: _o, action: _a, ...risk }) => risk);

  const actions: HealthAction[] = [];
  const seen = new Set<string>();
  for (const c of candidates.slice(0, 3)) {
    if (seen.has(c.action.code)) continue;
    seen.add(c.action.code);
    actions.push({ ...c.action, pourquoi: evidenceText(c.preuve), origine: 'risque' });
  }
  // Puis la complétion des données des axes (et métriques) indisponibles.
  for (const axis of axes) {
    for (const m of axis.metriques) {
      if (actions.length >= 3) break;
      if (m.note !== null || m.raison === null) continue;
      const a = DATA_ACTIONS[m.raison];
      if (!a || seen.has(a.code)) continue;
      seen.add(a.code);
      actions.push({
        ...a,
        pourquoi: `${m.libelle} indisponible (${m.raison}) : l’axe « ${axis.libelle} » pèse ${axis.poids} % au stade « ${JOURNEY_STAGE_LABELS[stage]} ».`,
        origine: 'donnees',
      });
    }
  }

  return {
    growVersion: r.growVersion,
    baremesVersion: GROW_SCORING_V1.version,
    ponderationsVersion: GROW_WEIGHTS_V1.version,
    risquesVersion: GROW_RISK_RULES_V1.version,
    etape: stage,
    groupe,
    score,
    axes,
    axesNonCouverts: HEALTH_AXES_NOT_COVERED,
    risques,
    actions: actions.slice(0, 3),
  };
}
