// Plan de projet — format COMMUN de l'import de fichier (ADR-0062) et de la
// construction par l'IA (ADR-0063).
//
// Un « plan » est une liste de tâches à créer, chacune désignée par une
// référence LOCALE (`ref` : « L5 » pour la ligne 5 d'un fichier, « T3 » pour une
// tâche proposée par l'IA). Les dépendances (`dependsOn`) et les sous-tâches
// (`parentRef`) pointent vers ces références : aucun identifiant de base n'existe
// encore. Le serveur crée tout par UN SEUL chemin (`WorkPlanBuilder`), qui passe
// par les services existants du module (projets, tâches, réglages).
//
// Ce fichier est PUR : schémas zod, bornes et contrôles de structure (références
// uniques, dépendances connues, un seul niveau de sous-tâches, jalons datés,
// aucun cycle). Ce qui exige la base (membre éligible, colonnes, étiquettes) est
// vérifié par le serveur. Aucune règle financière ; aucun montant.

import { z } from 'zod';

import { WORK_LIMITS, WORK_PRIORITIES, WORK_PROJECT_KINDS } from './constants.js';
import { addDays, detectCycle, isCalendarDay } from './scheduling.js';
import { WorkDay, WorkId } from './schemas.js';

// ── Bornes ──────────────────────────────────────────────────────────────────

/** Bornes de l'import et de la construction par l'IA (techniques, pas des droits d'offre). */
export const WORK_PLAN_LIMITS = {
  /** Fichier importé : 2 Mo au plus (ADR-0062). */
  importFileMaxBytes: 2 * 1024 * 1024,
  /** Lignes de tâches d'un fichier : 2 000 au plus. */
  importRowsMax: 2_000,
  /** Tâches d'un plan envoyé en JSON (relecture de l'IA). */
  planTasksMax: 2_000,
  /** Référence locale d'une tâche. */
  refMax: 40,
  /** Section (= colonne du Tableau) : libellé de colonne. */
  sectionMax: WORK_LIMITS.columnLabelMax,
  /** Libellé d'étiquette. */
  labelMax: WORK_LIMITS.labelLabelMax,
  /** Construction par l'IA (ADR-0063). */
  aiMembersMax: 20,
  aiTextMax: 2_000,
  aiNameMax: WORK_LIMITS.projectNameMax,
  /** Sprints d'un plan proposé par l'IA. */
  aiSprintsMax: 26,
  /** Tâches d'un plan proposé par l'IA, selon le niveau de détail. */
  aiTasksByDetail: { light: 12, standard: 25, detailed: 40 },
  aiMilestonesMax: 8,
} as const;

/** Origine d'un plan : un fichier importé ou une proposition de l'IA relue. */
export const WORK_PLAN_ORIGINS = ['import', 'ai'] as const;
export type WorkPlanOrigin = (typeof WORK_PLAN_ORIGINS)[number];

/** Niveau de détail demandé à l'IA. */
export const WORK_AI_DETAIL_LEVELS = ['light', 'standard', 'detailed'] as const;
export type WorkAiDetailLevel = (typeof WORK_AI_DETAIL_LEVELS)[number];

/** Durée d'un sprint, en semaines. */
export const WORK_AI_SPRINT_WEEKS = [1, 2, 3] as const;
export type WorkAiSprintWeeks = (typeof WORK_AI_SPRINT_WEEKS)[number];

// ── Outils ──────────────────────────────────────────────────────────────────

type Ctx = z.RefinementCtx;

function issue(ctx: Ctx, path: (string | number)[], code: string, message: string): void {
  ctx.addIssue({ code: 'custom', path, message, params: { code } });
}

const REF_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

const PlanRef = z.string({ error: 'Référence attendue.' }).refine((v) => REF_PATTERN.test(v), {
  message: 'Référence : 1 à 40 caractères parmi A-Z, a-z, 0-9, « _ » et « - ».',
  params: { code: 'WORK_PLAN_REF_INVALID' },
});

function text(max: number, what: string) {
  return z
    .string({ error: `${what} : texte attendu.` })
    .trim()
    .refine((v) => v.length > 0, {
      message: `${what} obligatoire.`,
      params: { code: 'FIELD_REQUIRED' },
    })
    .refine((v) => v.length <= max, {
      message: `${what} : ${max} caractères au plus.`,
      params: { code: 'TEXT_TOO_LONG' },
    });
}

function optText(max: number) {
  return z
    .string({ error: 'Texte attendu.' })
    .trim()
    .refine((v) => v.length <= max, {
      message: `${max} caractères au plus.`,
      params: { code: 'TEXT_TOO_LONG' },
    })
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
}

// ── Tâche d'un plan ─────────────────────────────────────────────────────────

export const WorkPlanTaskSchema = z
  .object({
    ref: PlanRef,
    title: text(WORK_LIMITS.taskTitleMax, 'Titre de la tâche'),
    description: optText(WORK_LIMITS.taskDescriptionMax),
    /** Libellé de la section (colonne du Tableau) ; absent : première colonne « à faire ». */
    section: optText(WORK_PLAN_LIMITS.sectionMax),
    assigneeUserId: WorkId.nullable().optional(),
    startDate: WorkDay.nullable().optional(),
    dueDate: WorkDay.nullable().optional(),
    priority: z.enum(WORK_PRIORITIES, { error: 'Priorité inconnue.' }).optional(),
    isMilestone: z.boolean({ error: 'Vrai ou faux attendu.' }).optional(),
    dependsOn: z
      .array(PlanRef, { error: 'Liste de références attendue.' })
      .max(WORK_LIMITS.dependenciesMax, {
        message: `${WORK_LIMITS.dependenciesMax} dépendances au plus.`,
      })
      .optional(),
    /** Libellés d'étiquettes (créées au besoin, voir ADR-0062 § 4). */
    labels: z
      .array(text(WORK_PLAN_LIMITS.labelMax, 'Étiquette'), { error: 'Liste attendue.' })
      .max(WORK_LIMITS.labelKeysPerTaskMax, {
        message: `${WORK_LIMITS.labelKeysPerTaskMax} étiquettes au plus.`,
      })
      .optional(),
    parentRef: PlanRef.nullable().optional(),
    estimateMinutes: z
      .number({ error: 'Estimation : un nombre de minutes.' })
      .int()
      .min(0)
      .max(WORK_LIMITS.estimateMinutesMax)
      .nullable()
      .optional(),
  })
  .strict();
export type WorkPlanTask = z.output<typeof WorkPlanTaskSchema>;
export type WorkPlanTaskInput = z.input<typeof WorkPlanTaskSchema>;

/**
 * Problèmes de STRUCTURE d'un plan (purs) : références uniques, dépendances et
 * parents connus, un seul niveau de sous-tâches, un jalon daté sans début et sans
 * sous-tâche, dates dans l'ordre, aucun cycle. Rend la liste des problèmes, vide
 * si le plan est créable tel quel.
 */
export interface WorkPlanProblem {
  index: number;
  field: string;
  code: string;
  message: string;
}

export function planProblems(tasks: readonly WorkPlanTask[]): WorkPlanProblem[] {
  const out: WorkPlanProblem[] = [];
  const byRef = new Map<string, WorkPlanTask>();
  tasks.forEach((t, index) => {
    if (byRef.has(t.ref)) {
      out.push({
        index,
        field: 'ref',
        code: 'WORK_PLAN_REF_DUPLICATE',
        message: `La référence « ${t.ref} » est utilisée deux fois.`,
      });
    }
    byRef.set(t.ref, t);
  });
  tasks.forEach((t, index) => {
    if (t.startDate && t.dueDate && t.dueDate < t.startDate) {
      out.push({
        index,
        field: 'dueDate',
        code: 'WORK_DATES_INVERTED',
        message: 'L’échéance précède la date de début.',
      });
    }
    if (t.isMilestone) {
      if (t.startDate)
        out.push({
          index,
          field: 'startDate',
          code: 'WORK_MILESTONE_HAS_START',
          message: 'Un jalon n’a pas de date de début.',
        });
      if (!t.dueDate)
        out.push({
          index,
          field: 'dueDate',
          code: 'WORK_MILESTONE_NEEDS_DATE',
          message: 'Un jalon exige une échéance.',
        });
    }
    const deps = t.dependsOn ?? [];
    if (new Set(deps).size !== deps.length) {
      out.push({
        index,
        field: 'dependsOn',
        code: 'WORK_ID_DUPLICATE',
        message: 'La même dépendance est posée deux fois.',
      });
    }
    for (const d of deps) {
      if (!byRef.has(d))
        out.push({
          index,
          field: 'dependsOn',
          code: 'WORK_PLAN_REF_UNKNOWN',
          message: `Dépendance introuvable : « ${d} ».`,
        });
    }
    if (t.parentRef) {
      const parent = byRef.get(t.parentRef);
      if (!parent || t.parentRef === t.ref) {
        out.push({
          index,
          field: 'parentRef',
          code: 'WORK_PLAN_REF_UNKNOWN',
          message: `Tâche parente introuvable : « ${t.parentRef} ».`,
        });
      } else if (parent.parentRef || parent.isMilestone || t.isMilestone) {
        out.push({
          index,
          field: 'parentRef',
          code: 'WORK_SUBTASK_DEPTH',
          message: 'Un seul niveau de sous-tâches, et un jalon n’en porte pas.',
        });
      }
    }
  });
  const children = new Map<string, number>();
  for (const t of tasks)
    if (t.parentRef) children.set(t.parentRef, (children.get(t.parentRef) ?? 0) + 1);
  tasks.forEach((t, index) => {
    if ((children.get(t.ref) ?? 0) > WORK_LIMITS.subtasksMax) {
      out.push({
        index,
        field: 'ref',
        code: 'WORK_SUBTASK_DEPTH',
        message: `Une tâche compte au plus ${WORK_LIMITS.subtasksMax} sous-tâches.`,
      });
    }
  });
  const cycle = planCycle(tasks);
  if (cycle !== null) {
    const index = tasks.findIndex((t) => t.ref === cycle[0]);
    out.push({
      index: Math.max(index, 0),
      field: 'dependsOn',
      code: 'WORK_DEPENDENCY_CYCLE',
      message: `Cycle de dépendances : ${cycle.join(' → ')}.`,
    });
  }
  return out;
}

/** Premier cycle de dépendances du plan (références, la première répétée à la fin), ou `null`. */
export function planCycle(
  tasks: readonly Pick<WorkPlanTask, 'ref' | 'dependsOn'>[],
): string[] | null {
  return detectCycle(
    tasks.map((t) => ({ id: t.ref, blockedBy: (t.dependsOn ?? []).map((taskId) => ({ taskId })) })),
  );
}

/** Tâches d'un plan : 1 à 2 000, structure vérifiée par `planProblems`. */
export const WorkPlanTasksSchema = z
  .array(WorkPlanTaskSchema, { error: 'Liste de tâches attendue.' })
  .min(1, { message: 'Le plan ne contient aucune tâche.' })
  .max(WORK_PLAN_LIMITS.planTasksMax, {
    message: `${WORK_PLAN_LIMITS.planTasksMax} tâches au plus.`,
  })
  .superRefine((tasks, ctx) => {
    for (const p of planProblems(tasks)) issue(ctx, [p.index, p.field], p.code, p.message);
  });

/** Projet à créer depuis un plan (mêmes règles que `POST /work/projects`, sans liens commerciaux). */
export const WorkPlanProjectSchema = z
  .object({
    name: text(WORK_LIMITS.projectNameMax, 'Nom du projet'),
    description: optText(WORK_LIMITS.projectDescriptionMax),
    kind: z.enum(WORK_PROJECT_KINDS, { error: 'Nature : client ou internal.' }),
    ownerUserId: WorkId.nullable().optional(),
    startDate: WorkDay.nullable().optional(),
    dueDate: WorkDay.nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.startDate && v.dueDate && v.dueDate < v.startDate) {
      issue(ctx, ['dueDate'], 'WORK_DATES_INVERTED', 'L’échéance précède la date de début.');
    }
  });
export type WorkPlanProject = z.output<typeof WorkPlanProjectSchema>;

/**
 * `POST /work/plans/projects` — créer un projet et ses tâches depuis un plan
 * relu (ADR-0063 : construction par l'IA). `aiDraftId` relie la création à la
 * proposition journalisée.
 */
export const CreateProjectFromPlanBody = z
  .object({
    origin: z.enum(WORK_PLAN_ORIGINS, { error: 'Origine : import ou ai.' }),
    project: WorkPlanProjectSchema,
    tasks: WorkPlanTasksSchema,
    aiDraftId: z
      .string()
      .regex(/^[0-9a-f]{24}$/i)
      .optional(),
  })
  .strict();
export type CreateProjectFromPlanBody = z.output<typeof CreateProjectFromPlanBody>;

// ── Import de fichier : aperçu et résultat (ADR-0062) ───────────────────────

/** Gravité d'un problème d'import : `error` = ligne écartée ; `warning` = ligne corrigée. */
export type WorkImportSeverity = 'error' | 'warning';

export interface WorkImportIssue {
  /** Numéro de ligne dans le fichier (en-tête = ligne 1), ou `null` pour le fichier entier. */
  row: number | null;
  /** Colonne concernée (libellé du modèle), ou `null`. */
  column: string | null;
  severity: WorkImportSeverity;
  code: string;
  message: string;
}

/** Ligne lue, telle qu'elle sera créée (après corrections). */
export interface WorkImportRowView {
  row: number;
  ref: string;
  title: string;
  section: string | null;
  assignee: { userId: string; name: string } | null;
  startDate: string | null;
  dueDate: string | null;
  priority: (typeof WORK_PRIORITIES)[number];
  isMilestone: boolean;
  dependsOn: number[];
  labels: string[];
  parentRow: number | null;
  estimateMinutes: number | null;
  /** La ligne sera importée (aucune erreur bloquante). */
  valid: boolean;
}

export interface WorkImportPreview {
  fileName: string | null;
  format: 'xlsx' | 'csv';
  rows: WorkImportRowView[];
  issues: WorkImportIssue[];
  counts: {
    rows: number;
    valid: number;
    invalid: number;
    warnings: number;
    milestones: number;
    subtasks: number;
    dependencies: number;
  };
  /** Sections qui deviendront de nouvelles colonnes ; étiquettes qui seront créées. */
  newSections: string[];
  newLabels: string[];
  /** Colonnes du fichier ignorées (inconnues du modèle). */
  ignoredColumns: string[];
}

export interface WorkPlanApplyResult {
  projectId: string;
  projectName: string;
  createdTasks: number;
  createdSubtasks: number;
  createdMilestones: number;
  createdDependencies: number;
  createdColumns: string[];
  createdLabels: string[];
  /** Avertissements d'application (dépendance aux dates incohérentes, etc.). */
  warnings: string[];
}

// ── Construction par l'IA (ADR-0063) ────────────────────────────────────────

/** `POST /work/ai/plan` — formulaire « Construire avec l'IA ». */
export const WorkAiPlanRequestBody = z
  .object({
    name: text(WORK_PLAN_LIMITS.aiNameMax, 'Nom du projet'),
    context: optText(WORK_PLAN_LIMITS.aiTextMax),
    objective: text(WORK_PLAN_LIMITS.aiTextMax, 'Objectif'),
    deliverables: optText(WORK_PLAN_LIMITS.aiTextMax),
    startDate: WorkDay,
    dueDate: WorkDay,
    memberUserIds: z
      .array(WorkId, { error: 'Liste de membres attendue.' })
      .max(WORK_PLAN_LIMITS.aiMembersMax, {
        message: `${WORK_PLAN_LIMITS.aiMembersMax} membres au plus.`,
      })
      .optional(),
    sprintWeeks: z.union([z.literal(1), z.literal(2), z.literal(3)], {
      error: 'Durée des sprints : 1, 2 ou 3 semaines.',
    }),
    constraints: optText(WORK_PLAN_LIMITS.aiTextMax),
    detail: z.enum(WORK_AI_DETAIL_LEVELS, { error: 'Niveau : light, standard ou detailed.' }),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.dueDate < v.startDate) {
      issue(ctx, ['dueDate'], 'WORK_DATES_INVERTED', 'La date butoir précède la date de début.');
      return;
    }
    const sprints = sprintCalendar(v.startDate, v.dueDate, v.sprintWeeks);
    if (sprints.length > WORK_PLAN_LIMITS.aiSprintsMax) {
      issue(
        ctx,
        ['sprintWeeks'],
        'WORK_AI_TOO_MANY_SPRINTS',
        `Cette période compterait ${sprints.length} sprints (${WORK_PLAN_LIMITS.aiSprintsMax} au plus) : allongez les sprints ou rapprochez la date butoir.`,
      );
    }
    const ids = v.memberUserIds ?? [];
    if (new Set(ids).size !== ids.length) {
      issue(ctx, ['memberUserIds'], 'WORK_ID_DUPLICATE', 'Un membre est choisi deux fois.');
    }
  });
export type WorkAiPlanRequestBody = z.output<typeof WorkAiPlanRequestBody>;

/** Sprint calculé par le SERVEUR (jamais par l'IA) : numéro, bornes incluses. */
export interface WorkSprint {
  number: number;
  label: string;
  startDate: string;
  endDate: string;
}

/**
 * Découpe [début, butoir] en sprints de `weeks` semaines (le dernier s'arrête à
 * la date butoir). Calcul déterministe : l'IA choisit un NUMÉRO de sprint, les
 * dates en découlent.
 */
export function sprintCalendar(startDate: string, dueDate: string, weeks: number): WorkSprint[] {
  if (!isCalendarDay(startDate) || !isCalendarDay(dueDate) || dueDate < startDate) return [];
  const out: WorkSprint[] = [];
  let start = startDate;
  for (let n = 1; start <= dueDate && n <= 1_000; n += 1) {
    const end = addDays(start, weeks * 7 - 1);
    out.push({
      number: n,
      label: `Sprint ${n}`,
      startDate: start,
      endDate: end > dueDate ? dueDate : end,
    });
    start = addDays(start, weeks * 7);
  }
  return out;
}

/** Proposition de l'IA, vérifiée et corrigée par le serveur, prête à relire. */
export interface WorkAiPlanDraft {
  /** Identifiant de la ligne de journal (relie la création à la proposition). */
  draftId: string;
  summary: string;
  /** Description proposée pour le projet (objectif, sprints), modifiable à la relecture. */
  description: string;
  sprints: (WorkSprint & { goal: string })[];
  /** Tâches au format commun du plan (jalons compris, `isMilestone`). */
  tasks: WorkPlanTask[];
  /** Corrections apportées par le serveur, en français. */
  corrections: string[];
  /** Mention affichée : l'IA propose, vous décidez. */
  mention: string;
}
