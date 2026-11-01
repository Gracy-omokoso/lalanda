// ─────────────────────────────────────────────────────────────────────────────
// Objectifs et évaluations (ADR-0051 § 2.5, § 2.6, § 3.5, § 9)
//
// Le moteur COMPTE, il ne JUGE personne :
// - `reviewProgress` : décompte des statuts d'une campagne — jamais une note
//   agrégée, une moyenne, un classement ;
// - `checkReviewTemplate` : trame et échelle SAISIES par l'organisation
//   (Lalanda n'impose ni échelle ni critère) ;
// - `checkRating` : une valeur choisie par l'évaluateur est-elle dans l'échelle
//   de la section ? Aucune note n'est calculée (pas de moyenne pondérée) ;
// - `reviewTransition`, `goalTransition` : enchaînement des statuts ; la prise
//   de connaissance n'est PAS un accord ; un objectif n'est jamais `agreed` par
//   le collaborateur seul (contrôle des personnes : `permissions.ts`, lot H8).
// Aucun effet automatique d'une évaluation (§ 2.6).
// ─────────────────────────────────────────────────────────────────────────────

import { checkId } from './days.js';
import { HR_VERSION } from './types.js';

export const REVIEW_STATUSES = [
  'not_started',
  'self_submitted',
  'manager_submitted',
  'shared',
  'acknowledged',
  'closed',
  'cancelled',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const GOAL_STATUSES = [
  'proposed',
  'agreed',
  'achieved',
  'partially_achieved',
  'not_achieved',
  'dropped',
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Bornes de la trame (ADR-0051 § 2.6). */
export const REVIEW_TEMPLATE_SECTIONS_BOUNDS = { min: 1, max: 20 } as const;

export type ReviewSectionKind = 'text' | 'scale' | 'goals';

export interface ReviewSectionInput {
  id: string;
  title: string;
  kind: ReviewSectionKind;
  /** Requise pour `scale`, absente sinon : saisie par l'organisation. */
  scale?: { min: number; max: number; labels?: readonly string[] } | null;
}

export type ReviewTemplateIssueCode =
  | 'REVIEW_TEMPLATE_SECTION_COUNT'
  | 'REVIEW_TEMPLATE_SECTION_ID_DUPLICATE'
  | 'REVIEW_TEMPLATE_SECTION_TITLE'
  | 'REVIEW_TEMPLATE_SECTION_KIND'
  | 'REVIEW_TEMPLATE_SCALE_MISSING'
  | 'REVIEW_TEMPLATE_SCALE_UNEXPECTED'
  | 'REVIEW_TEMPLATE_SCALE_INVALID'
  | 'REVIEW_TEMPLATE_SCALE_LABELS';

export interface ReviewTemplateCheck {
  version: string;
  ok: boolean;
  issues: { sectionIndex: number | null; code: ReviewTemplateIssueCode }[];
}

export interface ReviewProgressResult {
  version: string;
  /** Évaluations non annulées. */
  total: number;
  cancelled: number;
  counts: Record<ReviewStatus, number>;
  /** Auto-évaluation attendue (`not_started`, campagne avec auto-évaluation). */
  awaitingSelf: number;
  /** Rédaction de l'évaluateur attendue. */
  awaitingManager: number;
  /** Partagées, prise de connaissance attendue. */
  awaitingAcknowledgement: number;
  /** Prises de connaissance, clôture RH attendue. */
  awaitingClose: number;
  closed: number;
}

// ─── Trame et notes choisies ─────────────────────────────────────────────────

/** Bornes d'une échelle saisie : entiers de 0 à 100, au moins deux valeurs. */
export const REVIEW_SCALE_BOUNDS = { min: 0, max: 100 } as const;

/** Contrôle d'une trame saisie par l'organisation (ADR-0051 § 2.6). */
export function checkReviewTemplate(template: {
  sections: readonly ReviewSectionInput[];
}): ReviewTemplateCheck {
  const issues: ReviewTemplateCheck['issues'] = [];
  const n = template.sections.length;
  if (n < REVIEW_TEMPLATE_SECTIONS_BOUNDS.min || n > REVIEW_TEMPLATE_SECTIONS_BOUNDS.max) {
    issues.push({ sectionIndex: null, code: 'REVIEW_TEMPLATE_SECTION_COUNT' });
  }
  const ids = new Set<string>();
  for (const [i, s] of template.sections.entries()) {
    const push = (code: ReviewTemplateIssueCode): void => {
      issues.push({ sectionIndex: i, code });
    };
    if (typeof s.id !== 'string' || s.id === '' || ids.has(s.id)) {
      push('REVIEW_TEMPLATE_SECTION_ID_DUPLICATE');
    } else ids.add(s.id);
    if (typeof s.title !== 'string' || s.title.trim() === '' || s.title.length > 200) {
      push('REVIEW_TEMPLATE_SECTION_TITLE');
    }
    if (s.kind !== 'text' && s.kind !== 'scale' && s.kind !== 'goals') {
      push('REVIEW_TEMPLATE_SECTION_KIND');
      continue;
    }
    const scale = s.scale ?? null;
    if (s.kind !== 'scale') {
      if (scale !== null) push('REVIEW_TEMPLATE_SCALE_UNEXPECTED');
      continue;
    }
    if (scale === null) {
      push('REVIEW_TEMPLATE_SCALE_MISSING');
      continue;
    }
    const intIn = (v: unknown): boolean =>
      typeof v === 'number' &&
      Number.isInteger(v) &&
      v >= REVIEW_SCALE_BOUNDS.min &&
      v <= REVIEW_SCALE_BOUNDS.max;
    if (!intIn(scale.min) || !intIn(scale.max) || scale.min >= scale.max) {
      push('REVIEW_TEMPLATE_SCALE_INVALID');
      continue;
    }
    const labels = scale.labels ?? [];
    if (
      labels.length > 0 &&
      (labels.length !== scale.max - scale.min + 1 ||
        labels.some((l) => typeof l !== 'string' || l.trim() === '' || l.length > 60))
    ) {
      push('REVIEW_TEMPLATE_SCALE_LABELS');
    }
  }
  return { version: HR_VERSION, ok: issues.length === 0, issues };
}

/**
 * Valeur choisie par l'évaluateur pour une section `scale` : entier de
 * l'échelle de la section. Rend `true`/`false`, ne calcule rien.
 */
export function checkRating(section: ReviewSectionInput, value: unknown): boolean {
  if (section.kind !== 'scale' || section.scale === null || section.scale === undefined) {
    return false;
  }
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= section.scale.min &&
    value <= section.scale.max
  );
}

// ─── Statuts ─────────────────────────────────────────────────────────────────

const REVIEW_NEXT: Record<ReviewStatus, readonly ReviewStatus[]> = {
  not_started: ['self_submitted', 'manager_submitted', 'cancelled'],
  self_submitted: ['manager_submitted', 'cancelled'],
  manager_submitted: ['shared', 'cancelled'],
  shared: ['acknowledged', 'closed', 'cancelled'],
  acknowledged: ['closed', 'cancelled'],
  closed: [],
  cancelled: [],
};

/**
 * Passage de statut d'une évaluation (ADR-0051 § 2.6, § 3.5). Avec
 * auto-évaluation, l'évaluateur ne soumet qu'après elle ; la RH peut clore une
 * évaluation partagée non signée (mention « non signée », jamais un
 * consentement présumé : `unsigned` vrai).
 */
export function reviewTransition(
  from: ReviewStatus,
  to: ReviewStatus,
  cycle: { includesSelfAssessment: boolean },
): { version: string; ok: boolean; unsigned: boolean } {
  if (!REVIEW_STATUSES.includes(from) || !REVIEW_STATUSES.includes(to)) {
    throw new RangeError(`Statut d’évaluation inconnu ${JSON.stringify([from, to])}`);
  }
  let ok = REVIEW_NEXT[from].includes(to);
  if (from === 'not_started' && to === 'self_submitted' && !cycle.includesSelfAssessment)
    ok = false;
  if (from === 'not_started' && to === 'manager_submitted' && cycle.includesSelfAssessment) {
    ok = false;
  }
  return { version: HR_VERSION, ok, unsigned: ok && from === 'shared' && to === 'closed' };
}

const GOAL_NEXT: Record<GoalStatus, readonly GoalStatus[]> = {
  proposed: ['agreed', 'dropped'],
  agreed: ['achieved', 'partially_achieved', 'not_achieved', 'dropped'],
  achieved: [],
  partially_achieved: [],
  not_achieved: [],
  dropped: [],
};

/** Passage de statut d'un objectif (ADR-0051 § 2.5) ; les statuts finaux sont posés par une personne. */
export function goalTransition(from: GoalStatus, to: GoalStatus): { version: string; ok: boolean } {
  if (!GOAL_STATUSES.includes(from) || !GOAL_STATUSES.includes(to)) {
    throw new RangeError(`Statut d’objectif inconnu ${JSON.stringify([from, to])}`);
  }
  return { version: HR_VERSION, ok: GOAL_NEXT[from].includes(to) };
}

// ─── Avancement d'une campagne ───────────────────────────────────────────────

/**
 * Décompte des statuts d'une campagne (ADR-0051 § 9). Ne lit que le statut :
 * aucun contenu, aucune note n'entre ici.
 */
export function reviewProgress(
  reviews: readonly { id: string; status: ReviewStatus }[],
  cycle: { includesSelfAssessment: boolean },
): ReviewProgressResult {
  const counts = Object.fromEntries(REVIEW_STATUSES.map((s) => [s, 0])) as Record<
    ReviewStatus,
    number
  >;
  const ids = new Set<string>();
  for (const [i, r] of reviews.entries()) {
    const what = `Évaluation n° ${i + 1}`;
    checkId(r.id, what);
    if (ids.has(r.id)) throw new RangeError(`${what} : identifiant en double`);
    ids.add(r.id);
    if (!REVIEW_STATUSES.includes(r.status)) {
      throw new RangeError(`${what} : statut inconnu ${JSON.stringify(r.status)}`);
    }
    counts[r.status] += 1;
  }
  return {
    version: HR_VERSION,
    total: reviews.length - counts.cancelled,
    cancelled: counts.cancelled,
    counts,
    awaitingSelf: cycle.includesSelfAssessment ? counts.not_started : 0,
    awaitingManager:
      counts.self_submitted + (cycle.includesSelfAssessment ? 0 : counts.not_started),
    awaitingAcknowledgement: counts.shared,
    awaitingClose: counts.acknowledged,
    closed: counts.closed,
  };
}
