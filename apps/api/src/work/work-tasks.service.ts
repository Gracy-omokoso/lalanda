// Tâches, sous-tâches, jalons, dépendances, Kanban — ADR-0039 § 2.3, § 4 et § 6.
//
// Règles tenues ici (le schéma zod partagé tient la forme) :
//
//   - écriture refusée sur un projet archivé (`409 WORK_PROJECT_ARCHIVED`) ;
//   - un seul niveau de sous-tâches, 100 au plus, jamais sous un jalon
//     (`WORK_SUBTASK_DEPTH`) ; un jalon n'a pas de début et exige une échéance ;
//   - `done`, `completedAt`, `completedBy` sont DÉNORMALISÉS de la catégorie de la
//     colonne et écrits dans la même mise à jour que la colonne ;
//   - dépendances fin → début dans le même projet, sans cycle (`detectCycle`,
//     `409 WORK_DEPENDENCY_CYCLE`) ; un conflit de dates n'est qu'un
//     avertissement (`WORK_DEPENDENCY_DATE_CONFLICT`), rien n'est déplacé ;
//   - « bloquée » se calcule à la lecture (`isBlocked`), jamais stocké ;
//   - rang fractionnaire du Kanban (`rankBetween`), la liste suit le même rang ;
//   - écriture concurrente : `expectedRevision` → `409 STALE_REVISION`.
//
// Les notifications partent APRÈS l'écriture, par le port (`WorkNotifier`).

import {
  WORK_LIMITS,
  dependencyConflicts,
  detectCycle,
  groupMyTasks,
  isBlocked,
  kinshasaDayOf,
  rankBetween,
  type CreateWorkTaskBody,
  type ListProjectTasksQuery,
  type ListWorkTasksQuery,
  type MoveWorkTaskBody,
  type MyTaskEntry,
  type MyTaskItem,
  type MyTasksView,
  type PatchWorkTaskBody,
  type WorkColumn,
  type WorkPage,
  type WorkSuggestion,
  type WorkTaskDetail,
  type WorkTaskView,
  type WorkTaskWriteResult,
  type WorkWarning,
} from '@lalanda/shared/work';
import { MY_TASKS_MAX_PER_SOURCE, type CrmMyTaskItem } from '@lalanda/shared/crm';
import { PURCHASES_AGENDA_MAX, type PurchasesMyTaskItem } from '@lalanda/shared/purchases';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { beforeTimeCursor, decodeTimeCursor, encodeTimeCursor } from '../crm/time-cursor.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import {
  actorCan,
  conflict,
  invalid,
  invalidCursor,
  iso,
  isWorkId,
  oid,
  projectArchived,
  staleRevision,
  taskNotFound,
  type WorkActor,
} from './work.common.js';
import {
  CRM_AGENDA_SOURCE,
  PURCHASES_AGENDA_SOURCE,
  noCrmAgenda,
  noPurchasesAgenda,
  type CrmAgendaReader,
  type PurchasesAgendaReader,
} from './my-tasks.ports.js';
import { WorkActivityService, type ActivityInput } from './work-activity.service.js';
import { dropAttachmentObjects } from './work-attachments.storage.js';
import { WorkMembersService } from './work-members.service.js';
import { WorkNotifier } from './work-notifier.js';
import { WorkProjectsService } from './work-projects.service.js';
import { WorkSettingsService } from './work-settings.service.js';
import {
  WorkAttachment,
  WorkComment,
  WorkTask,
  WorkTimeEntry,
  type WorkAttachmentDocument,
  type WorkAttachmentLean,
  type WorkCommentDocument,
  type WorkProjectLean,
  type WorkTaskDocument,
  type WorkTaskLean,
  type WorkTimeEntryDocument,
} from './work.schemas.js';

/** Projection allégée : la description ne sert qu'au détail. */
const LIGHT = { description: 0, reminders: 0 } as const;

interface ViewContext {
  columns: Map<string, Map<string, WorkColumn>>;
  doneById: Map<string, { done: boolean }>;
  subtasks: Map<string, { total: number; done: number }>;
  refs: Map<string, { userId: string; name: string }>;
}

@Injectable()
export class WorkTasksService {
  private readonly logger = new Logger('WorkTasks');

  constructor(
    @InjectModel(WorkTask.name) private readonly tasks: Model<WorkTaskDocument>,
    @InjectModel(WorkTimeEntry.name) private readonly time: Model<WorkTimeEntryDocument>,
    @InjectModel(WorkComment.name) private readonly comments: Model<WorkCommentDocument>,
    @InjectModel(WorkAttachment.name) private readonly attachments: Model<WorkAttachmentDocument>,
    @Inject(WorkProjectsService) private readonly projects: WorkProjectsService,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(WorkSettingsService) private readonly settings: WorkSettingsService,
    @Inject(WorkActivityService) private readonly activity: WorkActivityService,
    @Inject(WorkNotifier) private readonly notifier: WorkNotifier,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
    // ADR-0040 — C4 : relances CRM, facultatives (tests, module absent).
    @Optional() @Inject(CRM_AGENDA_SOURCE) crmAgenda: CrmAgendaReader | null = null,
    // ADR-0044 — P3 (§ 6.5) : approbations d'achat, facultatives (tests, module absent).
    @Optional()
    @Inject(PURCHASES_AGENDA_SOURCE)
    purchasesAgenda: PurchasesAgendaReader | null = null,
  ) {
    this.crmAgenda = crmAgenda ?? noCrmAgenda;
    this.purchasesAgenda = purchasesAgenda ?? noPurchasesAgenda;
  }

  private readonly crmAgenda: CrmAgendaReader;
  private readonly purchasesAgenda: PurchasesAgendaReader;

  // ── Accès ────────────────────────────────────────────────────────────────

  async requireOwn(organizationId: string, taskId: string): Promise<WorkTaskLean> {
    if (!isWorkId(taskId)) taskNotFound();
    const doc = await this.tasks
      .findOne({ _id: oid(taskId), organizationId })
      .lean<WorkTaskLean>()
      .exec();
    if (!doc) taskNotFound();
    return doc;
  }

  /** Tâche et son projet, projet non archivé (toute écriture). */
  async requireWritable(
    organizationId: string,
    taskId: string,
  ): Promise<{ task: WorkTaskLean; project: WorkProjectLean }> {
    const task = await this.requireOwn(organizationId, taskId);
    const project = await this.projects.requireOwn(organizationId, task.projectId);
    if (project.status === 'archived') projectArchived();
    return { task, project };
  }

  // ── Vues ─────────────────────────────────────────────────────────────────

  private async context(
    organizationId: string,
    docs: readonly WorkTaskLean[],
    projects?: readonly WorkProjectLean[],
  ): Promise<ViewContext> {
    const projectIds = [...new Set(docs.map((d) => d.projectId))];
    const projectDocs =
      projects ??
      (await Promise.all(projectIds.map((p) => this.projects.requireOwn(organizationId, p))));
    const columns = new Map(
      projectDocs.map((p) => [String(p._id), new Map(p.columns.map((c) => [c.key, c]))]),
    );
    const predecessorIds = [
      ...new Set(docs.flatMap((d) => (d.blockedBy ?? []).map((b) => b.taskId))),
    ].filter(isWorkId);
    const ids = docs.map((d) => String(d._id));
    const [preds, subs, refs] = await Promise.all([
      predecessorIds.length === 0
        ? []
        : this.tasks
            .find({ organizationId, _id: { $in: predecessorIds.map(oid) } }, { done: 1 })
            .lean<{ _id: unknown; done: boolean }[]>()
            .exec(),
      ids.length === 0
        ? []
        : this.tasks
            .aggregate<{ _id: string; total: number; done: number }>([
              { $match: { organizationId, parentTaskId: { $in: ids } } },
              {
                $group: {
                  _id: '$parentTaskId',
                  total: { $sum: 1 },
                  done: { $sum: { $cond: ['$done', 1, 0] } },
                },
              },
            ])
            .exec(),
      this.members.refs(docs.map((d) => d.assigneeUserId)),
    ]);
    return {
      columns,
      doneById: new Map(preds.map((p) => [String(p._id), { done: p.done }])),
      subtasks: new Map(subs.map((s) => [s._id, { total: s.total, done: s.done }])),
      refs,
    };
  }

  private viewOf(d: WorkTaskLean, ctx: ViewContext): WorkTaskView {
    const id = String(d._id);
    const column = ctx.columns.get(d.projectId)?.get(d.columnKey);
    const sub = ctx.subtasks.get(id);
    const blockedBy = (d.blockedBy ?? []).map((b) => ({
      taskId: b.taskId,
      type: 'finish_to_start' as const,
    }));
    return {
      id,
      projectId: d.projectId,
      number: d.number,
      parentTaskId: d.parentTaskId ?? null,
      title: d.title,
      columnKey: d.columnKey,
      columnCategory: column?.category ?? (d.done ? 'done' : 'todo'),
      done: d.done,
      completedAt: iso(d.completedAt),
      rank: d.rank,
      assignee: d.assigneeUserId ? WorkMembersService.refOf(ctx.refs, d.assigneeUserId) : null,
      priority: d.priority,
      labelKeys: d.labelKeys ?? [],
      startDate: d.startDate ?? null,
      dueDate: d.dueDate ?? null,
      isMilestone: d.isMilestone,
      blockedBy,
      blocked: isBlocked({ blockedBy }, ctx.doneById),
      loggedMinutes: d.loggedMinutes ?? 0,
      estimateMinutes: d.estimateMinutes ?? null,
      subtaskCount: sub?.total ?? 0,
      doneSubtaskCount: sub?.done ?? 0,
      revision: d.revision,
      updatedAt: new Date(d.updatedAt).toISOString(),
    };
  }

  async views(
    organizationId: string,
    docs: readonly WorkTaskLean[],
    projects?: readonly WorkProjectLean[],
  ): Promise<WorkTaskView[]> {
    if (docs.length === 0) return [];
    const ctx = await this.context(organizationId, docs, projects);
    return docs.map((d) => this.viewOf(d, ctx));
  }

  async view(organizationId: string, taskId: string): Promise<WorkTaskView> {
    const doc = await this.requireOwn(organizationId, taskId);
    return (await this.views(organizationId, [doc]))[0]!;
  }

  /** `GET /work/projects/:projectId/tasks` — tout le projet, projection allégée. */
  async listProject(
    organizationId: string,
    projectId: string,
    query: ListProjectTasksQuery,
    actor: WorkActor,
  ): Promise<{ items: WorkTaskView[] }> {
    const project = await this.projects.requireOwn(organizationId, projectId);
    const filter: Record<string, unknown> = { organizationId, projectId };
    if (query.assignee) {
      filter['assigneeUserId'] = query.assignee === 'me' ? actor.userId : query.assignee;
    }
    if (query.label) filter['labelKeys'] = query.label;
    if (query.done !== undefined) filter['done'] = query.done;
    if (query.dueFrom || query.dueTo) {
      filter['dueDate'] = {
        ...(query.dueFrom ? { $gte: query.dueFrom } : {}),
        ...(query.dueTo ? { $lte: query.dueTo } : {}),
      };
    }
    const docs = await this.tasks
      .find(filter, LIGHT)
      .sort({ rank: 1, number: 1 })
      .limit(WORK_LIMITS.tasksPerProject)
      .lean<WorkTaskLean[]>()
      .exec();
    return { items: await this.views(organizationId, docs, [project]) };
  }

  /** `GET /work/tasks` — liste transverse paginée (calendrier, filtres). */
  async listTransverse(
    organizationId: string,
    query: ListWorkTasksQuery,
    actor: WorkActor,
  ): Promise<WorkPage<MyTaskItem>> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.projectId) {
      await this.projects.requireOwn(organizationId, query.projectId);
      and.push({ projectId: query.projectId });
    } else {
      const archived = await this.projects.archivedIds(organizationId);
      if (archived.length > 0) and.push({ projectId: { $nin: archived } });
    }
    if (query.assignee) {
      and.push({ assigneeUserId: query.assignee === 'me' ? actor.userId : query.assignee });
    }
    if (query.label) and.push({ labelKeys: query.label });
    if (query.done !== undefined) and.push({ done: query.done });
    if (query.dueFrom) and.push({ dueDate: { $gte: query.dueFrom } });
    if (query.dueTo) and.push({ dueDate: { $ne: null, $lte: query.dueTo } });
    if (query.cursor !== undefined) {
      const cursor = decodeTimeCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(beforeTimeCursor('createdAt', cursor));
    }
    const docs = await this.tasks
      .find({ $and: and }, LIGHT)
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<WorkTaskLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: await this.withProjectNames(organizationId, page),
      nextCursor:
        docs.length > query.limit && last
          ? encodeTimeCursor(new Date(last.createdAt), String(last._id))
          : null,
    };
  }

  private async withProjectNames(
    organizationId: string,
    docs: readonly WorkTaskLean[],
  ): Promise<MyTaskItem[]> {
    const [views, names] = await Promise.all([
      this.views(organizationId, docs),
      this.projects.namesOf(
        organizationId,
        docs.map((d) => d.projectId),
      ),
    ]);
    return views.map((v) => ({ ...v, projectName: names.get(v.projectId) ?? '' }));
  }

  /**
   * `GET /work/my-tasks` — tâches non terminées assignées à l'appelant dans
   * l'organisation active, hors projets archivés, groupées au jour de Kinshasa.
   *
   * ADR-0040 — C4 § 5.2 : s'y ajoutent, AGRÉGÉES À LA LECTURE (aucune copie), les
   * relances CRM non faites assignées à l'appelant — seulement s'il détient
   * `crm.read`. Chaque élément porte sa `source` ; 500 au plus par source
   * (`truncated`) ; un seul `dueSoonDays` (réglage de l'organisation).
   *
   * ADR-0044 — P3 (§ 6.5) : et les demandes d'achat que l'appelant peut approuver
   * (`purchase.approve`), 200 au plus, sans case à cocher.
   */
  async myTasks(organizationId: string, actor: WorkActor, now = new Date()): Promise<MyTasksView> {
    const archived = await this.projects.archivedIds(organizationId);
    const filter: Record<string, unknown> = {
      organizationId,
      assigneeUserId: actor.userId,
      done: false,
    };
    if (archived.length > 0) filter['projectId'] = { $nin: archived };
    // ADR-0041 § 9.4 (A3) : un retrait de `crm.read` masque les relances CRM.
    const crmVisible = actorCan(actor, 'crm.read');
    // ADR-0044 — P3 (§ 6.5) : approbations d'achat, pour les détenteurs EFFECTIFS de
    // `purchase.approve` seulement.
    const approvalsVisible = actorCan(actor, 'purchase.approve');
    const [docs, crm, purchases] = await Promise.all([
      this.tasks
        .find(filter, LIGHT)
        .sort({ dueDate: 1, _id: 1 })
        .limit(MY_TASKS_MAX_PER_SOURCE + 1)
        .lean<WorkTaskLean[]>()
        .exec(),
      crmVisible
        ? this.crmAgenda.agendaOf(organizationId, actor.userId, MY_TASKS_MAX_PER_SOURCE)
        : Promise.resolve({ items: [] as CrmMyTaskItem[], truncated: false }),
      approvalsVisible
        ? this.purchasesAgenda.approvalsOf(organizationId, actor.userId, PURCHASES_AGENDA_MAX)
        : Promise.resolve({ items: [] as PurchasesMyTaskItem[], truncated: false }),
    ]);
    const workTruncated = docs.length > MY_TASKS_MAX_PER_SOURCE;
    const work = await this.withProjectNames(
      organizationId,
      docs.slice(0, MY_TASKS_MAX_PER_SOURCE),
    );
    const items: MyTaskEntry[] = [
      ...work.map((t) => ({ ...t, source: 'work' as const })),
      ...crm.items,
      ...purchases.items,
    ];
    const today = kinshasaDayOf(now);
    const { dueSoonDays } = await this.settings.get(organizationId);
    const groups = groupMyTasks(items, today, dueSoonDays);
    return {
      asOf: today,
      ...groups,
      truncated: workTruncated || crm.truncated || purchases.truncated,
    };
  }

  async detail(organizationId: string, taskId: string): Promise<WorkTaskDetail> {
    const doc = await this.requireOwn(organizationId, taskId);
    const project = await this.projects.requireOwn(organizationId, doc.projectId);
    const id = String(doc._id);
    const [subDocs, successors, commentCount, attachmentCount] = await Promise.all([
      this.tasks
        .find({ organizationId, projectId: doc.projectId, parentTaskId: id }, LIGHT)
        .sort({ rank: 1, number: 1 })
        .lean<WorkTaskLean[]>()
        .exec(),
      this.tasks
        .find({ organizationId, 'blockedBy.taskId': id }, { number: 1, title: 1, done: 1 })
        .sort({ number: 1 })
        .lean<{ _id: unknown; number: number; title: string; done: boolean }[]>()
        .exec(),
      this.comments.countDocuments({ organizationId, taskId: id, deletedAt: null }).exec(),
      this.attachments.countDocuments({ organizationId, taskId: id, deletedAt: null }).exec(),
    ]);
    const predIds = (doc.blockedBy ?? []).map((b) => b.taskId).filter(isWorkId);
    const preds =
      predIds.length === 0
        ? []
        : await this.tasks
            .find(
              { organizationId, _id: { $in: predIds.map(oid) } },
              { number: 1, title: 1, done: 1 },
            )
            .sort({ number: 1 })
            .lean<{ _id: unknown; number: number; title: string; done: boolean }[]>()
            .exec();
    const [views, followers] = await Promise.all([
      this.views(organizationId, [doc, ...subDocs], [project]),
      this.members.refs(doc.followerUserIds ?? []),
    ]);
    const info = (t: { _id: unknown; number: number; title: string; done: boolean }) => ({
      taskId: String(t._id),
      number: t.number,
      title: t.title,
      done: t.done,
    });
    return {
      ...views[0]!,
      description: doc.description ?? null,
      completedBy: doc.completedBy ?? null,
      followers: (doc.followerUserIds ?? []).map((u) => WorkMembersService.refOf(followers, u)),
      subtasks: views.slice(1),
      predecessors: preds.map(info),
      successors: successors.map(info),
      commentCount,
      attachmentCount,
      source: doc.source
        ? { kind: 'quote_line', quoteId: doc.source.quoteId, lineIndex: doc.source.lineIndex }
        : null,
      billing: doc.billing
        ? {
            invoiceId: doc.billing.invoiceId,
            preparedAt: new Date(doc.billing.preparedAt).toISOString(),
            preparedBy: doc.billing.preparedBy,
          }
        : null,
      createdBy: doc.createdBy,
      createdAt: new Date(doc.createdAt).toISOString(),
    };
  }

  // ── Règles partagées ─────────────────────────────────────────────────────

  private columnOf(project: WorkProjectLean, key: string, path = 'columnKey'): WorkColumn {
    const col = project.columns.find((c) => c.key === key);
    if (!col) invalid(path, 'WORK_COLUMN_UNKNOWN', `Colonne inconnue : « ${key} ».`);
    return col;
  }

  private firstTodo(project: WorkProjectLean): WorkColumn {
    return project.columns.find((c) => c.category === 'todo')!;
  }

  private doneColumn(project: WorkProjectLean): WorkColumn {
    return project.columns.find((c) => c.category === 'done')!;
  }

  private async checkLabels(organizationId: string, keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    const known = new Set((await this.settings.get(organizationId)).labels.map((l) => l.key));
    const unknown = keys.find((k) => !known.has(k));
    if (unknown !== undefined) {
      invalid('labelKeys', 'WORK_LABEL_UNKNOWN', `Étiquette inconnue : « ${unknown} ».`);
    }
  }

  /** Champs dénormalisés d'une colonne : `done`, `completedAt`, `completedBy`. */
  private columnFields(
    current: Pick<WorkTaskLean, 'done' | 'completedAt' | 'completedBy'> | null,
    column: WorkColumn,
    actor: WorkActor,
  ): Record<string, unknown> {
    const done = column.category === 'done';
    if (current && current.done === done) {
      return { columnKey: column.key };
    }
    return {
      columnKey: column.key,
      done,
      completedAt: done ? new Date() : null,
      completedBy: done ? actor.userId : null,
    };
  }

  /** Rang en fin de colonne. */
  private async endRank(
    organizationId: string,
    projectId: string,
    columnKey: string,
    excludeId?: string,
  ): Promise<string> {
    const filter: Record<string, unknown> = { organizationId, projectId, columnKey };
    if (excludeId) filter['_id'] = { $ne: oid(excludeId) };
    const last = await this.tasks
      .findOne(filter, { rank: 1 })
      .sort({ rank: -1 })
      .lean<{ rank: string }>()
      .exec();
    return rankBetween(last?.rank ?? null, null);
  }

  /** Rang entre deux voisines de la colonne (l'une ou l'autre facultative). */
  private async rankNear(
    organizationId: string,
    projectId: string,
    columnKey: string,
    neighbours: { afterTaskId?: string; beforeTaskId?: string },
    excludeId?: string,
  ): Promise<string> {
    const neighbour = async (id: string, path: string): Promise<WorkTaskLean> => {
      const doc = await this.requireOwn(organizationId, id);
      if (doc.projectId !== projectId || doc.columnKey !== columnKey || id === excludeId) {
        invalid(path, 'INVALID_VALUE', 'La voisine doit être une autre tâche de la même colonne.');
      }
      return doc;
    };
    const exclude = excludeId ? { _id: { $ne: oid(excludeId) } } : {};
    const after = neighbours.afterTaskId
      ? await neighbour(neighbours.afterTaskId, 'afterTaskId')
      : null;
    const before = neighbours.beforeTaskId
      ? await neighbour(neighbours.beforeTaskId, 'beforeTaskId')
      : null;
    let low = after?.rank ?? null;
    let high = before?.rank ?? null;
    if (after && !before) {
      const next = await this.tasks
        .findOne({ organizationId, projectId, columnKey, rank: { $gt: after.rank }, ...exclude })
        .sort({ rank: 1 })
        .lean<{ rank: string }>()
        .exec();
      high = next?.rank ?? null;
    } else if (before && !after) {
      const prev = await this.tasks
        .findOne({ organizationId, projectId, columnKey, rank: { $lt: before.rank }, ...exclude })
        .sort({ rank: -1 })
        .lean<{ rank: string }>()
        .exec();
      low = prev?.rank ?? null;
    }
    if (low === null && high === null) return this.endRank(organizationId, projectId, columnKey);
    try {
      return rankBetween(low, high);
    } catch {
      invalid('afterTaskId', 'INVALID_VALUE', 'Les voisines indiquées ne sont pas consécutives.');
    }
  }

  /** Avertissements de dates qui concernent la tâche (successeur ou prédécesseur). */
  private async warningsFor(
    organizationId: string,
    projectId: string,
    taskId: string,
  ): Promise<WorkWarning[]> {
    const docs = await this.tasks
      .find({ organizationId, projectId }, { blockedBy: 1, startDate: 1, dueDate: 1 })
      .lean<
        {
          _id: unknown;
          blockedBy: { taskId: string }[];
          startDate: string | null;
          dueDate: string | null;
        }[]
      >()
      .exec();
    return dependencyConflicts(
      docs.map((d) => ({
        id: String(d._id),
        blockedBy: d.blockedBy ?? [],
        startDate: d.startDate ?? null,
        dueDate: d.dueDate ?? null,
      })),
    )
      .filter((c) => c.taskId === taskId || c.predecessorId === taskId)
      .map((c) => ({
        code: 'WORK_DEPENDENCY_DATE_CONFLICT',
        taskId: c.taskId,
        predecessorId: c.predecessorId,
      }));
  }

  private async result(
    organizationId: string,
    taskId: string,
    suggestions: WorkSuggestion[] = [],
  ): Promise<WorkTaskWriteResult> {
    const doc = await this.requireOwn(organizationId, taskId);
    const [task, warnings] = await Promise.all([
      this.view(organizationId, taskId),
      this.warningsFor(organizationId, doc.projectId, taskId),
    ]);
    return { task, warnings, suggestions };
  }

  private async actorName(actor: WorkActor): Promise<string> {
    return WorkMembersService.refOf(await this.members.refs([actor.userId]), actor.userId).name;
  }

  private async notifyAssigned(
    organizationId: string,
    task: { id: string; projectId: string; number: number; title: string },
    assigneeUserId: string,
    actor: WorkActor,
  ): Promise<void> {
    if (assigneeUserId === actor.userId) return;
    await this.notifier.taskEvent({
      organizationId,
      recipients: [assigneeUserId],
      kind: 'work.task_assigned',
      projectId: task.projectId,
      taskId: task.id,
      title: `${await this.actorName(actor)} vous a assigné #${task.number} ${task.title}`,
      actorUserId: actor.userId,
    });
  }

  /** Jalon passé à « terminé » : suggestion de facture et notification au responsable. */
  private async onMilestoneDone(
    organizationId: string,
    project: WorkProjectLean,
    task: WorkTaskLean,
    actor: WorkActor,
  ): Promise<WorkSuggestion[]> {
    const id = String(task._id);
    if (project.ownerUserId) {
      await this.notifier.taskEvent({
        organizationId,
        recipients: [project.ownerUserId],
        kind: 'work.milestone_completed',
        projectId: task.projectId,
        taskId: id,
        title: `Jalon terminé : #${task.number} ${task.title} (${project.name})`,
        actorUserId: actor.userId,
      });
    }
    return project.links?.customerId && !task.billing
      ? [{ code: 'PREPARE_INVOICE', taskId: id }]
      : [];
  }

  // ── Création ─────────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    projectId: string,
    body: CreateWorkTaskBody,
    actor: WorkActor,
  ): Promise<WorkTaskWriteResult> {
    const project = await this.projects.requireWritable(organizationId, projectId);
    const count = await this.tasks.countDocuments({ organizationId, projectId }).exec();
    if (count >= WORK_LIMITS.tasksPerProject) {
      conflict(
        'WORK_TASK_LIMIT',
        `Un projet compte au plus ${WORK_LIMITS.tasksPerProject} tâches.`,
        { limit: WORK_LIMITS.tasksPerProject },
      );
    }

    const parentTaskId = body.parentTaskId ?? null;
    if (parentTaskId) {
      const parent = await this.requireOwn(organizationId, parentTaskId);
      if (parent.projectId !== projectId) taskNotFound();
      if (parent.parentTaskId || parent.isMilestone) {
        invalid(
          'parentTaskId',
          'WORK_SUBTASK_DEPTH',
          'Une sous-tâche ne porte pas de sous-tâche, et un jalon n’en a pas.',
        );
      }
      const siblings = await this.tasks
        .countDocuments({ organizationId, projectId, parentTaskId })
        .exec();
      if (siblings >= WORK_LIMITS.subtasksMax) {
        invalid(
          'parentTaskId',
          'WORK_SUBTASK_DEPTH',
          `Une tâche compte au plus ${WORK_LIMITS.subtasksMax} sous-tâches.`,
        );
      }
    }

    const column = body.columnKey
      ? this.columnOf(project, body.columnKey)
      : this.firstTodo(project);
    const assigneeUserId = body.assigneeUserId ?? null;
    if (assigneeUserId) {
      await this.members.requireEligible(
        organizationId,
        [assigneeUserId],
        'work.update',
        'WORK_ASSIGNEE_NOT_ELIGIBLE',
        'assigneeUserId',
      );
    }
    const followers = body.followerUserIds ?? [];
    await this.members.requireEligible(
      organizationId,
      followers,
      'work.read',
      'WORK_FOLLOWER_NOT_ELIGIBLE',
      'followerUserIds',
    );
    await this.checkLabels(organizationId, body.labelKeys ?? []);

    const rank = body.afterTaskId
      ? await this.rankNear(organizationId, projectId, column.key, {
          afterTaskId: body.afterTaskId,
        })
      : await this.endRank(organizationId, projectId, column.key);
    const number = await this.projects.nextTaskNumber(organizationId, projectId);
    const followerUserIds = [
      ...new Set([actor.userId, ...(assigneeUserId ? [assigneeUserId] : []), ...followers]),
    ].slice(0, WORK_LIMITS.followersMax);

    const created = await this.tasks.create({
      organizationId,
      projectId,
      number,
      parentTaskId,
      title: body.title,
      description: body.description ?? null,
      ...this.columnFields(null, column, actor),
      rank,
      assigneeUserId,
      followerUserIds,
      priority: body.priority ?? 'none',
      labelKeys: body.labelKeys ?? [],
      startDate: body.startDate ?? null,
      dueDate: body.dueDate ?? null,
      isMilestone: body.isMilestone ?? false,
      blockedBy: [],
      loggedMinutes: 0,
      estimateMinutes: body.estimateMinutes ?? null,
      source: null,
      billing: null,
      reminders: { dueSoonFor: null, overdueFor: null },
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    const id = String(created._id);
    await this.activity.record(organizationId, {
      projectId,
      taskId: id,
      actorUserId: actor.userId,
      kind: 'task.created',
      data: { number, title: body.title.slice(0, 300) },
    });
    await this.projects.touch(organizationId, projectId);
    if (assigneeUserId) {
      await this.notifyAssigned(
        organizationId,
        { id, projectId, number, title: body.title },
        assigneeUserId,
        actor,
      );
    }
    return this.result(organizationId, id);
  }

  // ── Modification ─────────────────────────────────────────────────────────

  async patch(
    organizationId: string,
    taskId: string,
    body: PatchWorkTaskBody,
    actor: WorkActor,
  ): Promise<WorkTaskWriteResult> {
    const { task: current } = await this.requireWritable(organizationId, taskId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);

    const final = {
      isMilestone: body.isMilestone ?? current.isMilestone,
      startDate: body.startDate !== undefined ? body.startDate : current.startDate,
      dueDate: body.dueDate !== undefined ? body.dueDate : current.dueDate,
    };
    if (final.startDate && final.dueDate && final.dueDate < final.startDate) {
      invalid('dueDate', 'WORK_DATES_INVERTED', 'L’échéance précède la date de début.');
    }
    if (final.isMilestone) {
      if (final.startDate) {
        invalid('startDate', 'WORK_MILESTONE_HAS_START', 'Un jalon n’a pas de date de début.');
      }
      if (!final.dueDate) {
        invalid('dueDate', 'WORK_MILESTONE_NEEDS_DATE', 'Un jalon exige une échéance.');
      }
      if (!current.isMilestone) {
        const children = await this.tasks
          .countDocuments({ organizationId, parentTaskId: taskId })
          .exec();
        if (current.parentTaskId || children > 0) {
          invalid(
            'isMilestone',
            'WORK_SUBTASK_DEPTH',
            'Un jalon n’est ni une sous-tâche ni le parent de sous-tâches.',
          );
        }
      }
    }

    const set: Record<string, unknown> = { updatedBy: actor.userId };
    const changed: string[] = [];
    const assign = (field: string, value: unknown): void => {
      set[field] = value;
      changed.push(field);
    };
    if (body.title !== undefined) assign('title', body.title);
    if (body.description !== undefined) assign('description', body.description);
    if (body.priority !== undefined) assign('priority', body.priority);
    if (body.estimateMinutes !== undefined) assign('estimateMinutes', body.estimateMinutes);
    if (body.isMilestone !== undefined) assign('isMilestone', body.isMilestone);
    if (body.startDate !== undefined) assign('startDate', body.startDate);
    if (body.dueDate !== undefined) assign('dueDate', body.dueDate);
    if (body.labelKeys !== undefined) {
      await this.checkLabels(organizationId, body.labelKeys);
      assign('labelKeys', body.labelKeys);
    }
    if (body.followerUserIds !== undefined) {
      await this.members.requireEligible(
        organizationId,
        body.followerUserIds,
        'work.read',
        'WORK_FOLLOWER_NOT_ELIGIBLE',
        'followerUserIds',
      );
      assign('followerUserIds', body.followerUserIds);
    }
    const assigneeChanged =
      body.assigneeUserId !== undefined &&
      (body.assigneeUserId ?? null) !== (current.assigneeUserId ?? null);
    if (assigneeChanged && body.assigneeUserId) {
      await this.members.requireEligible(
        organizationId,
        [body.assigneeUserId],
        'work.update',
        'WORK_ASSIGNEE_NOT_ELIGIBLE',
        'assigneeUserId',
      );
    }
    const update: Record<string, unknown> = { $set: set, $inc: { revision: 1 } };
    if (assigneeChanged) {
      assign('assigneeUserId', body.assigneeUserId ?? null);
      if (body.assigneeUserId && body.followerUserIds === undefined) {
        update['$addToSet'] = { followerUserIds: body.assigneeUserId };
      }
    }

    const res = await this.tasks
      .updateOne({ _id: current._id, organizationId, revision: body.expectedRevision }, update)
      .exec();
    if (res.matchedCount !== 1) {
      staleRevision((await this.requireOwn(organizationId, taskId)).revision);
    }

    const base = { projectId: current.projectId, taskId, actorUserId: actor.userId };
    const entries: ActivityInput[] = [];
    const others = changed.filter((f) => !['assigneeUserId', 'dueDate'].includes(f));
    if (others.length > 0)
      entries.push({ ...base, kind: 'task.updated', data: { fields: others } });
    if (assigneeChanged) {
      entries.push(
        body.assigneeUserId
          ? {
              ...base,
              kind: 'task.assigned',
              data: { from: current.assigneeUserId ?? null, to: body.assigneeUserId },
            }
          : { ...base, kind: 'task.unassigned', data: { from: current.assigneeUserId ?? null } },
      );
    }
    if (body.dueDate !== undefined && body.dueDate !== (current.dueDate ?? null)) {
      entries.push({
        ...base,
        kind: 'task.due_changed',
        data: { from: current.dueDate ?? null, to: body.dueDate },
      });
    }
    await this.activity.record(organizationId, entries);
    if (assigneeChanged && body.assigneeUserId) {
      await this.notifyAssigned(
        organizationId,
        {
          id: taskId,
          projectId: current.projectId,
          number: current.number,
          title: body.title ?? current.title,
        },
        body.assigneeUserId,
        actor,
      );
    }
    return this.result(organizationId, taskId);
  }

  // ── Colonnes : déplacer, terminer, rouvrir ───────────────────────────────

  async move(
    organizationId: string,
    taskId: string,
    body: MoveWorkTaskBody,
    actor: WorkActor,
  ): Promise<WorkTaskWriteResult> {
    const { task: current, project } = await this.requireWritable(organizationId, taskId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const column = this.columnOf(project, body.columnKey);
    const rank =
      body.afterTaskId || body.beforeTaskId
        ? await this.rankNear(
            organizationId,
            current.projectId,
            column.key,
            {
              ...(body.afterTaskId ? { afterTaskId: body.afterTaskId } : {}),
              ...(body.beforeTaskId ? { beforeTaskId: body.beforeTaskId } : {}),
            },
            taskId,
          )
        : column.key === current.columnKey
          ? current.rank
          : await this.endRank(organizationId, current.projectId, column.key, taskId);
    return this.place(organizationId, project, current, column, rank, body.expectedRevision, actor);
  }

  async complete(
    organizationId: string,
    taskId: string,
    expectedRevision: number,
    actor: WorkActor,
  ): Promise<WorkTaskWriteResult> {
    const { task: current, project } = await this.requireWritable(organizationId, taskId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    if (current.done) return this.result(organizationId, taskId);
    const column = this.doneColumn(project);
    const rank = await this.endRank(organizationId, current.projectId, column.key, taskId);
    return this.place(organizationId, project, current, column, rank, expectedRevision, actor);
  }

  async reopen(
    organizationId: string,
    taskId: string,
    expectedRevision: number,
    actor: WorkActor,
  ): Promise<WorkTaskWriteResult> {
    const { task: current, project } = await this.requireWritable(organizationId, taskId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    if (!current.done) return this.result(organizationId, taskId);
    const column = this.firstTodo(project);
    const rank = await this.endRank(organizationId, current.projectId, column.key, taskId);
    return this.place(organizationId, project, current, column, rank, expectedRevision, actor);
  }

  private async place(
    organizationId: string,
    project: WorkProjectLean,
    current: WorkTaskLean,
    column: WorkColumn,
    rank: string,
    expectedRevision: number,
    actor: WorkActor,
  ): Promise<WorkTaskWriteResult> {
    const taskId = String(current._id);
    const fields = this.columnFields(current, column, actor);
    const res = await this.tasks
      .updateOne(
        { _id: current._id, organizationId, revision: expectedRevision },
        { $set: { ...fields, rank, updatedBy: actor.userId }, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1) {
      staleRevision((await this.requireOwn(organizationId, taskId)).revision);
    }
    const base = { projectId: current.projectId, taskId, actorUserId: actor.userId };
    const entries: ActivityInput[] = [];
    if (column.key !== current.columnKey) {
      entries.push({
        ...base,
        kind: 'task.moved',
        data: { from: current.columnKey, to: column.key },
      });
    }
    const nowDone = column.category === 'done';
    if (nowDone !== current.done) {
      entries.push({ ...base, kind: nowDone ? 'task.completed' : 'task.reopened' });
    }
    await this.activity.record(organizationId, entries);
    const suggestions =
      nowDone && !current.done && current.isMilestone
        ? await this.onMilestoneDone(organizationId, project, current, actor)
        : [];
    return this.result(organizationId, taskId, suggestions);
  }

  // ── Suppression ──────────────────────────────────────────────────────────

  /**
   * Refusée si la tâche ou ses sous-tâches portent du temps saisi
   * (`WORK_TASK_HAS_TIME`) ou une facture préparée (`WORK_TASK_HAS_INVOICE`).
   * Sinon : sous-tâches, commentaires, pièces jointes et saisies supprimées
   * partent avec elle ; elle est retirée des dépendances des autres.
   */
  async remove(organizationId: string, taskId: string, actor: WorkActor): Promise<void> {
    const { task: current } = await this.requireWritable(organizationId, taskId);
    const children = await this.tasks
      .find({ organizationId, parentTaskId: taskId }, { _id: 1, billing: 1 })
      .lean<{ _id: unknown; billing: unknown }[]>()
      .exec();
    const ids = [taskId, ...children.map((c) => String(c._id))];
    const time = await this.time
      .countDocuments({ organizationId, taskId: { $in: ids }, deletedAt: null })
      .exec();
    if (time > 0) {
      conflict(
        'WORK_TASK_HAS_TIME',
        'Du temps est saisi sur cette tâche ou ses sous-tâches : terminez-la plutôt.',
        { timeEntries: time },
      );
    }
    if (current.billing || children.some((c) => c.billing)) {
      conflict(
        'WORK_TASK_HAS_INVOICE',
        'Une facture a été préparée depuis cette tâche : terminez-la plutôt.',
      );
    }
    const attachments = await this.attachments
      .find({ organizationId, taskId: { $in: ids }, deletedAt: null }, { objectId: 1 })
      .lean<WorkAttachmentLean[]>()
      .exec();
    const now = new Date();
    await this.tasks.deleteMany({ organizationId, _id: { $in: ids.map(oid) } }).exec();
    await Promise.all([
      this.tasks
        .updateMany(
          { organizationId, 'blockedBy.taskId': { $in: ids } },
          { $pull: { blockedBy: { taskId: { $in: ids } } }, $inc: { revision: 1 } },
        )
        .exec(),
      this.comments.deleteMany({ organizationId, taskId: { $in: ids } }).exec(),
      this.attachments
        .updateMany(
          { organizationId, taskId: { $in: ids }, deletedAt: null },
          { $set: { deletedAt: now } },
        )
        .exec(),
      this.time.deleteMany({ organizationId, taskId: { $in: ids } }).exec(),
    ]);
    await dropAttachmentObjects(
      this.storage,
      attachments.map((a) => a.objectId),
      this.logger,
    );
    await this.activity.record(organizationId, {
      projectId: current.projectId,
      taskId,
      actorUserId: actor.userId,
      kind: 'task.deleted',
      data: {
        number: current.number,
        title: current.title.slice(0, 300),
        subtasks: children.length,
      },
    });
    await this.projects.touch(organizationId, current.projectId);
  }

  // ── Dépendances ──────────────────────────────────────────────────────────

  async addDependency(
    organizationId: string,
    taskId: string,
    predecessorTaskId: string,
    actor: WorkActor,
  ): Promise<WorkTaskWriteResult> {
    const { task: current } = await this.requireWritable(organizationId, taskId);
    const predecessor = await this.requireOwn(organizationId, predecessorTaskId);
    // Dépendances entre projets : refusées en R1 (décision ouverte n° 4).
    if (predecessor.projectId !== current.projectId) taskNotFound();
    if ((current.blockedBy ?? []).some((b) => b.taskId === predecessorTaskId)) {
      return this.result(organizationId, taskId);
    }
    if ((current.blockedBy ?? []).length >= WORK_LIMITS.dependenciesMax) {
      invalid(
        'predecessorTaskId',
        'INVALID_VALUE',
        `Une tâche attend au plus ${WORK_LIMITS.dependenciesMax} prédécesseurs.`,
      );
    }
    const graph = await this.tasks
      .find({ organizationId, projectId: current.projectId }, { blockedBy: 1 })
      .lean<{ _id: unknown; blockedBy: { taskId: string }[] }[]>()
      .exec();
    const cycle = detectCycle(
      graph.map((t) => ({ id: String(t._id), blockedBy: t.blockedBy ?? [] })),
      { taskId, predecessorTaskId },
    );
    if (cycle !== null) {
      conflict(
        'WORK_DEPENDENCY_CYCLE',
        'Cette dépendance fermerait une boucle : une tâche finirait par s’attendre elle-même.',
        { cycle },
      );
    }
    const res = await this.tasks
      .updateOne(
        {
          _id: current._id,
          organizationId,
          'blockedBy.taskId': { $ne: predecessorTaskId },
          [`blockedBy.${WORK_LIMITS.dependenciesMax - 1}`]: { $exists: false },
        },
        {
          $push: { blockedBy: { taskId: predecessorTaskId, type: 'finish_to_start' } },
          $set: { updatedBy: actor.userId },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.modifiedCount === 1) {
      await this.activity.record(organizationId, {
        projectId: current.projectId,
        taskId,
        actorUserId: actor.userId,
        kind: 'dependency.added',
        data: { predecessorTaskId, predecessorNumber: predecessor.number },
      });
    }
    return this.result(organizationId, taskId);
  }

  async removeDependency(
    organizationId: string,
    taskId: string,
    predecessorTaskId: string,
    actor: WorkActor,
  ): Promise<WorkTaskWriteResult> {
    const { task: current } = await this.requireWritable(organizationId, taskId);
    if (!(current.blockedBy ?? []).some((b) => b.taskId === predecessorTaskId)) taskNotFound();
    const res = await this.tasks
      .updateOne(
        { _id: current._id, organizationId },
        {
          $pull: { blockedBy: { taskId: predecessorTaskId } },
          $set: { updatedBy: actor.userId },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.modifiedCount === 1) {
      await this.activity.record(organizationId, {
        projectId: current.projectId,
        taskId,
        actorUserId: actor.userId,
        kind: 'dependency.removed',
        data: { predecessorTaskId },
      });
    }
    return this.result(organizationId, taskId);
  }

  // ── Abonnés ──────────────────────────────────────────────────────────────

  /** Ajoute des abonnés (auteur d'un commentaire, mentionnés) dans la limite de 20. */
  async addFollowers(
    organizationId: string,
    task: WorkTaskLean,
    userIds: readonly string[],
  ): Promise<void> {
    const current = task.followerUserIds ?? [];
    const next = [...new Set([...current, ...userIds])].slice(0, WORK_LIMITS.followersMax);
    if (next.length === current.length) return;
    await this.tasks
      .updateOne(
        { _id: task._id, organizationId },
        { $set: { followerUserIds: next } },
        { timestamps: false },
      )
      .exec();
  }
}
