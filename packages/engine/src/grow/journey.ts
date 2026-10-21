// ─────────────────────────────────────────────────────────────────────────────
// GROW — Startup Journey (ADR-0032 § 5)
//
// Huit étapes. L'étape SUGGÉRÉE est la plus avancée dont toutes les conditions
// sont remplies (règles explicites, table versionnée). L'utilisateur peut DÉCLARER
// son étape : la déclaration l'emporte, l'écart est montré, jamais corrigé.
// FUNDRAISING n'est jamais suggérée : c'est une intention, pas un fait mesurable.
// ─────────────────────────────────────────────────────────────────────────────

import type { GrowIndicatorsResult } from './types.js';

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

export function isJourneyStage(value: unknown): value is JourneyStage {
  return typeof value === 'string' && (JOURNEY_STAGES as readonly string[]).includes(value);
}

export const JOURNEY_STAGE_LABELS: Readonly<Record<JourneyStage, string>> = {
  IDEA: 'Idée',
  VALIDATION: 'Validation',
  MVP: 'Offre minimale (MVP)',
  FIRST_CUSTOMER: 'Premiers clients',
  PMF: 'Adéquation produit-marché',
  GROWTH: 'Croissance',
  SCALE: 'Passage à l’échelle',
  FUNDRAISING: 'Levée de fonds',
};

/** Groupe d'étapes, qui choisit les pondérations du score (ADR-0032 § 4). */
export type JourneyStageGroup = 'amorcage' | 'traction' | 'croissance';

export function stageGroup(stage: JourneyStage): JourneyStageGroup {
  switch (stage) {
    case 'IDEA':
    case 'VALIDATION':
    case 'MVP':
      return 'amorcage';
    case 'FIRST_CUSTOMER':
    case 'PMF':
      return 'traction';
    default:
      return 'croissance';
  }
}

/** Seuils des règles d'étape, versionnés (ADR-0032 § 5, décision ouverte n° 2). */
export const GROW_JOURNEY_RULES_V1 = Object.freeze({
  version: 'GROW_JOURNEY_RULES_V1',
  clientsPmf: 10,
  clientsRevenantsPmf: 0.3,
  croissanceGrowth: 0.2,
  clientsScale: 50,
  margeNetteScale: 0,
});

export type ConditionState = 'remplie' | 'non_remplie' | 'inconnue';

export interface JourneyCondition {
  code: string;
  libelle: string;
  etat: ConditionState;
  /** Valeur observée, en texte, ou `null` si inconnue. */
  valeur: string | null;
  seuil: string;
}

/** Données du parcours qui ne sont pas des indicateurs. */
export interface JourneyInputs {
  indicators: GrowIndicatorsResult;
  /** Projets de l'organisation. */
  projects: number;
  /** Plans financiers validés (toutes versions `approved`) de l'organisation. */
  approvedPlans: number;
  /** Articles actifs au catalogue RUN. */
  activeCatalogItems: number;
  declaredStage: JourneyStage | null;
  /** Points de checklist cochés à la main. */
  checklistDone: readonly string[];
}

function pct(v: number): string {
  return `${Math.round(v * 1000) / 10} %`;
}

function cmp(ok: boolean | null): ConditionState {
  return ok === null ? 'inconnue' : ok ? 'remplie' : 'non_remplie';
}

/** Conditions de chaque étape, évaluées sur les faits (table GROW_JOURNEY_RULES_V1). */
export function stageConditions(input: JourneyInputs): Record<JourneyStage, JourneyCondition[]> {
  const R = GROW_JOURNEY_RULES_V1;
  const { faits, indicateurs } = input.indicators;
  const salesReadable = faits.devise !== null;
  const clients = salesReadable ? faits.clientsDistincts12Mois : null;
  const ind = (code: 'clients_revenants' | 'croissance_ventes' | 'marge_nette'): number | null => {
    const i = indicateurs[code];
    return i.disponible ? i.valeur : null;
  };
  const rev = ind('clients_revenants');
  const growth = ind('croissance_ventes');
  const net = ind('marge_nette');

  const pmf: JourneyCondition[] = [
    {
      code: 'CLIENTS_12_MOIS',
      libelle: 'Clients distincts facturés sur 12 mois',
      etat: cmp(clients === null ? null : clients >= R.clientsPmf),
      valeur: clients === null ? null : String(clients),
      seuil: `≥ ${R.clientsPmf}`,
    },
    {
      code: 'CLIENTS_REVENANTS',
      libelle: 'Part des ventes aux clients revenants',
      etat: cmp(rev === null ? null : rev >= R.clientsRevenantsPmf),
      valeur: rev === null ? null : pct(rev),
      seuil: `≥ ${pct(R.clientsRevenantsPmf)}`,
    },
  ];
  const growthConds: JourneyCondition[] = [
    ...pmf,
    {
      code: 'CROISSANCE_VENTES',
      libelle: 'Croissance des ventes (3 mois contre 3 mois)',
      etat: cmp(growth === null ? null : growth >= R.croissanceGrowth),
      valeur: growth === null ? null : pct(growth),
      seuil: `≥ ${pct(R.croissanceGrowth)}`,
    },
  ];

  return {
    IDEA: [],
    VALIDATION: [
      {
        code: 'PLAN_VALIDE',
        libelle: 'Plan financier validé',
        etat: cmp(input.approvedPlans >= 1),
        valeur: String(input.approvedPlans),
        seuil: '≥ 1',
      },
    ],
    MVP: [
      {
        code: 'OFFRE_AU_CATALOGUE',
        libelle: 'Articles actifs au catalogue',
        etat: cmp(input.activeCatalogItems >= 1),
        valeur: String(input.activeCatalogItems),
        seuil: '≥ 1',
      },
    ],
    FIRST_CUSTOMER: [
      {
        code: 'PREMIERE_VENTE',
        libelle: 'Une vente facturée ou un mois clôturé avec du chiffre d’affaires',
        etat: cmp(faits.premiereVente !== null || faits.caRealisePositif),
        valeur:
          faits.premiereVente !== null
            ? `première vente : ${faits.premiereVente}`
            : faits.caRealisePositif
              ? 'CA réalisé clôturé > 0'
              : 'aucune',
        seuil: 'au moins une',
      },
    ],
    PMF: pmf,
    GROWTH: growthConds,
    SCALE: [
      ...growthConds,
      {
        code: 'CLIENTS_12_MOIS_SCALE',
        libelle: 'Clients distincts facturés sur 12 mois',
        etat: cmp(clients === null ? null : clients >= R.clientsScale),
        valeur: clients === null ? null : String(clients),
        seuil: `≥ ${R.clientsScale}`,
      },
      {
        code: 'MARGE_NETTE_POSITIVE',
        libelle: 'Marge nette réalisée',
        etat: cmp(net === null ? null : net >= R.margeNetteScale),
        valeur: net === null ? null : pct(net),
        seuil: '≥ 0 %',
      },
    ],
    FUNDRAISING: [
      {
        code: 'INTENTION_DECLAREE',
        libelle: 'Levée de fonds engagée (déclarée par vous)',
        etat: 'inconnue',
        valeur: null,
        seuil: 'déclaration',
      },
    ],
  };
}

// ─── Checklists ──────────────────────────────────────────────────────────────

type AutoCheck = (input: JourneyInputs) => boolean | null;

interface ChecklistItemDef {
  id: string;
  libelle: string;
  /** Vérification automatique depuis les données ; absente = point coché à la main. */
  auto?: AutoCheck;
}

const indAvailable =
  (...codes: ('burn_rate' | 'runway' | 'croissance_ventes' | 'clients_revenants')[]): AutoCheck =>
  (i) =>
    codes.every((c) => i.indicators.indicateurs[c].disponible);

/** Checklists par étape, versionnées (ADR-0032 § 5). Identifiants stables. */
export const GROW_CHECKLISTS_V1: Readonly<Record<JourneyStage, readonly ChecklistItemDef[]>> = {
  IDEA: [
    { id: 'idea.projet', libelle: 'Créer un premier projet', auto: (i) => i.projects >= 1 },
    { id: 'idea.canvas', libelle: 'Décrire votre modèle économique (Canvas)' },
    { id: 'idea.probleme', libelle: 'Formuler le problème client que vous résolvez' },
  ],
  VALIDATION: [
    {
      id: 'validation.plan',
      libelle: 'Valider un plan financier',
      auto: (i) => i.approvedPlans >= 1,
    },
    { id: 'validation.entretiens', libelle: 'Interroger au moins dix clients potentiels' },
    { id: 'validation.seuil', libelle: 'Vérifier le seuil de rentabilité du plan' },
  ],
  MVP: [
    {
      id: 'mvp.catalogue',
      libelle: 'Décrire votre offre au catalogue',
      auto: (i) => i.activeCatalogItems >= 1,
    },
    { id: 'mvp.prix', libelle: 'Fixer vos prix et les confronter au plan' },
    { id: 'mvp.essai', libelle: 'Faire tester l’offre par de premiers utilisateurs' },
  ],
  FIRST_CUSTOMER: [
    {
      id: 'first.facture',
      libelle: 'Émettre une première facture dans Lalanda',
      auto: (i) => i.indicators.faits.premiereVente !== null,
    },
    {
      id: 'first.cloture',
      libelle: 'Clôturer un premier mois de réalisé',
      auto: (i) => i.indicators.faits.moisClotures >= 1,
    },
    { id: 'first.retours', libelle: 'Recueillir les retours des premiers clients' },
  ],
  PMF: [
    {
      id: 'pmf.clients',
      libelle: `Atteindre ${GROW_JOURNEY_RULES_V1.clientsPmf} clients facturés sur 12 mois`,
      auto: (i) =>
        i.indicators.faits.devise === null
          ? null
          : i.indicators.faits.clientsDistincts12Mois >= GROW_JOURNEY_RULES_V1.clientsPmf,
    },
    {
      id: 'pmf.revenants',
      libelle: 'Mesurer la part des ventes aux clients revenants',
      auto: indAvailable('clients_revenants'),
    },
    { id: 'pmf.canal', libelle: 'Identifier votre principal canal d’acquisition' },
  ],
  GROWTH: [
    {
      id: 'growth.realise',
      libelle: 'Clôturer chaque mois le réalisé (3 mois au moins)',
      auto: (i) => i.indicators.faits.moisClotures >= 3,
    },
    {
      id: 'growth.tresorerie',
      libelle: 'Suivre votre autonomie de trésorerie',
      auto: indAvailable('runway'),
    },
    { id: 'growth.objectifs', libelle: 'Fixer des objectifs de croissance chiffrés' },
  ],
  SCALE: [
    {
      id: 'scale.rentable',
      libelle: 'Atteindre une marge nette positive',
      auto: (i) => {
        const m = i.indicators.indicateurs.marge_nette;
        return m.disponible ? m.valeur >= 0 : null;
      },
    },
    {
      id: 'scale.dependance',
      libelle: 'Ramener la part du premier client sous 50 %',
      auto: (i) => {
        const c = i.indicators.indicateurs.concentration_clients;
        return c.disponible ? c.valeur < 0.5 : null;
      },
    },
    { id: 'scale.processus', libelle: 'Documenter vos processus clés' },
  ],
  FUNDRAISING: [
    {
      id: 'fundraising.indicateurs',
      libelle: 'Disposer des indicateurs investisseurs (burn, croissance, clients revenants)',
      auto: indAvailable('burn_rate', 'croissance_ventes', 'clients_revenants'),
    },
    { id: 'fundraising.montant', libelle: 'Chiffrer le besoin de financement et son usage' },
    { id: 'fundraising.dossier', libelle: 'Préparer le dossier investisseur' },
  ],
};

/** Tous les identifiants de checklist, pour valider une saisie. */
export const GROW_CHECKLIST_IDS: readonly string[] = Object.freeze(
  JOURNEY_STAGES.flatMap((s) => GROW_CHECKLISTS_V1[s].map((i) => i.id)),
);

export interface ChecklistItem {
  id: string;
  libelle: string;
  mode: 'auto' | 'manuel';
  /** `null` : vérification automatique impossible faute de données. */
  fait: boolean | null;
}

export interface JourneyStageView {
  etape: JourneyStage;
  libelle: string;
  /** Toutes les conditions sont remplies. */
  atteinte: boolean;
  suggerable: boolean;
  conditions: readonly JourneyCondition[];
  checklist: readonly ChecklistItem[];
}

export interface JourneyResult {
  growVersion: string;
  reglesVersion: string;
  suggeree: JourneyStage;
  declaree: JourneyStage | null;
  /** Étape retenue : déclarée, à défaut suggérée. */
  retenue: JourneyStage;
  /** La déclaration diffère de la suggestion (montré, jamais corrigé). */
  ecart: boolean;
  etapes: readonly JourneyStageView[];
}

/** Étape suggérée, conditions et checklists (ADR-0032 § 5). */
export function suggestJourneyStage(input: JourneyInputs): JourneyResult {
  const conds = stageConditions(input);
  const done = new Set(input.checklistDone);
  let suggested: JourneyStage = 'IDEA';
  const etapes: JourneyStageView[] = JOURNEY_STAGES.map((etape) => {
    const conditions = conds[etape];
    const suggerable = etape !== 'FUNDRAISING';
    const atteinte = suggerable && conditions.every((c) => c.etat === 'remplie');
    if (atteinte) suggested = etape; // ordre croissant : la dernière atteinte gagne
    return {
      etape,
      libelle: JOURNEY_STAGE_LABELS[etape],
      atteinte,
      suggerable,
      conditions,
      checklist: GROW_CHECKLISTS_V1[etape].map((item) => {
        if (item.auto)
          return { id: item.id, libelle: item.libelle, mode: 'auto', fait: item.auto(input) };
        return { id: item.id, libelle: item.libelle, mode: 'manuel', fait: done.has(item.id) };
      }),
    };
  });
  const retenue = input.declaredStage ?? suggested;
  return {
    growVersion: input.indicators.growVersion,
    reglesVersion: GROW_JOURNEY_RULES_V1.version,
    suggeree: suggested,
    declaree: input.declaredStage,
    retenue,
    ecart: input.declaredStage !== null && input.declaredStage !== suggested,
    etapes,
  };
}
