// Créateur de projet depuis un plan — le chemin UNIQUE de l'import de fichier
// (ADR-0062) et de la construction par l'IA (ADR-0063).
//
// Un plan (`@lalanda/shared/work`, `plan.ts`) est une liste de tâches à
// références locales. Ce service :
//
//   1. revérifie TOUT avant la première écriture : structure du plan (références,
//      parents, jalons, cycle), responsables éligibles (`work.update`), sections
//      (colonnes) et étiquettes à créer, bornes (12 colonnes, 50 étiquettes,
//      5 000 tâches par projet) ;
//   2. écrit par les SERVICES existants du module (réglages, projets, tâches,
//      dépendances) — jamais directement en base : mêmes règles, même historique,
//      mêmes notifications qu'une saisie à la main ;
//   3. en cas d'échec en cours de route, ANNULE proprement : projet neuf
//      supprimé (avec son contenu), ou tâches créées retirées d'un projet
//      existant ; étiquettes et colonnes ajoutées remises comme avant (au mieux).
//
// Les services ne partagent pas de transaction MongoDB : le « tout ou rien » est
// obtenu par la vérification préalable complète, puis par compensation.

import {
  WORK_LABEL_COLORS,
  WORK_LIMITS,
  planProblems,
  type WorkColumn,
  type WorkLabel,
  type WorkLabelColor,
  type WorkPlanApplyResult,
  type WorkPlanOrigin,
  type WorkPlanProject,
  type WorkPlanTask,
  type WorkProjectView,
} from '@lalanda/shared/work';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { actorCan, conflict, forbidden, invalidMany, type WorkActor } from './work.common.js';
import { WorkMembersService } from './work-members.service.js';
import { WorkProjectsService } from './work-projects.service.js';
import { WorkSettingsService } from './work-settings.service.js';
import { WorkTasksService } from './work-tasks.service.js';
import { WorkTask, type WorkTaskDocument } from './work.schemas.js';

/** Forme comparable d'un libellé : minuscules, sans accents, espaces réduits. */
export function normalizeLabel(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Clé stable `^[a-z0-9_-]{1,32}$` tirée d'un libellé, unique parmi `taken`. */
export function keyFor(label: string, taken: ReadonlySet<string>, fallback: string): string {
  const base =
    normalizeLabel(label)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || fallback;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const k = `${base}-${n}`;
    if (!taken.has(k)) return k;
  }
}

/** Couleurs des étiquettes créées : palette fermée, sans gris ni rouge (rouge = alerte). */
const NEW_LABEL_COLORS: readonly WorkLabelColor[] = WORK_LABEL_COLORS.filter(
  (c) => c !== 'gray' && c !== 'red',
);

/** Colonne existante portant ce libellé (ou cette clé), ou `undefined`. */
export function columnMatching(
  columns: readonly WorkColumn[],
  section: string,
): WorkColumn | undefined {
  const n = normalizeLabel(section);
  return columns.find((c) => normalizeLabel(c.label) === n || c.key === n);
}

/** Étiquette existante portant ce libellé (ou cette clé), ou `undefined`. */
export function labelMatching(labels: readonly WorkLabel[], text: string): WorkLabel | undefined {
  const n = normalizeLabel(text);
  return labels.find((l) => normalizeLabel(l.label) === n || l.key === n);
}

/**
 * Colonnes du projet après ajout des sections inconnues (catégorie « à faire »,
 * insérées avant la colonne « terminé »), et libellés ajoutés. Pur.
 */
export function columnsWithSections(
  columns: readonly WorkColumn[],
  sections: readonly string[],
): { columns: WorkColumn[]; added: string[] } {
  const out = [...columns];
  const added: string[] = [];
  for (const s of sections) {
    if (columnMatching(out, s)) continue;
    const key = keyFor(s, new Set(out.map((c) => c.key)), 'section');
    const doneAt = out.findIndex((c) => c.category === 'done');
    const column: WorkColumn = { key, label: s.trim(), category: 'todo' };
    if (doneAt === -1) out.push(column);
    else out.splice(doneAt, 0, column);
    added.push(column.label);
  }
  return { columns: out, added };
}

/** Étiquettes après ajout des libellés inconnus, et libellés ajoutés. Pur. */
export function labelsWithTexts(
  labels: readonly WorkLabel[],
  texts: readonly string[],
): { labels: WorkLabel[]; added: string[] } {
  const out = [...labels];
  const added: string[] = [];
  for (const t of texts) {
    if (labelMatching(out, t)) continue;
    const key = keyFor(t, new Set(out.map((l) => l.key)), 'etiquette');
    const color = NEW_LABEL_COLORS[(out.length + added.length) % NEW_LABEL_COLORS.length]!;
    out.push({ key, label: t.trim(), color });
    added.push(t.trim());
  }
  return { labels: out, added };
}

/** Sections et étiquettes distinctes d'un plan, dans l'ordre d'apparition. */
export function distinctTexts(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    const n = normalizeLabel(v);
    if (n === '' || seen.has(n)) continue;
    seen.add(n);
    out.push(v.trim());
  }
  return out;
}

interface Prepared {
  columns: WorkColumn[];
  addedColumns: string[];
  labels: WorkLabel[];
  addedLabels: string[];
  settingsRevision: number;
  previousLabels: WorkLabel[];
}

@Injectable()
export class WorkPlanBuilder {
  private readonly logger = new Logger('WorkPlanBuilder');

  constructor(
    @InjectModel(WorkTask.name) private readonly taskModel: Model<WorkTaskDocument>,
    @Inject(WorkProjectsService) private readonly projects: WorkProjectsService,
    @Inject(WorkTasksService) private readonly tasks: WorkTasksService,
    @Inject(WorkSettingsService) private readonly settings: WorkSettingsService,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Créer un projet et toutes ses tâches (`work.manage`). */
  async createProject(
    organizationId: string,
    project: WorkPlanProject,
    tasks: readonly WorkPlanTask[],
    actor: WorkActor,
    origin: WorkPlanOrigin,
  ): Promise<WorkPlanApplyResult> {
    if (!actorCan(actor, 'work.manage')) {
      forbidden('FORBIDDEN', 'Créer un projet demande le droit de gérer les projets.');
    }
    this.assertStructure(tasks);
    await this.assertAssignees(organizationId, [
      ...tasks.map((t) => t.assigneeUserId),
      project.ownerUserId,
    ]);
    const defaults = await this.settings.get(organizationId);
    const prepared = await this.prepare(organizationId, defaults.defaultColumns, tasks, actor);

    let created: WorkProjectView | null = null;
    try {
      await this.writeLabels(organizationId, prepared, actor);
      created = await this.projects.create(
        organizationId,
        {
          name: project.name,
          description: project.description ?? null,
          kind: project.kind,
          ownerUserId: project.ownerUserId ?? null,
          startDate: project.startDate ?? null,
          dueDate: project.dueDate ?? null,
          columns: prepared.columns,
        },
        actor,
      );
      const counts = await this.writeTasks(organizationId, created.id, tasks, prepared, actor);
      const result: WorkPlanApplyResult = {
        projectId: created.id,
        projectName: created.name,
        ...counts,
        createdColumns: prepared.addedColumns,
        createdLabels: prepared.addedLabels,
      };
      await this.trace(
        organizationId,
        created.id,
        actor,
        origin,
        'work.plan.project_created',
        result,
      );
      return result;
    } catch (err) {
      if (created)
        await this.safely(() => this.projects.remove(organizationId, created!.id, actor));
      await this.restoreLabels(organizationId, prepared, actor);
      throw err;
    }
  }

  /** Ajouter les tâches d'un plan à un projet existant (`work.update`). */
  async addToProject(
    organizationId: string,
    projectId: string,
    tasks: readonly WorkPlanTask[],
    actor: WorkActor,
    origin: WorkPlanOrigin,
  ): Promise<WorkPlanApplyResult> {
    this.assertStructure(tasks);
    const project = await this.projects.requireWritable(organizationId, projectId);
    await this.assertAssignees(
      organizationId,
      tasks.map((t) => t.assigneeUserId),
    );
    // Lecture seule (compte) : les écritures passent toutes par les services.
    const existing = await this.taskModel.countDocuments({ organizationId, projectId }).exec();
    if (existing + tasks.length > WORK_LIMITS.tasksPerProject) {
      conflict(
        'WORK_TASK_LIMIT',
        `Un projet compte au plus ${WORK_LIMITS.tasksPerProject} tâches : ${existing} existent déjà.`,
        { limit: WORK_LIMITS.tasksPerProject },
      );
    }
    const prepared = await this.prepare(organizationId, project.columns, tasks, actor);

    const createdTop: string[] = [];
    let columnsChanged = false;
    try {
      await this.writeLabels(organizationId, prepared, actor);
      if (prepared.addedColumns.length > 0) {
        await this.projects.update(
          organizationId,
          projectId,
          { expectedRevision: project.revision, columns: prepared.columns },
          actor,
        );
        columnsChanged = true;
      }
      const counts = await this.writeTasks(
        organizationId,
        projectId,
        tasks,
        prepared,
        actor,
        createdTop,
      );
      const result: WorkPlanApplyResult = {
        projectId,
        projectName: project.name,
        ...counts,
        createdColumns: prepared.addedColumns,
        createdLabels: prepared.addedLabels,
      };
      await this.trace(
        organizationId,
        projectId,
        actor,
        origin,
        'work.plan.tasks_imported',
        result,
      );
      return result;
    } catch (err) {
      for (const id of createdTop.reverse()) {
        await this.safely(() => this.tasks.remove(organizationId, id, actor));
      }
      if (columnsChanged) {
        await this.safely(async () => {
          const now = await this.projects.requireOwn(organizationId, projectId);
          await this.projects.update(
            organizationId,
            projectId,
            { expectedRevision: now.revision, columns: project.columns },
            actor,
          );
        });
      }
      await this.restoreLabels(organizationId, prepared, actor);
      throw err;
    }
  }

  // ── Vérifications préalables ─────────────────────────────────────────────

  private assertStructure(tasks: readonly WorkPlanTask[]): void {
    if (tasks.length === 0) {
      invalidMany([
        { path: 'tasks', code: 'WORK_PLAN_EMPTY', message: 'Le plan ne contient aucune tâche.' },
      ]);
    }
    const problems = planProblems(tasks);
    if (problems.length > 0) {
      invalidMany(
        problems.slice(0, 50).map((p) => ({
          path: `tasks.${p.index}.${p.field}`,
          code: p.code,
          message: p.message,
        })),
      );
    }
  }

  private async assertAssignees(
    organizationId: string,
    ids: readonly (string | null | undefined)[],
  ): Promise<void> {
    const unique = [...new Set(ids.filter((i): i is string => typeof i === 'string'))];
    await this.members.requireEligible(
      organizationId,
      unique,
      'work.update',
      'WORK_ASSIGNEE_NOT_ELIGIBLE',
      'assigneeUserId',
    );
  }

  /** Colonnes et étiquettes finales ; refus si l'appelant ne peut pas les créer ou si une borne saute. */
  private async prepare(
    organizationId: string,
    baseColumns: readonly WorkColumn[],
    tasks: readonly WorkPlanTask[],
    actor: WorkActor,
  ): Promise<Prepared> {
    const manage = actorCan(actor, 'work.manage');
    const { columns, added: addedColumns } = columnsWithSections(
      baseColumns,
      distinctTexts(tasks.map((t) => t.section)),
    );
    if (addedColumns.length > 0 && !manage) {
      forbidden(
        'WORK_PLAN_SECTION_FORBIDDEN',
        `Créer une section (${addedColumns.join(', ')}) demande le droit de gérer les projets.`,
      );
    }
    if (columns.length > WORK_LIMITS.columnsMax) {
      conflict(
        'WORK_PLAN_COLUMN_LIMIT',
        `Un projet compte au plus ${WORK_LIMITS.columnsMax} sections : le plan en demande ${columns.length}.`,
        { limit: WORK_LIMITS.columnsMax },
      );
    }
    const settings = await this.settings.get(organizationId);
    const { labels, added: addedLabels } = labelsWithTexts(
      settings.labels,
      distinctTexts(tasks.flatMap((t) => t.labels ?? [])),
    );
    if (addedLabels.length > 0 && !manage) {
      forbidden(
        'WORK_PLAN_LABEL_FORBIDDEN',
        `Créer une étiquette (${addedLabels.join(', ')}) demande le droit de gérer les projets.`,
      );
    }
    if (labels.length > WORK_LIMITS.labelsMax) {
      conflict(
        'WORK_PLAN_LABEL_LIMIT',
        `L’organisation compte au plus ${WORK_LIMITS.labelsMax} étiquettes : le plan en ajouterait ${addedLabels.length}.`,
        { limit: WORK_LIMITS.labelsMax },
      );
    }
    return {
      columns,
      addedColumns,
      labels,
      addedLabels,
      settingsRevision: settings.revision,
      previousLabels: settings.labels,
    };
  }

  // ── Écritures ────────────────────────────────────────────────────────────

  private async writeLabels(organizationId: string, p: Prepared, actor: WorkActor): Promise<void> {
    if (p.addedLabels.length === 0) return;
    const current = await this.settings.get(organizationId);
    const after = await this.settings.put(
      organizationId,
      {
        expectedRevision: p.settingsRevision,
        labels: p.labels,
        defaultColumns: current.defaultColumns,
        dueSoonDays: current.dueSoonDays,
      },
      actor,
    );
    p.settingsRevision = after.revision;
  }

  private async restoreLabels(
    organizationId: string,
    p: Prepared,
    actor: WorkActor,
  ): Promise<void> {
    if (p.addedLabels.length === 0) return;
    await this.safely(async () => {
      const current = await this.settings.get(organizationId);
      const added = new Set(
        p.labels.filter((l) => !labelMatching(p.previousLabels, l.label)).map((l) => l.key),
      );
      if (!current.labels.some((l) => added.has(l.key))) return;
      await this.settings.put(
        organizationId,
        {
          expectedRevision: current.revision,
          labels: current.labels.filter((l) => !added.has(l.key)),
          defaultColumns: current.defaultColumns,
          dueSoonDays: current.dueSoonDays,
        },
        actor,
      );
    });
  }

  /**
   * Tâches de premier niveau d'abord (dans l'ordre du plan), puis sous-tâches,
   * puis dépendances. `createdTop` reçoit les identifiants de premier niveau
   * créés (pour l'annulation : retirer une tâche retire ses sous-tâches).
   */
  private async writeTasks(
    organizationId: string,
    projectId: string,
    tasks: readonly WorkPlanTask[],
    p: Prepared,
    actor: WorkActor,
    createdTop: string[] = [],
  ): Promise<
    Omit<WorkPlanApplyResult, 'projectId' | 'projectName' | 'createdColumns' | 'createdLabels'>
  > {
    const ids = new Map<string, string>();
    const warnings: string[] = [];
    let createdTasks = 0;
    let createdSubtasks = 0;
    let createdMilestones = 0;
    const ordered = [...tasks.filter((t) => !t.parentRef), ...tasks.filter((t) => t.parentRef)];
    for (const t of ordered) {
      const column = t.section ? columnMatching(p.columns, t.section) : undefined;
      const labelKeys = [
        ...new Set(
          (t.labels ?? [])
            .map((l) => labelMatching(p.labels, l)?.key)
            .filter((k): k is string => !!k),
        ),
      ];
      const res = await this.tasks.create(
        organizationId,
        projectId,
        {
          title: t.title,
          description: t.description ?? null,
          assigneeUserId: t.assigneeUserId ?? null,
          priority: t.priority ?? 'none',
          labelKeys,
          startDate: t.isMilestone ? null : (t.startDate ?? null),
          dueDate: t.dueDate ?? null,
          isMilestone: t.isMilestone ?? false,
          estimateMinutes: t.estimateMinutes ?? null,
          ...(column ? { columnKey: column.key } : {}),
          parentTaskId: t.parentRef ? (ids.get(t.parentRef) ?? null) : null,
        },
        actor,
      );
      ids.set(t.ref, res.task.id);
      if (t.parentRef) createdSubtasks += 1;
      else {
        createdTasks += 1;
        createdTop.push(res.task.id);
      }
      if (t.isMilestone) createdMilestones += 1;
    }
    let createdDependencies = 0;
    for (const t of tasks) {
      for (const d of t.dependsOn ?? []) {
        const res = await this.tasks.addDependency(
          organizationId,
          ids.get(t.ref)!,
          ids.get(d)!,
          actor,
        );
        createdDependencies += 1;
        for (const w of res.warnings) {
          if (w.code === 'WORK_DEPENDENCY_DATE_CONFLICT') {
            warnings.push(
              `« ${t.title} » commence avant la fin d’une tâche qu’elle attend : vérifiez les dates.`,
            );
          }
        }
      }
    }
    return { createdTasks, createdSubtasks, createdMilestones, createdDependencies, warnings };
  }

  private async trace(
    organizationId: string,
    projectId: string,
    actor: WorkActor,
    origin: WorkPlanOrigin,
    action: string,
    r: WorkPlanApplyResult,
  ): Promise<void> {
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role ?? 'unknown',
      action,
      targetType: 'work_project',
      targetId: projectId,
      metadata: {
        origin,
        tasks: r.createdTasks,
        subtasks: r.createdSubtasks,
        milestones: r.createdMilestones,
        dependencies: r.createdDependencies,
        columns: r.createdColumns.length,
        labels: r.createdLabels.length,
      },
    });
  }

  /** Compensation : un échec d'annulation est journalisé, jamais masquant l'erreur d'origine. */
  private async safely(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(
        `annulation incomplète d’un plan : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
