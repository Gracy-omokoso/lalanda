// Objectifs individuels et évaluations (ADR-0051 § 1, § 2.5, § 2.6, § 3.5, § 4, § 6.3).
// ADR-0051 — H8.
//
// Libellé d'interface ↔ code : « Objectif individuel » = `Goal` (collection `hr_goals`,
// distincte des objectifs financiers du plan), « Campagne d'évaluation » = `ReviewCycle`,
// « Évaluation » = `Review`.
//
// Données parmi les plus sensibles du dossier : le contenu d'une évaluation est CHIFFRÉ par
// section, lu par `POST /hr/reviews/:id/reveal` (audit strict, 30 par heure) ; il n'apparaît
// jamais dans une liste, un journal, une notification, le brief ni l'IA. Toute note est
// POSÉE PAR UNE PERSONNE : aucune moyenne, aucun avancement calculé, aucun effet
// automatique sur la rémunération, le contrat ou une sortie. Lalanda ne fournit ni échelle
// ni critère (décision ouverte n° 11). Désactivé par défaut.

import { z } from 'zod';

import { HrCalendarDay, HrId, hrFr, hrIssue, hrOptionalText, hrRequiredText } from './common.js';

// ── Unions fermées ──────────────────────────────────────────────────────────

/** `agreed` jamais posé par le collaborateur pour lui-même ; statut final par une personne. */
export const GOAL_STATUSES = [
  'proposed',
  'agreed',
  'achieved',
  'partially_achieved',
  'not_achieved',
  'dropped',
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Statuts finaux d'un objectif, posés par le manager avec un commentaire. */
export const GOAL_FINAL_STATUSES = [
  'achieved',
  'partially_achieved',
  'not_achieved',
  'dropped',
] as const;
export type GoalFinalStatus = (typeof GOAL_FINAL_STATUSES)[number];

/** Seule valeur en H15 (§ 2.5) : soi, chaîne de managers, `performance.read`. */
export const GOAL_VISIBILITIES = ['private'] as const;
export type GoalVisibility = (typeof GOAL_VISIBILITIES)[number];

export const REVIEW_CYCLE_STATUSES = ['draft', 'open', 'closed'] as const;
export type ReviewCycleStatus = (typeof REVIEW_CYCLE_STATUSES)[number];

/** Nature d'une section de trame, saisie par l'organisation. */
export const REVIEW_SECTION_KINDS = ['text', 'scale', 'goals'] as const;
export type ReviewSectionKind = (typeof REVIEW_SECTION_KINDS)[number];

/**
 * Statut d'une évaluation (§ 2.6). `acknowledged` = le collaborateur a PRIS CONNAISSANCE ;
 * ce n'est pas un accord (J6).
 */
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

/**
 * Sections CHIFFRÉES (AES-256-GCM sous `MASTER_KEYRING`, emplacement `org:hr_reviews`,
 * AAD = `organizationId + reviewId + section`). `hrNote` : `performance.read` seul.
 */
export const REVIEW_SECTIONS = [
  'selfAssessment',
  'managerAssessment',
  'employeeComment',
  'hrNote',
] as const;
export type ReviewSection = (typeof REVIEW_SECTIONS)[number];

/** Emplacement de clé des évaluations (motif d'ADR-0045 § 2.4). */
export const HR_REVIEWS_KEY_SLOT = 'org:hr_reviews' as const;

/**
 * Modèle de trame proposé : des TITRES seulement, sans échelle ni critère (§ 2.6).
 */
export const HR_DEFAULT_REVIEW_TEMPLATE_TITLES = Object.freeze([
  'Bilan de la période',
  'Objectifs',
  'Besoins de formation',
  'Commentaire du collaborateur',
]);

/** Rappels affichés par l'écran d'évaluation (§ 10). */
export const HR_REVIEW_NO_AUTOMATIC_EFFECT_NOTICE =
  'Aucune note n’est calculée ; l’évaluation n’a aucun effet automatique.';
export const HR_REVIEW_ACKNOWLEDGEMENT_NOTICE = 'Signer vaut prise de connaissance, pas accord.';

// ── Bornes et réglages ──────────────────────────────────────────────────────

export const PERFORMANCE_LIMITS = Object.freeze({
  goalTitle: 200,
  goalDescription: 2_000,
  goalMeasure: 300,
  goalTargetText: 200,
  goalUnit: 20,
  goalWeightMax: 100,
  goalComment: 2_000,
  progressNote: 1_000,
  progressMax: 200,
  cycleLabel: 120,
  sectionsMin: 1,
  sectionsMax: 20,
  sectionId: 40,
  sectionTitle: 120,
  scaleLabelsMax: 10,
  scaleLabel: 60,
  scaleMin: 0,
  scaleMax: 100,
  cycleEmployeesMax: 500,
  sectionTextMax: 20_000,
  reassignReason: 500,
  revealsPerHour: 30,
  managerChainDepthMin: 1,
  managerChainDepthMax: 2,
  retentionYearsMax: 50,
});

/**
 * Réglages `hr_settings.performance` par défaut (§ 2.7, décisions ouvertes n° 11 et 12) :
 * éteints ; le manager direct seul voit l'évaluation.
 */
export const HR_PERFORMANCE_SETTINGS_DEFAULTS = Object.freeze({
  enabled: false,
  managerChainDepth: 1,
});

/** Conservation des évaluations après la sortie : non fixée, aucune purge (J4). */
export const HR_REVIEWS_RETENTION_DEFAULT: number | null = null;

// ── Codes ───────────────────────────────────────────────────────────────────

export const HR_PERFORMANCE_ERROR_CODES = [
  'HR_FEATURE_DISABLED',
  'HR_REVEAL_RATE_LIMITED',
  'SELF_APPROVAL_FORBIDDEN',
  'REVIEW_CLOSE_FORBIDDEN',
  'REVIEW_SECTION_NOT_YOURS',
  'REVIEW_WRONG_STATUS',
  'REVIEWER_IS_EMPLOYEE',
  'STALE_REVISION',
] as const;
export type HrPerformanceErrorCode = (typeof HR_PERFORMANCE_ERROR_CODES)[number];

/** Audit : `reveal` STRICT (écrit avant la réponse) ; aucune valeur dans un événement. */
export const HR_PERFORMANCE_AUDIT_EVENTS = [
  'hr.review.revealed',
  'hr.review.changed',
  'hr.review.reassigned',
  'hr.review.closed',
] as const;
export type HrPerformanceAuditEvent = (typeof HR_PERFORMANCE_AUDIT_EVENTS)[number];

// ── Corps : objectifs ───────────────────────────────────────────────────────

const period = z
  .object({ from: HrCalendarDay, to: HrCalendarDay })
  .strict()
  .superRefine((p, ctx) => {
    if (p.to < p.from) hrIssue(ctx, 'PERIOD_END_BEFORE_START', 'La fin précède le début.', ['to']);
  });

export const GoalTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('text'),
      value: hrRequiredText(PERFORMANCE_LIMITS.goalTargetText, 'Cible'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('number'),
      value: z.string().regex(/^-?\d{1,13}(\.\d{1,4})?$/, {
        message: 'Nombre attendu sous forme de chaîne.',
      }),
      unit: hrOptionalText(PERFORMANCE_LIMITS.goalUnit).optional(),
    })
    .strict(),
]);
export type GoalTargetInput = z.output<typeof GoalTargetSchema>;

/** `POST /hr/goals` — le collaborateur propose (pour soi) ; le manager ou les RH posent. */
export const CreateGoalBody = z
  .object({
    employeeId: HrId.optional(),
    period,
    reviewCycleId: HrId.nullable().optional(),
    title: hrRequiredText(PERFORMANCE_LIMITS.goalTitle, 'Titre'),
    description: hrOptionalText(PERFORMANCE_LIMITS.goalDescription).optional(),
    measure: hrOptionalText(PERFORMANCE_LIMITS.goalMeasure).optional(),
    target: GoalTargetSchema.nullable().optional(),
    weight: z.number().int().min(0).max(PERFORMANCE_LIMITS.goalWeightMax).nullable().optional(),
    workProjectId: HrId.nullable().optional(),
  })
  .strict();
export type CreateGoalBody = z.output<typeof CreateGoalBody>;

/** `PUT /hr/goals/:id`. Aucune somme de poids imposée. */
export const UpdateGoalBody = CreateGoalBody.omit({ employeeId: true })
  .partial()
  .extend({ expectedRevision: z.number().int().min(1) })
  .strict();
export type UpdateGoalBody = z.output<typeof UpdateGoalBody>;

/** `POST /hr/goals/:id/close` — statut final posé par une personne, commentaire exigé. */
export const CloseGoalBody = z
  .object({
    expectedRevision: z.number().int().min(1),
    status: z.enum(GOAL_FINAL_STATUSES, hrFr('Statut final attendu.')),
    comment: hrRequiredText(PERFORMANCE_LIMITS.goalComment, 'Commentaire'),
  })
  .strict();
export type CloseGoalBody = z.output<typeof CloseGoalBody>;

/** `POST /hr/goals/:id/progress` — déclaration, ajout seul ; aucun avancement calculé. */
export const GoalProgressBody = z
  .object({
    percent: z.number().int().min(0).max(100).nullable().optional(),
    note: hrRequiredText(PERFORMANCE_LIMITS.progressNote, 'Note'),
  })
  .strict();
export type GoalProgressBody = z.output<typeof GoalProgressBody>;

// ── Corps : campagnes et évaluations ────────────────────────────────────────

export const ReviewSectionTemplateSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, {
      message: 'Identifiant : minuscules, chiffres et tirets bas.',
    }),
    title: hrRequiredText(PERFORMANCE_LIMITS.sectionTitle, 'Titre'),
    kind: z.enum(REVIEW_SECTION_KINDS, hrFr('Nature attendue : text, scale ou goals.')),
    scale: z
      .object({
        min: z.number().int().min(PERFORMANCE_LIMITS.scaleMin).max(PERFORMANCE_LIMITS.scaleMax),
        max: z.number().int().min(PERFORMANCE_LIMITS.scaleMin).max(PERFORMANCE_LIMITS.scaleMax),
        labels: z
          .array(hrRequiredText(PERFORMANCE_LIMITS.scaleLabel, 'Libellé'))
          .max(PERFORMANCE_LIMITS.scaleLabelsMax),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.kind === 'scale' && s.scale === undefined) {
      hrIssue(ctx, 'REVIEW_SCALE_REQUIRED', 'Une section notée porte son échelle.', ['scale']);
    }
    if (s.kind !== 'scale' && s.scale !== undefined) {
      hrIssue(ctx, 'REVIEW_SCALE_UNEXPECTED', 'Seule une section notée porte une échelle.', [
        'scale',
      ]);
    }
    if (s.scale !== undefined && s.scale.max <= s.scale.min) {
      hrIssue(ctx, 'REVIEW_SCALE_INVALID', 'Le maximum dépasse le minimum.', ['scale', 'max']);
    }
  });
export type ReviewSectionTemplateInput = z.output<typeof ReviewSectionTemplateSchema>;

/** `POST /hr/review-cycles` — `performance.read` + `hr.manage`. */
export const CreateReviewCycleBody = z
  .object({
    label: hrRequiredText(PERFORMANCE_LIMITS.cycleLabel, 'Libellé'),
    period,
    template: z
      .object({
        sections: z
          .array(ReviewSectionTemplateSchema)
          .min(PERFORMANCE_LIMITS.sectionsMin, { message: 'Au moins une section.' })
          .max(PERFORMANCE_LIMITS.sectionsMax, {
            message: `${PERFORMANCE_LIMITS.sectionsMax} sections au plus.`,
          })
          .superRefine((sections, ctx) => {
            const ids = new Set<string>();
            sections.forEach((s, i) => {
              if (ids.has(s.id)) {
                hrIssue(ctx, 'REVIEW_SECTION_DUPLICATE', 'Identifiant de section en double.', [
                  i,
                  'id',
                ]);
              }
              ids.add(s.id);
            });
          }),
      })
      .strict(),
    includesSelfAssessment: z.boolean().default(true),
    openOn: HrCalendarDay,
    dueOn: HrCalendarDay,
    employeeIds: z.array(HrId).max(PERFORMANCE_LIMITS.cycleEmployeesMax),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.dueOn < b.openOn) {
      hrIssue(ctx, 'PERIOD_END_BEFORE_START', 'L’échéance suit l’ouverture.', ['dueOn']);
    }
  });
export type CreateReviewCycleBody = z.output<typeof CreateReviewCycleBody>;

/**
 * `PUT /hr/reviews/:id/sections/:section` — contenu chiffré par l'API. Les notes sont
 * CHOISIES par l'évaluateur (`ratings`), `overall` facultatif, jamais calculé.
 */
export const WriteReviewSectionBody = z
  .object({
    expectedRevision: z.number().int().min(1),
    answers: z.record(
      z.string().max(PERFORMANCE_LIMITS.sectionId),
      z.string().max(PERFORMANCE_LIMITS.sectionTextMax),
    ),
    ratings: z.record(z.string().max(PERFORMANCE_LIMITS.sectionId), z.number().int()).optional(),
    overall: z.number().int().nullable().optional(),
  })
  .strict();
export type WriteReviewSectionBody = z.output<typeof WriteReviewSectionBody>;

/** `POST /hr/reviews/:id/reveal` — sections demandées (audit strict, sans valeur). */
export const RevealReviewBody = z
  .object({
    sections: z
      .array(z.enum(REVIEW_SECTIONS))
      .min(1, { message: 'Au moins une section.' })
      .max(REVIEW_SECTIONS.length),
  })
  .strict();
export type RevealReviewBody = z.output<typeof RevealReviewBody>;

/** `POST /hr/reviews/:id/reassign` — `hr.manage` + `performance.read`, motif, audit. */
export const ReassignReviewBody = z
  .object({
    expectedRevision: z.number().int().min(1),
    reviewerUserId: z.string().min(1).max(64),
    reason: hrRequiredText(PERFORMANCE_LIMITS.reassignReason, 'Motif'),
  })
  .strict();
export type ReassignReviewBody = z.output<typeof ReassignReviewBody>;

/** `GET /hr/reviews` — STATUTS seulement, jamais de contenu. */
export const ListReviewsQuery = z
  .object({
    cycleId: HrId.optional(),
    mine: z.enum(['true', 'false']).optional(),
    toWrite: z.enum(['true', 'false']).optional(),
  })
  .strict();
export type ListReviewsQuery = z.output<typeof ListReviewsQuery>;

/** Vue de liste d'une évaluation : aucun champ de contenu, aucune note. */
export interface ReviewListItemView {
  readonly id: string;
  readonly cycleId: string;
  readonly employeeId: string;
  readonly reviewerUserId: string;
  readonly status: ReviewStatus;
  readonly revision: number;
}
