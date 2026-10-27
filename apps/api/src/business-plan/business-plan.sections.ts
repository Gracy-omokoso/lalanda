// Les neuf sections du business plan narratif (ADR-0037 § 1).
//
// Liste FERMÉE et ordonnée : l'identifiant est stable (stockage, API, sources de
// l'IA), le titre et les questions guides sont de la présentation. Les feuilles
// du moteur nommées ici sont INSÉRÉES telles quelles par l'assemblage — aucun
// texte ne les recopie.

import type { CanvasBlockId } from '../canvas/canvas.schema.js';

export const BUSINESS_PLAN_SECTION_IDS = [
  'resume',
  'probleme_solution',
  'marche_concurrence',
  'modele_economique',
  'strategie_commerciale',
  'organisation_equipe',
  'plan_financier',
  'besoins_financement',
  'risques',
] as const;

export type BusinessPlanSectionId = (typeof BUSINESS_PLAN_SECTION_IDS)[number];

export function isSectionId(value: unknown): value is BusinessPlanSectionId {
  return (
    typeof value === 'string' && (BUSINESS_PLAN_SECTION_IDS as readonly string[]).includes(value)
  );
}

export interface SectionSpec {
  id: BusinessPlanSectionId;
  title: string;
  /** Questions affichées à l'écran et transmises à l'IA. */
  questions: readonly string[];
  /** Blocs du Canvas qui nourrissent la section (docs/05). */
  canvasBlocks: readonly CanvasBlockId[];
  /** Feuilles du moteur insérées sous le texte, dans cet ordre. */
  engineSheets: readonly string[];
  /** La section affiche les hypothèses du plan (titrées comme telles). */
  showsHypotheses: boolean;
}

export const BUSINESS_PLAN_SECTIONS: readonly SectionSpec[] = [
  {
    id: 'resume',
    title: 'Résumé',
    questions: [
      'Que fait l’entreprise, pour qui, et pourquoi maintenant ?',
      'Quel est le besoin de financement et à quoi servira-t-il ?',
    ],
    canvasBlocks: ['proposition_valeur', 'segments_clients', 'revenus'],
    engineSheets: [],
    showsHypotheses: false,
  },
  {
    id: 'probleme_solution',
    title: 'Problème et solution',
    questions: [
      'Quel problème vos clients rencontrent-ils aujourd’hui ?',
      'Comment votre offre le résout-elle, mieux que les solutions actuelles ?',
    ],
    canvasBlocks: ['segments_clients', 'proposition_valeur'],
    engineSheets: [],
    showsHypotheses: false,
  },
  {
    id: 'marche_concurrence',
    title: 'Marché et concurrence',
    questions: [
      'Qui sont vos clients cibles et où se trouvent-ils ?',
      'Qui sont vos concurrents directs et indirects, et qu’est-ce qui vous distingue ?',
    ],
    canvasBlocks: ['segments_clients', 'proposition_valeur', 'canaux'],
    engineSheets: [],
    showsHypotheses: false,
  },
  {
    id: 'modele_economique',
    title: 'Modèle économique',
    questions: [
      'Comment gagnez-vous de l’argent (prix, fréquence d’achat) ?',
      'Quels sont vos principaux coûts et ressources ?',
    ],
    canvasBlocks: ['revenus', 'couts', 'ressources_cles', 'activites_cles', 'partenaires_cles'],
    engineSheets: [],
    showsHypotheses: false,
  },
  {
    id: 'strategie_commerciale',
    title: 'Stratégie commerciale',
    questions: [
      'Comment allez-vous trouver et convaincre vos premiers clients ?',
      'Comment les fidéliserez-vous ?',
    ],
    canvasBlocks: ['canaux', 'relations_clients', 'segments_clients'],
    engineSheets: [],
    showsHypotheses: false,
  },
  {
    id: 'organisation_equipe',
    title: 'Organisation et équipe',
    questions: [
      'Qui porte le projet et quelles compétences apporte chaque personne ?',
      'Quels recrutements ou partenaires sont prévus ?',
    ],
    canvasBlocks: ['ressources_cles', 'activites_cles', 'partenaires_cles'],
    engineSheets: [],
    showsHypotheses: false,
  },
  {
    id: 'plan_financier',
    title: 'Plan financier',
    questions: [
      'Quelles hypothèses principales fondent vos prévisions ?',
      'Comment lisez-vous la rentabilité et les ratios du plan ?',
    ],
    canvasBlocks: ['revenus', 'couts'],
    engineSheets: ['projection', 'seuil_rentabilite', 'ratios'],
    showsHypotheses: true,
  },
  {
    id: 'besoins_financement',
    title: 'Besoins de financement',
    questions: [
      'Combien demandez-vous, sous quelle forme (apport, emprunt, subvention) ?',
      'À quoi servira chaque montant ?',
    ],
    canvasBlocks: ['ressources_cles', 'couts'],
    engineSheets: ['plan_financement', 'financement'],
    showsHypotheses: false,
  },
  {
    id: 'risques',
    title: 'Risques',
    questions: [
      'Quels sont les principaux risques (marché, exécution, financement) ?',
      'Comment comptez-vous les réduire ?',
    ],
    canvasBlocks: ['partenaires_cles', 'couts'],
    engineSheets: ['ratios'],
    showsHypotheses: false,
  },
];

export function sectionSpec(id: BusinessPlanSectionId): SectionSpec {
  const spec = BUSINESS_PLAN_SECTIONS.find((s) => s.id === id);
  if (!spec) throw new Error(`section inconnue : ${id}`);
  return spec;
}

/** Feuilles du moteur transmises à l'IA comme résultats (synthèse, pas le détail mensuel). */
export const AI_ENGINE_SHEETS: readonly string[] = [
  'projection',
  'seuil_rentabilite',
  'ratios',
  'plan_financement',
  'financement',
];

/** Longueur maximale d'un texte de section (saisi ou proposé). */
export const MAX_SECTION_TEXT = 12_000;
/** Longueur maximale d'une proposition de l'IA. */
export const MAX_AI_DRAFT = 2_500;
/** Longueur maximale des réponses de l'utilisateur transmises à l'IA. */
export const MAX_AI_NOTES = 2_000;
