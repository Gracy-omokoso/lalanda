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

import { taskAbsences, type WorkTaskAbsence } from '@lalanda/engine';
import {
  WORK_LIMITS,
  addDays,
  dependencyConflicts,
  detectCycle,
  dueSoonEnd,
  groupMyTasks,
  isBlocked,
  formatDayTime,
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
  type WorkAbsenceFindingView,
  type WorkCardColor,
  type WorkTaskWriteResult,
  type WorkWarning,
  // ADR-0076 : rôles, collaboration, validation.
  WORK_COLLAB_LIMITS,
  taskRights,
  type WorkProjectRights,
  type WorkTaskApprovalSummary,
  type WorkTaskMyRights,
  type WorkTaskRights,
} from '@lalanda/shared/work';
import { MY_TASKS_MAX_PER_SOURCE, type CrmMyTaskItem } from '@lalanda/shared/crm';
import { PURCHASES_AGENDA_MAX, type PurchasesMyTaskItem } from '@lalanda/shared/purchases';
import { HR_LIMITS, type HrMyTaskItem } from '@lalanda/shared/hr';
import { STOCK_LIMITS, type StockMyTaskItem } from '@lalanda/shared/stock';
import type { AssetsMyTaskItem } from '@lalanda/shared/assets';
// ADR-0050 — V6
import {
  SALES_CONTRACTS_AGENDA_MAX,
  type SalesContractMyTaskItem,
} from '@lalanda/shared/sales-contracts';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { beforeTimeCursor, decodeTimeCursor, encodeTimeCursor } from '../crm/time-cursor.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { WorkClockService } from './work-clock.service.js';
import {
  actorCan,
  checkFinalDates,
  conflict,
  finalTimes,
  forbidden,
  invalid,
  invalidCursor,
  iso,
  isWorkId,
  oid,
  projectArchived,
  staleRevision,
  taskHref,
  taskNotFound,
  type WorkActor,
} from './work.common.js';
import {
  ASSETS_AGENDA_SOURCE,
  CRM_AGENDA_SOURCE,
  HR_AGENDA_SOURCE,
  PURCHASES_AGENDA_SOURCE,
  SALES_CONTRACTS_AGENDA_SOURCE,
  STOCK_AGENDA_SOURCE,
  // ADR-0077 § 4.6
  WORK_TIMESHEET_AGENDA_SOURCE,
  noTimesheetAgenda,
  type TimesheetAgendaReader,
  noAssetsAgenda,
  noCrmAgenda,
  noHrAgenda,
  noPurchasesAgenda,
  noSalesContractsAgenda,
  noStockAgenda,
  type AssetsAgendaReader,
  type CrmAgendaReader,
  type HrAgendaReader,
  type PurchasesAgendaReader,
  type SalesContractsAgendaReader,
  type StockAgendaReader,
} from './my-tasks.ports.js';
import { isSelfAssignOnlyRole, projectIdFilter } from './work-access.js';
import { WorkAccessService } from './work-access.service.js';
import { WorkActivityService, type ActivityInput } from './work-activity.service.js';
import { WORK_ABSENCES_SOURCE, type WorkAbsencesSource } from './work-absences.port.js';
import { dropAttachmentObjects } from './work-attachments.storage.js';
import { WorkMembersService } from './work-members.service.js';
import { WorkNotifier, type WorkAssignmentBatch } from './work-notifier.js';
import { WorkProjectMembersService } from './work-project-members.service.js';
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
  /** ADR-0045 — H5 : badge et constat d'échéance par tâche ; `null` sans module RH. */
  absences: Map<string, WorkTaskAbsence> | null;
}

/** ADR-0076 : tâches lues au plus par section « Je collabore » et « À valider ». */
const MY_TASKS_SECTION_MAX = 200;

/** ADR-0045 — H5 : constats d'absence lus au plus dans « Mes tâches » du créateur. */
const ABSENCE_FINDINGS_MAX = 200;

/**
 * ADR-0066 § 2 : un rôle « assignation à soi seulement » (`isSelfAssignOnlyRole`, liste
 * `SELF_ASSIGN_ONLY_ROLES`) n'assigne qu'à lui-même ou laisse sans responsable, et ne
 * retire ni ne remplace le responsable d'une tâche qui n'est pas la sienne.
 */
export function assertSelfAssignment(
  actor: WorkActor,
  from: string | null,
  to: string | null,
): void {
  if (!isSelfAssignOnlyRole(actor.role)) return;
  if ((to !== null && to !== actor.userId) || (from !== null && from !== actor.userId)) {
    forbidden(
      'WORK_ASSIGN_SELF_ONLY',
      'Votre rôle permet de vous assigner une tâche, ou de la laisser sans responsable, mais pas de l’assigner à quelqu’un d’autre ni de réassigner la tâche d’un collègue.',
    );
  }
}

/** ADR-0076 § 3 : résumé de validation d'une tâche (`null` : sans validation). */
export function approvalSummaryOf(
  d: Pick<WorkTaskLean, 'approval'>,
): WorkTaskApprovalSummary | null {
  const a = d.approval;
  if (!a || (!a.required && a.state === 'none')) return null;
  return {
    required: a.required,
    state: a.state,
    approverUserId: a.approverUserId ?? null,
    pendingApproverUserId: a.pendingApproverUserId ?? null,
  };
}

/** ADR-0076 § 3 : validateur effectif — désigné, sinon chef, sinon adjoint. */
export function effectiveApprover(
  task: Pick<WorkTaskLean, 'approval'>,
  project: Pick<WorkProjectLean, 'ownerUserId' | 'deputyUserId'>,
): string | null {
  return task.approval?.approverUserId ?? project.ownerUserId ?? project.deputyUserId ?? null;
}

/** ADR-0076 § 2 : 403 hors des droits de modification d'une tâche. */
export function assertCanEdit(rights: WorkTaskRights): void {
  if (!rights.canEdit) {
    forbidden(
      'WORK_TASK_EDIT_FORBIDDEN',
      'Vous ne pouvez modifier que les tâches dont vous êtes responsable ou collaborateur : demandez au chef de projet de vous y associer.',
    );
  }
}

/** ADR-0076 § 2 : 403 hors des droits d'achèvement (terminer, rouvrir). */
export function assertCanComplete(rights: WorkTaskRights): void {
  if (!rights.canComplete) {
    forbidden(
      'WORK_TASK_COMPLETE_FORBIDDEN',
      'Seuls le responsable de la tâche, le chef de projet et son adjoint peuvent la terminer ou la rouvrir.',
    );
  }
}

/** ADR-0076 § 3 : une tâche « à valider » ne passe à « terminé » que par l'approbation. */
export function assertNoPendingApproval(task: Pick<WorkTaskLean, 'approval'>): void {
  if (task.approval?.required && task.approval.state !== 'approved') {
    conflict(
      'WORK_TASK_APPROVAL_REQUIRED',
      'Cette tâche est à valider : soumettez-la au validateur, elle sera terminée à son approbation.',
    );
  }
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
    // ADR-0060 § 5 : portée de l'appelant (projets privés).
    @Inject(WorkAccessService) private readonly access: WorkAccessService,
    // ADR-0066 § 3 : l'assigné d'un projet qu'il ne voit pas en devient membre direct.
    @Inject(WorkProjectMembersService) private readonly projectMembers: WorkProjectMembersService,
    // ADR-0080 : fuseau de l'organisation (« aujourd'hui », heures).
    @Inject(WorkClockService) private readonly clock: WorkClockService,
    // ADR-0040 — C4 : relances CRM, facultatives (tests, module absent).
    @Optional() @Inject(CRM_AGENDA_SOURCE) crmAgenda: CrmAgendaReader | null = null,
    // ADR-0044 — P3 (§ 6.5) : approbations d'achat, facultatives (tests, module absent).
    @Optional()
    @Inject(PURCHASES_AGENDA_SOURCE)
    purchasesAgenda: PurchasesAgendaReader | null = null,
    // ADR-0045 — H3 (§ 6.1) : validations d'absence, éléments de liste RH (facultatifs).
    @Optional() @Inject(HR_AGENDA_SOURCE) hrAgenda: HrAgendaReader | null = null,
    // ADR-0045 — H5 (§ 6.2) : absences approuvées des assignés, lecture seule (facultatif).
    @Optional() @Inject(WORK_ABSENCES_SOURCE) absences: WorkAbsencesSource | null = null,
    // ADR-0046 — S7 (§ 6.7) : inventaires, « À traiter », maintenances (facultatifs).
    @Optional() @Inject(STOCK_AGENDA_SOURCE) stockAgenda: StockAgendaReader | null = null,
    @Optional() @Inject(ASSETS_AGENDA_SOURCE) assetsAgenda: AssetsAgendaReader | null = null,
    // ADR-0050 — V6 (§ 6) : alertes des contrats et abonnements (facultatives).
    @Optional()
    @Inject(SALES_CONTRACTS_AGENDA_SOURCE)
    salesContractsAgenda: SalesContractsAgendaReader | null = null,
    // ADR-0077 § 4.6 : semaines de temps à valider (facultatif).
    @Optional()
    @Inject(WORK_TIMESHEET_AGENDA_SOURCE)
    timesheetAgenda: TimesheetAgendaReader | null = null,
  ) {
    this.crmAgenda = crmAgenda ?? noCrmAgenda;
    this.purchasesAgenda = purchasesAgenda ?? noPurchasesAgenda;
    this.hrAgenda = hrAgenda ?? noHrAgenda;
    this.stockAgenda = stockAgenda ?? noStockAgenda;
    this.assetsAgenda = assetsAgenda ?? noAssetsAgenda;
    this.salesContractsAgenda = salesContractsAgenda ?? noSalesContractsAgenda;
    this.timesheetAgenda = timesheetAgenda ?? noTimesheetAgenda;
    this.absenceSource = absences;
  }

  private readonly absenceSource: WorkAbsencesSource | null;

  private readonly crmAgenda: CrmAgendaReader;
  private readonly purchasesAgenda: PurchasesAgendaReader;
  private readonly hrAgenda: HrAgendaReader;
  private readonly stockAgenda: StockAgendaReader;
  private readonly assetsAgenda: AssetsAgendaReader;
  private readonly salesContractsAgenda: SalesContractsAgendaReader;
  private readonly timesheetAgenda: TimesheetAgendaReader;

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

  // ── Droits dans le projet (ADR-0076) ──────────────────────────────────────

  /** Droits de l'appelant sur le projet (rôle dans le projet, plafond d'organisation). */
  async projectRightsOf(
    organizationId: string,
    project: WorkProjectLean,
    actor: WorkActor,
  ): Promise<WorkProjectRights> {
    return this.access.rightsOn(organizationId, project, actor);
  }

  /**
   * ADR-0076 § 1 : import et plans — aucun responsable Lecteur du projet, vérifié AVANT
   * toute écriture (400 `WORK_ASSIGNEE_VIEWER`).
   */
  async assertPlanAssignees(
    organizationId: string,
    projectId: string,
    assigneeUserIds: readonly (string | null)[],
  ): Promise<void> {
    const ids = [...new Set(assigneeUserIds.filter((u): u is string => !!u))];
    await this.assertNotViewers(
      organizationId,
      projectId,
      ids,
      'assigneeUserId',
      'WORK_ASSIGNEE_VIEWER',
    );
  }

  /** ADR-0076 § 1 : 403 si l'appelant est Lecteur du projet (import de tâches). */
  async assertCanCreateTasks(
    organizationId: string,
    projectId: string,
    actor: WorkActor,
  ): Promise<void> {
    const project = await this.projects.requireOwn(organizationId, projectId);
    if (!(await this.projectRightsOf(organizationId, project, actor)).canCreateTasks) {
      forbidden(
        'WORK_TASK_CREATE_FORBIDDEN',
        'Vous êtes Lecteur de ce projet : vous pouvez lire et commenter, pas créer de tâche.',
      );
    }
  }

  /** ADR-0076 § 1 : 403 si l'appelant est Lecteur du projet de la tâche (saisie de temps). */
  async assertCanLogTime(organizationId: string, taskId: string, actor: WorkActor): Promise<void> {
    if (!isWorkId(taskId)) return; // le service du temps répondra 404
    const task = await this.tasks
      .findOne({ _id: oid(taskId), organizationId }, { projectId: 1 })
      .lean<{ projectId: string }>()
      .exec();
    if (!task) return;
    const project = await this.projects.requireOwn(organizationId, task.projectId);
    if (!(await this.projectRightsOf(organizationId, project, actor)).canLogTime) {
      forbidden(
        'WORK_TASK_CREATE_FORBIDDEN',
        'Vous êtes Lecteur de ce projet : vous ne saisissez pas de temps.',
      );
    }
  }

  /** Droits de l'appelant sur une tâche (responsable de la parente lu au besoin). */
  async taskRightsOf(
    organizationId: string,
    project: WorkProjectLean,
    task: WorkTaskLean,
    actor: WorkActor,
    rights?: WorkProjectRights,
  ): Promise<WorkTaskRights & { project: WorkProjectRights }> {
    const pr = rights ?? (await this.projectRightsOf(organizationId, project, actor));
    const parent =
      task.parentTaskId && !task.assigneeUserId && isWorkId(task.parentTaskId)
        ? await this.tasks
            .findOne({ _id: oid(task.parentTaskId), organizationId }, { assigneeUserId: 1 })
            .lean<{ assigneeUserId: string | null }>()
            .exec()
        : null;
    return {
      ...taskRights({
        userId: actor.userId,
        project: pr,
        task: {
          assigneeUserId: task.assigneeUserId ?? null,
          collaboratorUserIds: task.collaboratorUserIds ?? [],
          createdBy: task.createdBy ?? null,
        },
        parent: parent ? { assigneeUserId: parent.assigneeUserId ?? null } : null,
      }),
      project: pr,
    };
  }

  /**
   * ADR-0076 § 1 et § 2 : responsable, collaborateur ou validateur — pas un Lecteur du
   * projet (400 `code` sur `path`).
   */
  private async assertNotViewers(
    organizationId: string,
    projectId: string,
    userIds: readonly string[],
    path: string,
    code: string,
  ): Promise<void> {
    if (userIds.length === 0) return;
    const audience = await this.projectMembers.audienceOf(organizationId, projectId);
    if (userIds.some((u) => audience.roles?.get(u) === 'viewer')) {
      invalid(
        path,
        code,
        'Cette personne est Lecteur du projet : elle lit et commente, mais ne peut pas porter une tâche.',
      );
    }
  }

  /**
   * ADR-0076 § 2 : collaborateurs — `work.update`, voient le projet, pas Lecteur ; le
   * Stagiaire ne s'ajoute ou ne se retire que lui-même.
   */
  private async checkCollaborators(
    organizationId: string,
    projectId: string,
    from: readonly string[],
    to: readonly string[],
    actor: WorkActor,
  ): Promise<void> {
    const added = to.filter((u) => !from.includes(u));
    const removed = from.filter((u) => !to.includes(u));
    if (
      isSelfAssignOnlyRole(actor.role) &&
      [...added, ...removed].some((u) => u !== actor.userId)
    ) {
      forbidden(
        'WORK_ASSIGN_SELF_ONLY',
        'Votre rôle permet de vous ajouter comme collaborateur, ou de vous retirer, mais pas d’y associer quelqu’un d’autre.',
      );
    }
    if (added.length === 0) return;
    await this.members.requireEligible(
      organizationId,
      added,
      'work.update',
      'WORK_COLLABORATOR_NOT_ELIGIBLE',
      'collaboratorUserIds',
    );
    for (const u of added) {
      if (!(await this.assigneeSees(organizationId, projectId, u))) {
        invalid(
          'collaboratorUserIds',
          'WORK_COLLABORATOR_NOT_ELIGIBLE',
          'Cette personne ne voit pas ce projet : ajoutez-la d’abord aux membres du projet.',
        );
      }
    }
    await this.assertNotViewers(
      organizationId,
      projectId,
      added,
      'collaboratorUserIds',
      'WORK_COLLABORATOR_NOT_ELIGIBLE',
    );
  }

  /**
   * ADR-0076 § 3 : réglage « à valider » — gestion du projet seulement ; un validateur
   * possible (désigné, chef ou adjoint) ; le validateur désigné porte une tâche.
   */
  private async checkApprovalSetting(
    organizationId: string,
    project: WorkProjectLean,
    approval: { required: boolean; approverUserId?: string | null },
    rights: WorkProjectRights,
  ): Promise<void> {
    if (!rights.canManage) {
      forbidden(
        'WORK_PROJECT_MANAGE_FORBIDDEN',
        'Seuls le chef de projet, son adjoint et les gestionnaires règlent la validation d’une tâche.',
      );
    }
    const designated = approval.approverUserId ?? null;
    if (designated) {
      await this.members.requireEligible(
        organizationId,
        [designated],
        'work.update',
        'WORK_APPROVER_REQUIRED',
        'approval.approverUserId',
      );
      if (!(await this.assigneeSees(organizationId, String(project._id), designated))) {
        invalid(
          'approval.approverUserId',
          'WORK_APPROVER_REQUIRED',
          'Le validateur doit voir ce projet.',
        );
      }
      await this.assertNotViewers(
        organizationId,
        String(project._id),
        [designated],
        'approval.approverUserId',
        'WORK_APPROVER_REQUIRED',
      );
    }
    if (approval.required && !designated && !project.ownerUserId && !project.deputyUserId) {
      invalid(
        'approval.approverUserId',
        'WORK_APPROVER_REQUIRED',
        'Ce projet n’a ni chef ni adjoint : désignez le validateur de la tâche.',
      );
    }
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
      absences: await this.absencesFor(organizationId, docs),
    };
  }

  /**
   * ADR-0045 — H5 (§ 6.2) : absences APPROUVÉES des assignés, lues par le port (jamais
   * le type), puis badge et constat d'échéance décidés par le moteur au jour de
   * Kinshasa. Lecture seule : rien n'est déplacé ni réassigné.
   */
  private async absencesFor(
    organizationId: string,
    docs: readonly WorkTaskLean[],
    now = new Date(),
  ): Promise<Map<string, WorkTaskAbsence> | null> {
    if (this.absenceSource === null) return null;
    const users = [...new Set(docs.map((d) => d.assigneeUserId).filter((u): u is string => !!u))];
    if (users.length === 0) return new Map();
    const { today } = await this.clock.clockOf(organizationId, now);
    let from = today;
    let to = today;
    for (const d of docs) {
      if (!d.dueDate || !d.assigneeUserId) continue;
      if (d.dueDate < from) from = d.dueDate;
      if (d.dueDate > to) to = d.dueDate;
    }
    const rows = await this.absenceSource.absencesOf(organizationId, users, from, to);
    const result = taskAbsences(
      docs.map((d) => ({
        id: String(d._id),
        assigneeUserId: d.assigneeUserId ?? null,
        dueDate: d.dueDate ?? null,
        done: d.done,
      })),
      rows.map((r) => ({ userId: r.userId, startDate: r.start.date, endDate: r.end.date })),
      today,
    );
    return new Map(result.map((r) => [r.taskId, r]));
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
      // ADR-0080 : heures facultatives (fuseau de l'organisation).
      startTime: d.startTime ?? null,
      dueTime: d.dueTime ?? null,
      isMilestone: d.isMilestone,
      blockedBy,
      blocked: isBlocked({ blockedBy }, ctx.doneById),
      loggedMinutes: d.loggedMinutes ?? 0,
      estimateMinutes: d.estimateMinutes ?? null,
      color: (d.color ?? null) as WorkCardColor | null,
      subtaskCount: sub?.total ?? 0,
      doneSubtaskCount: sub?.done ?? 0,
      revision: d.revision,
      updatedAt: new Date(d.updatedAt).toISOString(),
      // ADR-0076 : collaborateurs, liste de contrôle, validation, créateur.
      collaboratorUserIds: d.collaboratorUserIds ?? [],
      checklistDone: (d.checklist ?? []).filter((c) => c.done).length,
      checklistTotal: (d.checklist ?? []).length,
      approval: approvalSummaryOf(d),
      createdBy: d.createdBy,
      // ADR-0078 : visibilité client, validation client, consultant responsable.
      clientVisible: d.clientVisible === true,
      clientApprovalState: d.clientApproval?.required ? d.clientApproval.state : 'none',
      consultantAssigneeId: d.consultantAssigneeId ?? null,
      // ADR-0045 — H5 (§ 6.2) : présent seulement avec le module RH.
      ...(ctx.absences === null
        ? {}
        : {
            assigneeAbsence: ctx.absences.get(id)?.assigneeAbsence ?? null,
            dueDateAbsence: ctx.absences.get(id)?.dueDateAbsence ?? null,
          }),
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
    // ADR-0060 § 5 : tâches des projets privés hors portée exclues (calendrier, recherche).
    const visible = projectIdFilter(await this.access.scopeOf(organizationId, actor));
    if (Object.keys(visible).length > 0) and.push(visible);
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
   *
   * ADR-0045 — H3 (§ 6.1) : et les demandes d'absence que l'appelant peut traiter
   * (manager désigné ou `leave.approve`, séparation des tâches appliquée), plus les
   * éléments de liste RH qui lui sont assignés ; 200 au plus.
   *
   * ADR-0046 — S7 (§ 6.7) : et, avec `stock.read`, les inventaires à compter
   * (`stock.count`, compteur assigné) ou à valider (`stock.manage`, validateur éligible)
   * et les lignes « À traiter » regroupées (`stock.move`) ; avec `assets.read`, les
   * maintenances dues dont il est responsable. 200 au plus chacun, sans case à cocher.
   */
  async myTasks(organizationId: string, actor: WorkActor, now = new Date()): Promise<MyTasksView> {
    const archived = await this.projects.archivedIds(organizationId);
    const filter: Record<string, unknown> = {
      organizationId,
      assigneeUserId: actor.userId,
      done: false,
    };
    if (archived.length > 0) filter['projectId'] = { $nin: archived };
    // ADR-0060 § 5 : une tâche assignée dans un projet devenu invisible (retiré de
    // l'équipe, projet passé en privé) disparaît de « Mes tâches ».
    const visible = projectIdFilter(await this.access.scopeOf(organizationId, actor));
    if (Object.keys(visible).length > 0) {
      filter['$and'] = [visible];
    }
    // ADR-0041 § 9.4 (A3) : un retrait de `crm.read` masque les relances CRM.
    const crmVisible = actorCan(actor, 'crm.read');
    // ADR-0044 — P3 (§ 6.5) : approbations d'achat, pour les détenteurs EFFECTIFS de
    // `purchase.approve` seulement.
    const approvalsVisible = actorCan(actor, 'purchase.approve');
    // ADR-0045 — H3 : la relation de manager suffit ; tout membre est interrogé.
    const hrVisible = actorCan(actor, 'analytics.read');
    // ADR-0046 — S7 : chaque source derrière sa lecture ; les droits utiles sont passés.
    const stockVisible = actorCan(actor, 'stock.read');
    const assetsVisible = actorCan(actor, 'assets.read');
    // ADR-0050 — V6 : derrière `sales.read` ; l'audience de chaque élément suit les droits passés.
    const salesContractsVisible = actorCan(actor, 'sales.read');
    const [docs, crm, purchases, hr, stock, assets, salesContracts] = await Promise.all([
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
      hrVisible
        ? this.hrAgenda.agendaOf(
            organizationId,
            {
              userId: actor.userId,
              holdsLeaveApprove: actorCan(actor, 'leave.approve'),
              seesConfidential: actorCan(actor, 'hr.sensitive.read'),
              // ADR-0051 — H14 (§ 7.5) : frais, avances, corrections de pointage.
              holdsExpensesApprove: actorCan(actor, 'expenses.approve'),
              holdsPayablesPay: actorCan(actor, 'payables.pay'),
              holdsHrManage: actorCan(actor, 'hr.manage'),
            },
            HR_LIMITS.agendaItemsMax,
          )
        : Promise.resolve({ items: [] as HrMyTaskItem[], truncated: false }),
      stockVisible
        ? this.stockAgenda.agendaOf(
            organizationId,
            {
              userId: actor.userId,
              holdsCount: actorCan(actor, 'stock.count'),
              holdsManage: actorCan(actor, 'stock.manage'),
              holdsMove: actorCan(actor, 'stock.move'),
            },
            STOCK_LIMITS.agendaMax,
          )
        : Promise.resolve({ items: [] as StockMyTaskItem[], truncated: false }),
      assetsVisible
        ? this.assetsAgenda.agendaOf(
            organizationId,
            { userId: actor.userId, holdsManage: actorCan(actor, 'assets.manage') },
            STOCK_LIMITS.agendaMax,
            now,
          )
        : Promise.resolve({ items: [] as AssetsMyTaskItem[], truncated: false }),
      salesContractsVisible
        ? this.salesContractsAgenda.agendaOf(
            organizationId,
            {
              userId: actor.userId,
              holdsApprove: actorCan(actor, 'sales.contract.approve'),
              holdsInvoice: actorCan(actor, 'sales.invoice'),
              holdsManage: actorCan(actor, 'sales.manage'),
            },
            SALES_CONTRACTS_AGENDA_MAX,
            now,
          )
        : Promise.resolve({ items: [] as SalesContractMyTaskItem[], truncated: false }),
    ]);
    // ADR-0077 § 4.6 : la relation de manager suffit ; l'audience est jugée par la source.
    const timesheets = await this.timesheetAgenda.agendaOf(
      organizationId,
      actor,
      MY_TASKS_MAX_PER_SOURCE,
    );
    const workTruncated = docs.length > MY_TASKS_MAX_PER_SOURCE;
    // ADR-0076 § 2 et § 3 : « Je collabore » et « À valider », mêmes projets visibles.
    const sectionFilter = (extra: Record<string, unknown>): Record<string, unknown> => ({
      organizationId,
      ...extra,
      ...(archived.length > 0 ? { projectId: { $nin: archived } } : {}),
      ...(Object.keys(visible).length > 0 ? { $and: [visible] } : {}),
    });
    const [collabDocs, approveDocs] = await Promise.all([
      this.tasks
        .find(
          sectionFilter({
            collaboratorUserIds: actor.userId,
            assigneeUserId: { $ne: actor.userId },
            done: false,
          }),
          LIGHT,
        )
        .sort({ dueDate: 1, _id: 1 })
        .limit(MY_TASKS_SECTION_MAX)
        .lean<WorkTaskLean[]>()
        .exec(),
      this.tasks
        .find(
          sectionFilter({
            'approval.pendingApproverUserId': actor.userId,
            'approval.state': 'pending',
          }),
          LIGHT,
        )
        .sort({ 'approval.submittedAt': 1, _id: 1 })
        .limit(MY_TASKS_SECTION_MAX)
        .lean<WorkTaskLean[]>()
        .exec(),
    ]);
    const [collaborating, toApprove] = await Promise.all([
      this.withProjectNames(organizationId, collabDocs),
      this.withProjectNames(organizationId, approveDocs),
    ]);
    const work = await this.withProjectNames(
      organizationId,
      docs.slice(0, MY_TASKS_MAX_PER_SOURCE),
    );
    const items: MyTaskEntry[] = [
      ...work.map((t) => ({ ...t, source: 'work' as const })),
      ...crm.items,
      ...purchases.items,
      ...hr.items,
      ...stock.items,
      ...assets.items,
      ...salesContracts.items,
      ...timesheets.items,
    ];
    // ADR-0080 : jour ET heure dans le fuseau de l'organisation.
    const clock = await this.clock.clockOf(organizationId, now);
    const today = clock.today;
    const { dueSoonDays, workingDays } = await this.settings.get(organizationId);
    // ADR-0061 § 3 : la fenêtre « échéance proche » compte des jours OUVRÉS ; convertie
    // en jours calendaires pour le regroupement (vendredi + 1 jour ouvré → lundi).
    const soonEnd = dueSoonEnd(today, dueSoonDays, workingDays);
    const calendarSpan = Math.round(
      (Date.parse(`${soonEnd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
    );
    const groups = groupMyTasks(items, today, calendarSpan, clock.time);
    return {
      asOf: today,
      asOfTime: clock.time,
      timeZone: clock.timeZone,
      ...groups,
      truncated:
        workTruncated ||
        crm.truncated ||
        purchases.truncated ||
        hr.truncated ||
        stock.truncated ||
        assets.truncated ||
        salesContracts.truncated ||
        timesheets.truncated,
      collaborating,
      toApprove,
      // ADR-0045 — H5 (§ 6.2) : constats d'absence des tâches que l'appelant a créées.
      ...(this.absenceSource === null
        ? {}
        : {
            absenceFindings: await this.absenceFindingsOf(
              organizationId,
              actor,
              archived,
              today,
              visible,
            ),
          }),
    };
  }

  /**
   * ADR-0045 — H5 (§ 6.2) : tâches non terminées créées par l'appelant, assignées à un
   * autre membre, à échéance aujourd'hui ou plus tard, dont l'échéance tombe pendant
   * une absence approuvée de l'assigné (`ASSIGNEE_ABSENT_ON_DUE_DATE`).
   */
  private async absenceFindingsOf(
    organizationId: string,
    actor: WorkActor,
    archived: readonly string[],
    today: string,
    visible: Record<string, unknown>,
  ): Promise<WorkAbsenceFindingView[]> {
    const filter: Record<string, unknown> = {
      organizationId,
      createdBy: actor.userId,
      done: false,
      assigneeUserId: { $nin: [null, actor.userId] },
      dueDate: { $ne: null, $gte: today, $lte: addDays(today, 366) },
    };
    if (archived.length > 0) filter['projectId'] = { $nin: [...archived] };
    // ADR-0060 § 5 : mêmes projets visibles que « Mes tâches ».
    if (Object.keys(visible).length > 0) filter['$and'] = [visible];
    const docs = await this.tasks
      .find(filter, LIGHT)
      .sort({ dueDate: 1, _id: 1 })
      .limit(ABSENCE_FINDINGS_MAX)
      .lean<WorkTaskLean[]>()
      .exec();
    const items = await this.withProjectNames(organizationId, docs);
    return items.flatMap((t) =>
      t.dueDateAbsence && t.assignee && t.dueDate
        ? [
            {
              code: 'ASSIGNEE_ABSENT_ON_DUE_DATE' as const,
              taskId: t.id,
              projectId: t.projectId,
              projectName: t.projectName,
              number: t.number,
              title: t.title,
              dueDate: t.dueDate,
              assignee: t.assignee,
              absence: t.dueDateAbsence,
            },
          ]
        : [],
    );
  }

  async detail(organizationId: string, taskId: string, actor?: WorkActor): Promise<WorkTaskDetail> {
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
    const a = doc.approval ?? null;
    const [views, followers, rights] = await Promise.all([
      this.views(organizationId, [doc, ...subDocs], [project]),
      // ADR-0076 : abonnés, collaborateurs, auteurs de la liste et de la validation.
      this.members.refs([
        ...(doc.followerUserIds ?? []),
        ...(doc.collaboratorUserIds ?? []),
        ...(doc.checklist ?? []).map((c) => c.doneBy),
        a?.approverUserId,
        a?.pendingApproverUserId,
        a?.submittedBy,
        a?.decidedBy,
        project.ownerUserId,
        project.deputyUserId,
      ]),
      actor ? this.taskRightsOf(organizationId, project, doc, actor) : null,
    ]);
    const ref = (u: string | null | undefined) =>
      u ? WorkMembersService.refOf(followers, u) : null;
    const summary = approvalSummaryOf(doc);
    const myRights: WorkTaskMyRights | undefined =
      rights && actor
        ? {
            canEdit: rights.canEdit,
            canComplete: rights.canComplete,
            canCheck: rights.canCheck,
            canManage: rights.project.canManage,
            canSubmit:
              !!a?.required &&
              !doc.done &&
              ['none', 'changes_requested', 'rejected'].includes(a.state) &&
              (doc.assigneeUserId === actor.userId || rights.project.canManage),
            canDecide:
              !!a?.required &&
              a.state === 'pending' &&
              a.submittedBy !== actor.userId &&
              (a.pendingApproverUserId === actor.userId || rights.project.canManage),
          }
        : undefined;
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
      collaborators: (doc.collaboratorUserIds ?? []).map((u) =>
        WorkMembersService.refOf(followers, u),
      ),
      checklist: (doc.checklist ?? []).map((c) => ({
        id: c.id,
        text: c.text,
        done: c.done,
        doneBy: ref(c.doneBy),
        doneAt: iso(c.doneAt),
      })),
      approvalDetail:
        summary && a
          ? {
              ...summary,
              approver: ref(a.approverUserId),
              pendingApprover: ref(
                a.pendingApproverUserId ??
                  (a.state === 'pending' ? null : effectiveApprover(doc, project)),
              ),
              submittedBy: ref(a.submittedBy),
              submittedAt: iso(a.submittedAt),
              decidedBy: ref(a.decidedBy),
              decidedAt: iso(a.decidedAt),
              reason: a.reason ?? null,
            }
          : null,
      ...(myRights ? { myRights } : {}),
      ...(actor ? { following: (doc.followerUserIds ?? []).includes(actor.userId) } : {}),
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
      .find(
        { organizationId, projectId },
        { blockedBy: 1, startDate: 1, dueDate: 1, startTime: 1, dueTime: 1 },
      )
      .lean<
        {
          _id: unknown;
          blockedBy: { taskId: string }[];
          startDate: string | null;
          dueDate: string | null;
          startTime?: string | null;
          dueTime?: string | null;
        }[]
      >()
      .exec();
    return dependencyConflicts(
      docs.map((d) => ({
        id: String(d._id),
        blockedBy: d.blockedBy ?? [],
        startDate: d.startDate ?? null,
        dueDate: d.dueDate ?? null,
        startTime: d.startTime ?? null,
        dueTime: d.dueTime ?? null,
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
    // ADR-0064 § 3 : le canal Slack du projet voit toute assignation, auto-assignation comprise.
    this.notifier.channelEvent({
      organizationId,
      projectId: task.projectId,
      eventLabel: 'Tâche assignée',
      title: `#${task.number} ${task.title} — assignée par ${await this.actorName(actor)}`,
      href: taskHref(task.projectId, task.id),
    });
    // ADR-0079 § 1 : l'auto-assignation n'est notifiée que si la personne l'a demandé
    // (« Me notifier aussi de mes propres actions ») — le notifier en décide.
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

  // ── Assigné et visibilité du projet (ADR-0066 § 3) ───────────────────────

  /** Le membre `userId` voit-il ce projet (visibilité, rôle limité, équipes) ? */
  async assigneeSees(organizationId: string, projectId: string, userId: string): Promise<boolean> {
    const m = await this.members.permissionsOf(organizationId, userId);
    if (m === undefined) return false;
    return this.access.userSees(organizationId, userId, m.role, m.context, projectId);
  }

  /**
   * Un responsable doit voir le projet de sa tâche. S'il ne le voit pas (projet privé
   * dont il n'est pas membre, Invité externe hors du projet) : un gestionnaire
   * (`work.manage`) l'AJOUTE comme membre direct (historique et notification « ajouté
   * au projet ») ; sinon `400 WORK_ASSIGNEE_NOT_MEMBER`. Le refus est rendu AVANT toute
   * écriture ; l'ajout suit l'écriture de la tâche (`addAssigneeAsMember`).
   */
  private async membershipNeeded(
    organizationId: string,
    projectId: string,
    assigneeUserId: string,
    actor: WorkActor,
  ): Promise<boolean> {
    if (await this.assigneeSees(organizationId, projectId, assigneeUserId)) return false;
    if (!actorCan(actor, 'work.manage')) {
      invalid(
        'assigneeUserId',
        'WORK_ASSIGNEE_NOT_MEMBER',
        'Cette personne ne voit pas ce projet : demandez à un gestionnaire de l’ajouter aux membres du projet, puis assignez-lui la tâche.',
      );
    }
    return true;
  }

  private async addAssigneeAsMember(
    organizationId: string,
    projectId: string,
    assigneeUserId: string,
    actor: WorkActor,
  ): Promise<void> {
    await this.projectMembers.add(organizationId, projectId, { userIds: [assigneeUserId] }, actor, {
      trusted: true,
    });
  }

  // ── Création ─────────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    projectId: string,
    body: CreateWorkTaskBody,
    actor: WorkActor,
    /**
     * ADR-0066 § 5 : création de masse (import, IA) — l'assignation est RETENUE dans ce
     * lot au lieu d'être notifiée tout de suite (`WorkNotifier.flushAssignments`).
     */
    opts: { assignments?: WorkAssignmentBatch } = {},
  ): Promise<WorkTaskWriteResult> {
    const project = await this.projects.requireWritable(organizationId, projectId);
    // ADR-0076 § 1 : le Lecteur ne crée pas de tâche ; jalons et validation : gestion.
    const rights = await this.projectRightsOf(organizationId, project, actor);
    if (!rights.canCreateTasks) {
      forbidden(
        'WORK_TASK_CREATE_FORBIDDEN',
        'Vous êtes Lecteur de ce projet : vous pouvez lire et commenter, pas créer de tâche.',
      );
    }
    if (body.isMilestone === true && !rights.canManage) {
      forbidden(
        'WORK_PROJECT_MANAGE_FORBIDDEN',
        'Seuls le chef de projet, son adjoint et les gestionnaires posent les jalons.',
      );
    }
    if (body.approval) {
      await this.checkApprovalSetting(organizationId, project, body.approval, rights);
    }
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
    assertSelfAssignment(actor, null, assigneeUserId);
    if (assigneeUserId) {
      await this.members.requireEligible(
        organizationId,
        [assigneeUserId],
        'work.update',
        'WORK_ASSIGNEE_NOT_ELIGIBLE',
        'assigneeUserId',
      );
    }
    const addMember = assigneeUserId
      ? await this.membershipNeeded(organizationId, projectId, assigneeUserId, actor)
      : false;
    if (assigneeUserId) {
      await this.assertNotViewers(
        organizationId,
        projectId,
        [assigneeUserId],
        'assigneeUserId',
        'WORK_ASSIGNEE_VIEWER',
      );
    }
    const collaboratorUserIds = (body.collaboratorUserIds ?? []).filter(
      (u) => u !== assigneeUserId,
    );
    await this.checkCollaborators(organizationId, projectId, [], collaboratorUserIds, actor);
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
      ...new Set([
        actor.userId,
        ...(assigneeUserId ? [assigneeUserId] : []),
        ...collaboratorUserIds,
        ...followers,
      ]),
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
      collaboratorUserIds,
      checklist: [],
      approval: body.approval?.required
        ? {
            required: true,
            approverUserId: body.approval.approverUserId ?? null,
            state: 'none',
            pendingApproverUserId: null,
            submittedBy: null,
            submittedAt: null,
            decidedBy: null,
            decidedAt: null,
            reason: null,
          }
        : null,
      priority: body.priority ?? 'none',
      labelKeys: body.labelKeys ?? [],
      startDate: body.startDate ?? null,
      dueDate: body.dueDate ?? null,
      // ADR-0080 : le schéma refuse déjà une heure sans son jour.
      startTime: body.startDate ? (body.startTime ?? null) : null,
      dueTime: body.dueDate ? (body.dueTime ?? null) : null,
      isMilestone: body.isMilestone ?? false,
      blockedBy: [],
      loggedMinutes: 0,
      estimateMinutes: body.estimateMinutes ?? null,
      color: body.color ?? null,
      source: null,
      billing: null,
      reminders: { dueSoonFor: null, overdueFor: null, dueInHourFor: null },
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
    if (assigneeUserId && addMember) {
      await this.addAssigneeAsMember(organizationId, projectId, assigneeUserId, actor);
    }
    if (assigneeUserId && opts.assignments) {
      opts.assignments.add(assigneeUserId, { taskId: id, number, title: body.title });
    } else if (assigneeUserId) {
      await this.notifyAssigned(
        organizationId,
        { id, projectId, number, title: body.title },
        assigneeUserId,
        actor,
      );
    }
    await this.notifyCollaborators(
      organizationId,
      { id, projectId, number, title: body.title },
      collaboratorUserIds,
      actor,
    );
    // ADR-0079 § 3 : le chef et l'adjoint voient naître les tâches de leur projet (un
    // geste de masse — import, IA — s'annonce par ses assignations groupées).
    if (!opts.assignments) {
      await this.notifier.taskEvent({
        organizationId,
        recipients: await this.notifier.leads(organizationId, projectId),
        kind: 'work.task_created',
        projectId,
        taskId: id,
        title: `${await this.actorName(actor)} a créé #${number} ${body.title}`,
        actorUserId: actor.userId,
        audience: 'project_lead',
      });
    }
    return this.result(organizationId, id);
  }

  /** ADR-0076 § 2 : « Vous êtes collaborateur de #3 … ». */
  private async notifyCollaborators(
    organizationId: string,
    task: { id: string; projectId: string; number: number; title: string },
    userIds: readonly string[],
    actor: WorkActor,
  ): Promise<void> {
    const recipients = userIds.filter((u) => u !== actor.userId);
    if (recipients.length === 0) return;
    await this.notifier.taskEvent({
      organizationId,
      recipients,
      kind: 'work.task_collaborator_added',
      projectId: task.projectId,
      taskId: task.id,
      title: `${await this.actorName(actor)} vous a ajouté comme collaborateur de #${task.number} ${task.title}`,
      actorUserId: actor.userId,
    });
  }

  // ── Modification ─────────────────────────────────────────────────────────

  async patch(
    organizationId: string,
    taskId: string,
    body: PatchWorkTaskBody,
    actor: WorkActor,
  ): Promise<WorkTaskWriteResult> {
    const { task: current, project } = await this.requireWritable(organizationId, taskId);
    // ADR-0076 § 2 : responsable, collaborateur, créateur, tâche libre ou gestion.
    const rights = await this.taskRightsOf(organizationId, project, current, actor);
    assertCanEdit(rights);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    if (
      body.isMilestone !== undefined &&
      body.isMilestone !== current.isMilestone &&
      !rights.project.canManage
    ) {
      forbidden(
        'WORK_PROJECT_MANAGE_FORBIDDEN',
        'Seuls le chef de projet, son adjoint et les gestionnaires posent ou retirent un jalon.',
      );
    }
    if (body.approval !== undefined) {
      await this.checkApprovalSetting(organizationId, project, body.approval, rights.project);
    }

    const final = {
      isMilestone: body.isMilestone ?? current.isMilestone,
      startDate: body.startDate !== undefined ? body.startDate : current.startDate,
      dueDate: body.dueDate !== undefined ? body.dueDate : current.dueDate,
      // ADR-0080 : effacer le jour efface son heure ; une heure posée sans jour est refusée.
      ...finalTimes(body, current),
    };
    checkFinalDates(final);
    if (final.isMilestone) {
      if (final.startDate || final.startTime) {
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
    if (body.color !== undefined) assign('color', body.color);
    if (body.isMilestone !== undefined) assign('isMilestone', body.isMilestone);
    if (body.startDate !== undefined) assign('startDate', body.startDate);
    if (body.dueDate !== undefined) assign('dueDate', body.dueDate);
    if (final.startTime !== (current.startTime ?? null)) assign('startTime', final.startTime);
    if (final.dueTime !== (current.dueTime ?? null)) assign('dueTime', final.dueTime);
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
    if (assigneeChanged) {
      assertSelfAssignment(actor, current.assigneeUserId ?? null, body.assigneeUserId ?? null);
    }
    let addMember = false;
    if (assigneeChanged && body.assigneeUserId) {
      await this.members.requireEligible(
        organizationId,
        [body.assigneeUserId],
        'work.update',
        'WORK_ASSIGNEE_NOT_ELIGIBLE',
        'assigneeUserId',
      );
      addMember = await this.membershipNeeded(
        organizationId,
        current.projectId,
        body.assigneeUserId,
        actor,
      );
    }
    if (assigneeChanged && body.assigneeUserId) {
      await this.assertNotViewers(
        organizationId,
        current.projectId,
        [body.assigneeUserId],
        'assigneeUserId',
        'WORK_ASSIGNEE_VIEWER',
      );
    }
    // ADR-0076 § 2 : collaborateurs (ajoutés : abonnés et notifiés).
    const collabBefore = current.collaboratorUserIds ?? [];
    let collabAdded: string[] = [];
    let collabRemoved: string[] = [];
    if (body.collaboratorUserIds !== undefined) {
      const finalAssignee =
        body.assigneeUserId !== undefined ? body.assigneeUserId : current.assigneeUserId;
      const next = body.collaboratorUserIds.filter((u) => u !== finalAssignee);
      await this.checkCollaborators(organizationId, current.projectId, collabBefore, next, actor);
      collabAdded = next.filter((u) => !collabBefore.includes(u));
      collabRemoved = collabBefore.filter((u) => !next.includes(u));
      if (collabAdded.length + collabRemoved.length > 0) {
        set['collaboratorUserIds'] = next;
      }
    } else if (
      assigneeChanged &&
      body.assigneeUserId &&
      collabBefore.includes(body.assigneeUserId)
    ) {
      // Le nouveau responsable n'est plus « collaborateur » de sa propre tâche.
      set['collaboratorUserIds'] = collabBefore.filter((u) => u !== body.assigneeUserId);
      collabRemoved = [body.assigneeUserId];
    }
    // ADR-0076 § 3 : réglage de la validation (gestion, vérifié plus haut).
    let approvalChanged = false;
    if (body.approval !== undefined) {
      const was = current.approval ?? null;
      const approverUserId = body.approval.approverUserId ?? null;
      if (!body.approval.required) {
        if (was?.required) {
          set['approval'] = null;
          approvalChanged = true;
        }
      } else if (!was?.required || (was.approverUserId ?? null) !== approverUserId) {
        const pending = was?.required && was.state === 'pending';
        set['approval'] = {
          required: true,
          approverUserId,
          state: was?.required ? was.state : 'none',
          pendingApproverUserId: pending
            ? (approverUserId ?? project.ownerUserId ?? project.deputyUserId ?? null)
            : (was?.pendingApproverUserId ?? null),
          submittedBy: was?.submittedBy ?? null,
          submittedAt: was?.submittedAt ?? null,
          decidedBy: was?.decidedBy ?? null,
          decidedAt: was?.decidedAt ?? null,
          reason: was?.reason ?? null,
        };
        approvalChanged = true;
      }
      if (approvalChanged) changed.push('approval');
    }
    const update: Record<string, unknown> = { $set: set, $inc: { revision: 1 } };
    const followersToAdd: string[] = [];
    if (assigneeChanged) {
      assign('assigneeUserId', body.assigneeUserId ?? null);
      if (body.assigneeUserId && body.followerUserIds === undefined) {
        followersToAdd.push(body.assigneeUserId);
      }
    }
    if (body.followerUserIds === undefined) followersToAdd.push(...collabAdded);
    if (followersToAdd.length > 0) {
      update['$addToSet'] = { followerUserIds: { $each: [...new Set(followersToAdd)] } };
    }

    const res = await this.tasks
      .updateOne({ _id: current._id, organizationId, revision: body.expectedRevision }, update)
      .exec();
    if (res.matchedCount !== 1) {
      staleRevision((await this.requireOwn(organizationId, taskId)).revision);
    }

    const base = { projectId: current.projectId, taskId, actorUserId: actor.userId };
    const entries: ActivityInput[] = [];
    const others = changed.filter((f) => !['assigneeUserId', 'dueDate', 'dueTime'].includes(f));
    // ADR-0080 : l'échéance change si son jour OU son heure change.
    const dueChanged =
      final.dueDate !== (current.dueDate ?? null) || final.dueTime !== (current.dueTime ?? null);
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
    if (dueChanged) {
      entries.push({
        ...base,
        kind: 'task.due_changed',
        data: {
          from: current.dueDate ?? null,
          to: final.dueDate,
          fromTime: current.dueTime ?? null,
          toTime: final.dueTime,
        },
      });
    }
    if (collabAdded.length + collabRemoved.length > 0) {
      entries.push({
        ...base,
        kind: 'task.collaborators_changed',
        data: { added: collabAdded, removed: collabRemoved },
      });
    }
    await this.activity.record(organizationId, entries);
    await this.notifyCollaborators(
      organizationId,
      {
        id: taskId,
        projectId: current.projectId,
        number: current.number,
        title: body.title ?? current.title,
      },
      collabAdded,
      actor,
    );
    if (assigneeChanged && body.assigneeUserId && addMember) {
      await this.addAssigneeAsMember(organizationId, current.projectId, body.assigneeUserId, actor);
    }
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
    // ADR-0079 § 3 : « l'échéance d'une de mes tâches change » — responsable (s'il n'est pas
    // celui qu'on vient d'assigner), collaborateurs, chef et adjoint.
    if (dueChanged) {
      const assignee = assigneeChanged ? null : (current.assigneeUserId ?? null);
      const label = `#${current.number} ${body.title ?? current.title}`;
      const timeZone = await this.clock.timeZoneOf(organizationId);
      await this.notifier.taskEvent({
        organizationId,
        recipients: [
          assignee,
          ...(current.collaboratorUserIds ?? []).filter((u) => !collabAdded.includes(u)),
          ...(await this.notifier.leads(organizationId, current.projectId)),
        ],
        kind: 'work.task_due_date_changed',
        projectId: current.projectId,
        taskId,
        title: final.dueDate
          ? `${await this.actorName(actor)} a fixé l’échéance de ${label} au ${formatDayTime(final.dueDate, final.dueTime, timeZone)}`
          : `${await this.actorName(actor)} a retiré l’échéance de ${label}`,
        actorUserId: actor.userId,
      });
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
    const rights = await this.taskRightsOf(organizationId, project, current, actor);
    assertCanEdit(rights);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const column = this.columnOf(project, body.columnKey);
    // ADR-0076 § 2 et § 3 : entrer dans « terminé » ou en sortir = terminer ou rouvrir.
    if ((column.category === 'done') !== current.done) {
      assertCanComplete(rights);
      if (column.category === 'done') assertNoPendingApproval(current);
    }
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
    assertCanComplete(await this.taskRightsOf(organizationId, project, current, actor));
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    if (current.done) return this.result(organizationId, taskId);
    assertNoPendingApproval(current);
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
    assertCanComplete(await this.taskRightsOf(organizationId, project, current, actor));
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    if (!current.done) return this.result(organizationId, taskId);
    const column = this.firstTodo(project);
    const rank = await this.endRank(organizationId, current.projectId, column.key, taskId);
    return this.place(organizationId, project, current, column, rank, expectedRevision, actor);
  }

  /**
   * Place la tâche dans une colonne. `extraSet` : champs écrits dans la MÊME mise à jour
   * (ADR-0076 § 3 : décision d'approbation). Rouvrir une tâche approuvée remet sa
   * validation à zéro.
   */
  async place(
    organizationId: string,
    project: WorkProjectLean,
    current: WorkTaskLean,
    column: WorkColumn,
    rank: string,
    expectedRevision: number,
    actor: WorkActor,
    extraSet: Record<string, unknown> = {},
  ): Promise<WorkTaskWriteResult> {
    const taskId = String(current._id);
    const fields = this.columnFields(current, column, actor);
    const reopening = current.done && column.category !== 'done';
    const approvalReset =
      reopening && current.approval?.required && current.approval.state === 'approved'
        ? {
            'approval.state': 'none',
            'approval.pendingApproverUserId': null,
            'approval.decidedBy': null,
            'approval.decidedAt': null,
            'approval.reason': null,
          }
        : {};
    const res = await this.tasks
      .updateOne(
        { _id: current._id, organizationId, revision: expectedRevision },
        {
          $set: { ...fields, rank, updatedBy: actor.userId, ...approvalReset, ...extraSet },
          $inc: { revision: 1 },
        },
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
    // ADR-0061 § 2 : « statut (colonne) d'une de mes tâches changé » — l'assigné, s'il
    // n'est pas l'auteur du geste (préférences et visibilité appliquées par le notifier).
    // ADR-0064 § 3 : tout changement de colonne est publié dans le canal du projet.
    if (column.key !== current.columnKey) {
      this.notifier.channelEvent({
        organizationId,
        projectId: current.projectId,
        eventLabel: column.category === 'done' ? 'Tâche terminée' : 'Tâche déplacée',
        title: `${await this.actorName(actor)} a déplacé #${current.number} ${current.title} vers « ${column.label} »`,
        href: taskHref(current.projectId, taskId),
      });
    }
    if (
      column.key !== current.columnKey &&
      (current.assigneeUserId || (current.collaboratorUserIds ?? []).length > 0)
    ) {
      await this.notifier.taskEvent({
        organizationId,
        // ADR-0076 § 2 : les collaborateurs sont notifiés comme le responsable.
        recipients: [current.assigneeUserId, ...(current.collaboratorUserIds ?? [])],
        kind: 'work.task_status_changed',
        projectId: current.projectId,
        taskId,
        title: `${await this.actorName(actor)} a déplacé #${current.number} ${current.title} vers « ${column.label} »`,
        actorUserId: actor.userId,
      });
    }
    // ADR-0079 § 3 : terminée ou rouverte — le chef, l'adjoint et les abonnés (le
    // responsable et les collaborateurs ont déjà « statut changé »). Un jalon terminé
    // s'annonce par « jalon atteint » (ci-dessous), pas deux fois.
    if (nowDone !== current.done && !(nowDone && current.isMilestone)) {
      const concerned = new Set(
        [current.assigneeUserId, ...(current.collaboratorUserIds ?? [])].filter(Boolean),
      );
      const leads = await this.notifier.leads(organizationId, current.projectId);
      await this.notifier.taskEvent({
        organizationId,
        recipients: [...leads, ...(nowDone ? (current.followerUserIds ?? []) : [])].filter(
          (u) => !concerned.has(u),
        ),
        kind: nowDone ? 'work.task_completed' : 'work.task_reopened',
        projectId: current.projectId,
        taskId,
        title: nowDone
          ? `${await this.actorName(actor)} a terminé #${current.number} ${current.title}`
          : `${await this.actorName(actor)} a rouvert #${current.number} ${current.title}`,
        actorUserId: actor.userId,
      });
    }
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
  async remove(
    organizationId: string,
    taskId: string,
    actor: WorkActor,
    /** Annulation interne d'un import (`WorkPlanBuilder`) : la règle de gestion ne s'applique pas. */
    opts: { trusted?: boolean } = {},
  ): Promise<void> {
    const { task: current, project } = await this.requireWritable(organizationId, taskId);
    // ADR-0076 § 1 : suppression de tâches — chef, adjoint ou `work.manage`.
    if (!opts.trusted) await this.access.assertManage(organizationId, project, actor);
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
    const { task: current, project } = await this.requireWritable(organizationId, taskId);
    assertCanEdit(await this.taskRightsOf(organizationId, project, current, actor));
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
    const { task: current, project } = await this.requireWritable(organizationId, taskId);
    assertCanEdit(await this.taskRightsOf(organizationId, project, current, actor));
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

  // ── Validation (ADR-0076 § 3) ────────────────────────────────────────────

  /** `POST /work/tasks/:taskId/approval/submit` — le responsable (ou la gestion) soumet. */
  async submitApproval(
    organizationId: string,
    taskId: string,
    expectedRevision: number,
    actor: WorkActor,
  ): Promise<WorkTaskWriteResult> {
    const { task, project } = await this.requireWritable(organizationId, taskId);
    const rights = await this.taskRightsOf(organizationId, project, task, actor);
    const a = task.approval;
    if (!a?.required) {
      conflict('WORK_APPROVAL_NOT_PENDING', 'Cette tâche n’est pas à valider.');
    }
    if (task.assigneeUserId !== actor.userId && !rights.project.canManage) {
      forbidden(
        'WORK_APPROVAL_FORBIDDEN',
        'Seul le responsable de la tâche (ou le chef de projet) la soumet à validation.',
      );
    }
    if (task.revision !== expectedRevision) staleRevision(task.revision);
    if (task.done || a.state === 'pending' || a.state === 'approved') {
      conflict('WORK_APPROVAL_NOT_PENDING', 'Cette tâche est déjà soumise ou validée.');
    }
    const approver = effectiveApprover(task, project);
    if (!approver) {
      invalid(
        'approval.approverUserId',
        'WORK_APPROVER_REQUIRED',
        'Ce projet n’a ni chef ni adjoint : demandez qu’un validateur soit désigné.',
      );
    }
    const now = new Date();
    const res = await this.tasks
      .updateOne(
        { _id: task._id, organizationId, revision: expectedRevision },
        {
          $set: {
            'approval.state': 'pending',
            'approval.pendingApproverUserId': approver,
            'approval.submittedBy': actor.userId,
            'approval.submittedAt': now,
            'approval.decidedBy': null,
            'approval.decidedAt': null,
            'approval.reason': null,
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1)
      staleRevision((await this.requireOwn(organizationId, taskId)).revision);
    await this.activity.record(organizationId, {
      projectId: task.projectId,
      taskId,
      actorUserId: actor.userId,
      kind: 'task.approval_submitted',
      data: { approverUserId: approver },
    });
    const name = await this.actorName(actor);
    this.notifier.channelEvent({
      organizationId,
      projectId: task.projectId,
      eventLabel: 'Tâche à valider',
      title: `#${task.number} ${task.title} — soumise à validation par ${name}`,
      href: taskHref(task.projectId, taskId),
    });
    await this.notifier.taskEvent({
      organizationId,
      recipients: [approver],
      kind: 'work.task_approval_requested',
      projectId: task.projectId,
      taskId,
      title: `${name} vous demande de valider #${task.number} ${task.title}`,
      actorUserId: actor.userId,
    });
    return this.result(organizationId, taskId);
  }

  /**
   * `POST /work/tasks/:taskId/approval/decide` — le validateur (ou la gestion), jamais
   * l'auteur de la soumission. Approuver termine la tâche (et le jalon : suggestion de
   * facture) ; demander des modifications ou refuser exige un motif.
   */
  async decideApproval(
    organizationId: string,
    taskId: string,
    body: {
      expectedRevision: number;
      decision: 'approve' | 'request_changes' | 'reject';
      reason?: string | null;
    },
    actor: WorkActor,
  ): Promise<WorkTaskWriteResult> {
    const { task, project } = await this.requireWritable(organizationId, taskId);
    const rights = await this.projectRightsOf(organizationId, project, actor);
    const a = task.approval;
    if (!a?.required || a.state !== 'pending') {
      conflict('WORK_APPROVAL_NOT_PENDING', 'Aucune validation n’est en attente sur cette tâche.');
    }
    if (a.pendingApproverUserId !== actor.userId && !rights.canManage) {
      forbidden(
        'WORK_APPROVAL_FORBIDDEN',
        'Seul le validateur désigné (ou le chef de projet) décide de cette validation.',
      );
    }
    if (a.submittedBy === actor.userId) {
      conflict(
        'WORK_SELF_APPROVAL_FORBIDDEN',
        'Vous avez soumis cette tâche : une autre personne doit la valider.',
      );
    }
    if (task.revision !== body.expectedRevision) staleRevision(task.revision);
    const now = new Date();
    const reason = body.decision === 'approve' ? null : (body.reason ?? null);
    const decided = {
      'approval.decidedBy': actor.userId,
      'approval.decidedAt': now,
      'approval.reason': reason,
    };
    const kind =
      body.decision === 'approve'
        ? ('task.approval_approved' as const)
        : body.decision === 'reject'
          ? ('task.approval_rejected' as const)
          : ('task.approval_changes_requested' as const);
    let out: WorkTaskWriteResult;
    if (body.decision === 'approve') {
      const column = this.doneColumn(project);
      const rank = await this.endRank(organizationId, task.projectId, column.key, taskId);
      await this.activity.record(organizationId, {
        projectId: task.projectId,
        taskId,
        actorUserId: actor.userId,
        kind,
        data: {},
      });
      out = await this.place(
        organizationId,
        project,
        task,
        column,
        rank,
        body.expectedRevision,
        actor,
        { 'approval.state': 'approved', ...decided },
      );
    } else {
      const res = await this.tasks
        .updateOne(
          { _id: task._id, organizationId, revision: body.expectedRevision },
          {
            $set: {
              'approval.state': body.decision === 'reject' ? 'rejected' : 'changes_requested',
              ...decided,
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
        )
        .exec();
      if (res.matchedCount !== 1) {
        staleRevision((await this.requireOwn(organizationId, taskId)).revision);
      }
      await this.activity.record(organizationId, {
        projectId: task.projectId,
        taskId,
        actorUserId: actor.userId,
        kind,
        data: { reason: (reason ?? '').slice(0, WORK_COLLAB_LIMITS.approvalReasonMax) },
      });
      out = await this.result(organizationId, taskId);
    }
    const name = await this.actorName(actor);
    const verb =
      body.decision === 'approve'
        ? 'a validé'
        : body.decision === 'reject'
          ? 'a refusé'
          : 'demande des modifications sur';
    await this.notifier.taskEvent({
      organizationId,
      recipients: [task.assigneeUserId, a.submittedBy],
      kind: 'work.task_approval_decided',
      projectId: task.projectId,
      taskId,
      title: `${name} ${verb} #${task.number} ${task.title}${reason ? ` : ${reason}` : ''}`,
      actorUserId: actor.userId,
    });
    return out;
  }

  // ── Liste de contrôle (ADR-0076 § 4) ─────────────────────────────────────

  /**
   * `PUT /work/tasks/:taskId/checklist` — remplace la liste. Cocher : responsable,
   * collaborateurs, gestion ; ajouter, renommer, retirer, réordonner : qui modifie la tâche.
   */
  async putChecklist(
    organizationId: string,
    taskId: string,
    body: { expectedRevision: number; items: { id?: string; text: string; done: boolean }[] },
    actor: WorkActor,
  ): Promise<WorkTaskWriteResult> {
    const { task, project } = await this.requireWritable(organizationId, taskId);
    const rights = await this.taskRightsOf(organizationId, project, task, actor);
    if (task.revision !== body.expectedRevision) staleRevision(task.revision);
    const before = task.checklist ?? [];
    const byId = new Map(before.map((c) => [c.id, c]));
    for (const item of body.items) {
      if (item.id !== undefined && !byId.has(item.id)) {
        invalid(
          'items',
          'INVALID_VALUE',
          'Un élément de la liste est inconnu : rechargez la tâche.',
        );
      }
    }
    const structural =
      body.items.length !== before.length ||
      body.items.some((item, i) => item.id !== before[i]?.id || item.text !== before[i]?.text);
    const toggled = body.items.some((item) => {
      const was = item.id ? byId.get(item.id) : undefined;
      return was ? was.done !== item.done : item.done;
    });
    const refuse = (): never =>
      forbidden(
        'WORK_CHECKLIST_FORBIDDEN',
        'Seuls le responsable, les collaborateurs et le chef de projet cochent cette liste ; seuls ceux qui modifient la tâche la composent.',
      );
    if (structural && !rights.canEdit) refuse();
    if (toggled && !rights.canCheck) refuse();
    if (!structural && !toggled) return this.result(organizationId, taskId);
    const now = new Date();
    const next = body.items.map((item) => {
      const was = item.id ? byId.get(item.id) : undefined;
      const changedDone = was ? was.done !== item.done : item.done;
      return {
        id: item.id ?? new Types.ObjectId().toHexString(),
        text: item.text,
        done: item.done,
        doneBy: changedDone ? (item.done ? actor.userId : null) : (was?.doneBy ?? null),
        doneAt: changedDone ? (item.done ? now : null) : (was?.doneAt ?? null),
      };
    });
    const res = await this.tasks
      .updateOne(
        { _id: task._id, organizationId, revision: body.expectedRevision },
        { $set: { checklist: next, updatedBy: actor.userId }, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1)
      staleRevision((await this.requireOwn(organizationId, taskId)).revision);
    await this.activity.record(organizationId, {
      projectId: task.projectId,
      taskId,
      actorUserId: actor.userId,
      kind: 'task.checklist_changed',
      data: { done: next.filter((c) => c.done).length, total: next.length },
    });
    return this.result(organizationId, taskId);
  }

  // ── Suivre / Ne plus suivre (ADR-0076 § 2) ───────────────────────────────

  /** Toute personne qui voit la tâche la suit ou cesse de la suivre (Lecteur compris). */
  async setFollowing(
    organizationId: string,
    taskId: string,
    following: boolean,
    actor: WorkActor,
  ): Promise<{ following: boolean }> {
    const task = await this.requireOwn(organizationId, taskId);
    const current = task.followerUserIds ?? [];
    if (following && !current.includes(actor.userId)) {
      if (current.length >= WORK_LIMITS.followersMax) {
        conflict(
          'WORK_FOLLOWERS_LIMIT',
          `Une tâche compte au plus ${WORK_LIMITS.followersMax} abonnés.`,
        );
      }
      await this.tasks
        .updateOne(
          { _id: task._id, organizationId },
          { $addToSet: { followerUserIds: actor.userId } },
          { timestamps: false },
        )
        .exec();
    } else if (!following && current.includes(actor.userId)) {
      await this.tasks
        .updateOne(
          { _id: task._id, organizationId },
          { $pull: { followerUserIds: actor.userId } },
          { timestamps: false },
        )
        .exec();
    }
    return { following };
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
