// Espace externe (contact client, consultant) — ADR-0078 § 1.3 à § 1.5 et § 2.
//
// Toutes les lectures partent du COMPTE de la session et de ses accès OUVERTS (adhésion
// active, projet non archivé, même organisation) : rien n'est lu par un identifiant venu
// de la requête sans ce filtre. Hors portée : 404 (jamais 403), comme dans l'ERP.
//
//   - contact client : ses projets ; dans un projet, les tâches « visibles par le client »
//     seulement ; commentaires PARTAGÉS seulement ; validation des livrables marqués
//     « validation client requise » ;
//   - consultant : ses tâches (responsable ou collaborateur consultant), ou toutes les
//     tâches du projet si « peut ouvrir le projet » ; commentaires partagés ; saisie de son
//     temps sur SES tâches ; soumission de sa semaine (ADR-0077, valideur : son référent).
//
// Aucune vue ne porte de montant, de marge, de coût, ni de membre interne autre que le
// NOM du chef de projet ; l'auteur interne d'un commentaire partagé est « L'équipe
// projet » (sauf le chef, nommé). Ce que l'externe écrit est TOUJOURS partagé.

import {
  kinshasaDayOf,
  type CreateTimeEntryBody,
  type PortalClientDecisionBody,
  type PortalCommentBody,
  type PortalCommentView,
  type PortalProjectSummary,
  type PortalProjectView,
  type PortalTaskSummary,
  type PortalTaskView,
  type PortalTimeEntryView,
  type PortalTimesheetView,
  type SubmitTimesheetBody,
  type UpdateTimeEntryBody,
  type WorkClientApprovalState,
  WORK_DEFAULT_TIME_ZONE,
} from '@lalanda/shared/work';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { NO_OVERRIDES } from '../../authz/permissions.js';
import {
  mondayOfDay,
  WorkTimesheetApprovalsService,
} from '../timesheets/work-timesheet-approvals.service.js';
import { WorkActivityService } from '../work-activity.service.js';
import { WorkClockService } from '../work-clock.service.js';
import { WorkMembersService } from '../work-members.service.js';
import { WorkNotifier } from '../work-notifier.js';
import { WorkExternalNotifier } from './work-external-notifier.js';
import { WorkTimeService } from '../work-time.service.js';
import {
  conflict,
  forbidden,
  isWorkId,
  oid,
  projectNotFound,
  staleRevision,
  taskNotFound,
  timeEntryNotFound,
  type WorkActor,
} from '../work.common.js';
import {
  WorkComment,
  WorkProject,
  WorkTask,
  WorkTimeEntry,
  type WorkCommentDocument,
  type WorkCommentLean,
  type WorkProjectDocument,
  type WorkProjectLean,
  type WorkTaskDocument,
  type WorkTaskLean,
  type WorkTimeEntryDocument,
  type WorkTimeEntryLean,
} from '../work.schemas.js';
import type { ExternalContext } from './work-external-auth.service.js';
import { externalAuditRole, WorkExternalLifecycle } from './work-external-lifecycle.js';
import {
  WorkExternalMembership,
  type WorkExternalMembershipDocument,
  type WorkExternalMembershipLean,
} from './work-external.schemas.js';

/** Nom affiché d'un auteur interne qui n'est pas le chef de projet. */
export const PORTAL_TEAM_LABEL = 'L’équipe projet';

const PORTAL_COMMENTS_MAX = 200;
const PORTAL_TASKS_MAX = 500;

/** Projection : aucun champ de coût, de temps ou de personne interne n'est lu. */
const TASK_PROJECTION = {
  projectId: 1,
  number: 1,
  title: 1,
  description: 1,
  done: 1,
  columnKey: 1,
  dueDate: 1,
  dueTime: 1,
  isMilestone: 1,
  clientVisible: 1,
  clientApproval: 1,
  consultantAssigneeId: 1,
  consultantCollaboratorIds: 1,
  assigneeUserId: 1,
  followerUserIds: 1,
  // ADR-0079 § 3 bis : destinataires internes des notifications (jamais servis à l’externe).
  collaboratorUserIds: 1,
  revision: 1,
  rank: 1,
} as const;

interface Access {
  project: WorkProjectLean;
  membership: WorkExternalMembershipLean;
}

@Injectable()
export class WorkPortalService {
  constructor(
    @InjectModel(WorkExternalMembership.name)
    private readonly memberships: Model<WorkExternalMembershipDocument>,
    @InjectModel(WorkProject.name) private readonly projects: Model<WorkProjectDocument>,
    @InjectModel(WorkTask.name) private readonly tasks: Model<WorkTaskDocument>,
    @InjectModel(WorkComment.name) private readonly comments: Model<WorkCommentDocument>,
    @InjectModel(WorkTimeEntry.name) private readonly time: Model<WorkTimeEntryDocument>,
    @Inject(WorkExternalLifecycle) private readonly lifecycle: WorkExternalLifecycle,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(WorkActivityService) private readonly activity: WorkActivityService,
    @Inject(WorkNotifier) private readonly notifier: WorkNotifier,
    @Inject(WorkTimeService) private readonly timeService: WorkTimeService,
    @Inject(WorkTimesheetApprovalsService)
    private readonly timesheets: WorkTimesheetApprovalsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional()
    @Inject(WorkExternalNotifier)
    private readonly externalNotifier: WorkExternalNotifier | null = null,
    // ADR-0080 : fuseau de l'organisation, affiché avec les heures.
    @Optional()
    @Inject(WorkClockService)
    private readonly clock: WorkClockService | null = null,
  ) {}

  /** Appelant du module, côté écriture (son compte externe, sans rôle d'organisation). */
  private actorOf(ctx: ExternalContext): WorkActor {
    return { userId: ctx.accountId, role: undefined, context: NO_OVERRIDES };
  }

  private auditRole(ctx: ExternalContext): string {
    return externalAuditRole(ctx.kind);
  }

  // ── Accès ────────────────────────────────────────────────────────────────

  /** Accès ouverts du compte, avec leur projet (non archivé, même organisation). */
  private async accesses(ctx: ExternalContext): Promise<Access[]> {
    const rows = await this.memberships
      .find({ organizationId: ctx.organizationId, accountId: ctx.accountId, status: 'active' })
      .lean<WorkExternalMembershipLean[]>()
      .exec();
    const ids = rows.map((r) => r.projectId).filter(isWorkId);
    if (ids.length === 0) return [];
    const projects = await this.projects
      .find({
        organizationId: ctx.organizationId,
        _id: { $in: ids.map(oid) },
        status: { $ne: 'archived' },
      })
      .lean<WorkProjectLean[]>()
      .exec();
    const byId = new Map(projects.map((p) => [String(p._id), p]));
    return (
      rows
        .filter((r) => byId.has(r.projectId))
        // Un contact client ne voit jamais qu'un projet client de SA fiche.
        .filter((r) => {
          const p = byId.get(r.projectId)!;
          return (
            ctx.kind !== 'client' ||
            (p.kind === 'client' && !!ctx.customerId && p.links?.customerId === ctx.customerId)
          );
        })
        .map((r) => ({ project: byId.get(r.projectId)!, membership: r }))
    );
  }

  private async requireAccess(ctx: ExternalContext, projectId: string): Promise<Access> {
    if (!isWorkId(projectId)) projectNotFound();
    const access = (await this.accesses(ctx)).find((a) => String(a.project._id) === projectId);
    if (!access) projectNotFound();
    return access;
  }

  /** Tâches visibles d'un accès. */
  private taskFilter(ctx: ExternalContext, access: Access): Record<string, unknown> {
    const base = { organizationId: ctx.organizationId, projectId: String(access.project._id) };
    if (ctx.kind === 'client') return { ...base, clientVisible: true };
    if (access.membership.canOpenProject) return base;
    return {
      ...base,
      $or: [{ consultantAssigneeId: ctx.accountId }, { consultantCollaboratorIds: ctx.accountId }],
    };
  }

  private isMine(ctx: ExternalContext, t: WorkTaskLean): boolean {
    return (
      ctx.kind === 'consultant' &&
      (t.consultantAssigneeId === ctx.accountId ||
        (t.consultantCollaboratorIds ?? []).includes(ctx.accountId))
    );
  }

  private async requireTask(
    ctx: ExternalContext,
    taskId: string,
  ): Promise<{ task: WorkTaskLean; access: Access }> {
    if (!isWorkId(taskId)) taskNotFound();
    const task = await this.tasks
      .findOne({ _id: oid(taskId), organizationId: ctx.organizationId }, TASK_PROJECTION)
      .lean<WorkTaskLean>()
      .exec();
    if (!task) taskNotFound();
    const access = (await this.accesses(ctx)).find((a) => String(a.project._id) === task.projectId);
    if (!access) taskNotFound();
    const visible = await this.tasks
      .countDocuments({ ...this.taskFilter(ctx, access), _id: task._id })
      .exec();
    if (visible !== 1) taskNotFound();
    return { task, access };
  }

  // ── Vues ─────────────────────────────────────────────────────────────────

  private stageOf(project: WorkProjectLean, t: WorkTaskLean): string {
    if (t.done) return 'done';
    const column = (project.columns ?? []).find((c) => c.key === t.columnKey);
    return column?.category === 'in_progress' ? 'in_progress' : 'todo';
  }

  private approvalOf(t: WorkTaskLean): { required: boolean; state: WorkClientApprovalState } {
    const ca = t.clientApproval;
    return ca?.required ? { required: true, state: ca.state } : { required: false, state: 'none' };
  }

  private summaryOf(
    ctx: ExternalContext,
    project: WorkProjectLean,
    t: WorkTaskLean,
  ): PortalTaskSummary {
    return {
      id: String(t._id),
      number: t.number,
      title: t.title,
      done: t.done,
      stage: this.stageOf(project, t),
      dueDate: t.dueDate ?? null,
      // ADR-0080 : heure facultative (fuseau du projet, rendu avec le projet).
      dueTime: t.dueTime ?? null,
      isMilestone: t.isMilestone,
      mine: this.isMine(ctx, t),
      clientApproval: this.approvalOf(t),
      revision: t.revision,
    };
  }

  private async leadNames(projects: readonly WorkProjectLean[]): Promise<Map<string, string>> {
    const refs = await this.members.refs(
      projects.map((p) => p.ownerUserId ?? null),
      projects[0]?.organizationId,
    );
    return new Map(
      projects
        .filter((p) => p.ownerUserId)
        .map((p) => [String(p._id), WorkMembersService.refOf(refs, p.ownerUserId!).name]),
    );
  }

  private async projectSummaries(
    ctx: ExternalContext,
    accesses: readonly Access[],
  ): Promise<PortalProjectSummary[]> {
    const leads = await this.leadNames(accesses.map((a) => a.project));
    const out: PortalProjectSummary[] = [];
    for (const a of accesses) {
      const filter = this.taskFilter(ctx, a);
      const [taskCount, doneTaskCount, pending] = await Promise.all([
        this.tasks.countDocuments(filter).exec(),
        this.tasks.countDocuments({ ...filter, done: true }).exec(),
        ctx.kind === 'client'
          ? this.tasks
              .countDocuments({
                ...filter,
                'clientApproval.required': true,
                'clientApproval.state': 'pending',
              })
              .exec()
          : Promise.resolve(0),
      ]);
      const id = String(a.project._id);
      out.push({
        id,
        name: a.project.name,
        status: a.project.status,
        startDate: a.project.startDate ?? null,
        dueDate: a.project.dueDate ?? null,
        startTime: a.project.startTime ?? null,
        dueTime: a.project.dueTime ?? null,
        timeZone:
          (await this.clock?.timeZoneOf(a.project.organizationId)) ?? WORK_DEFAULT_TIME_ZONE,
        leadName: leads.get(id) ?? null,
        taskCount,
        doneTaskCount,
        pendingClientApprovals: pending,
      });
    }
    return out.sort((x, y) => x.name.localeCompare(y.name, 'fr'));
  }

  /** `GET /portal/projects`. */
  async projectList(ctx: ExternalContext): Promise<{ items: PortalProjectSummary[] }> {
    return { items: await this.projectSummaries(ctx, await this.accesses(ctx)) };
  }

  /** `GET /portal/projects/:projectId`. */
  async project(ctx: ExternalContext, projectId: string): Promise<PortalProjectView> {
    const access = await this.requireAccess(ctx, projectId);
    const [summary] = await this.projectSummaries(ctx, [access]);
    const docs = await this.tasks
      .find(this.taskFilter(ctx, access), TASK_PROJECTION)
      .sort({ isMilestone: -1, dueDate: 1, number: 1 })
      .limit(PORTAL_TASKS_MAX)
      .lean<WorkTaskLean[]>()
      .exec();
    return {
      project: summary!,
      fullView: ctx.kind === 'consultant' && access.membership.canOpenProject,
      tasks: docs.map((t) => this.summaryOf(ctx, access.project, t)),
    };
  }

  private async commentViews(
    ctx: ExternalContext,
    project: WorkProjectLean,
    docs: readonly WorkCommentLean[],
  ): Promise<PortalCommentView[]> {
    const refs = await this.members.refs(
      [project.ownerUserId ?? null, ...docs.map((d) => d.authorUserId)],
      ctx.organizationId,
    );
    return docs.map((d) => {
      const ref = WorkMembersService.refOf(refs, d.authorUserId);
      const name =
        d.authorUserId === ctx.accountId
          ? ref.name
          : ref.external === 'client'
            ? ref.name
            : d.authorUserId === project.ownerUserId
              ? `${ref.name} (chef de projet)`
              : PORTAL_TEAM_LABEL;
      return {
        id: String(d._id),
        authorName: name,
        mine: d.authorUserId === ctx.accountId,
        body: d.body,
        createdAt: new Date(d.createdAt).toISOString(),
      };
    });
  }

  private entryView(
    e: WorkTimeEntryLean,
    tasks: Map<string, { number: number; title: string }>,
  ): PortalTimeEntryView {
    return {
      id: String(e._id),
      taskId: e.taskId,
      taskNumber: tasks.get(e.taskId)?.number ?? 0,
      taskTitle: tasks.get(e.taskId)?.title ?? '',
      workedOn: e.workedOn,
      minutes: e.minutes,
      note: e.note ?? null,
      revision: e.revision,
    };
  }

  /** `GET /portal/tasks/:taskId`. */
  async task(ctx: ExternalContext, taskId: string): Promise<PortalTaskView> {
    const { task, access } = await this.requireTask(ctx, taskId);
    const [comments, entries] = await Promise.all([
      this.comments
        .find({
          organizationId: ctx.organizationId,
          taskId: String(task._id),
          visibility: 'shared',
          deletedAt: null,
        })
        .sort({ createdAt: 1, _id: 1 })
        .limit(PORTAL_COMMENTS_MAX)
        .lean<WorkCommentLean[]>()
        .exec(),
      ctx.kind === 'consultant'
        ? this.time
            .find({
              organizationId: ctx.organizationId,
              taskId: String(task._id),
              userId: ctx.accountId,
              deletedAt: null,
            })
            .sort({ workedOn: -1, _id: -1 })
            .limit(200)
            .lean<WorkTimeEntryLean[]>()
            .exec()
        : Promise.resolve([] as WorkTimeEntryLean[]),
    ]);
    const ca = task.clientApproval;
    const infos = new Map([[String(task._id), { number: task.number, title: task.title }]]);
    return {
      task: this.summaryOf(ctx, access.project, task),
      projectId: String(access.project._id),
      projectName: access.project.name,
      // ADR-0080 : fuseau dans lequel se lit l'heure d'échéance.
      timeZone:
        (await this.clock?.timeZoneOf(access.project.organizationId)) ?? WORK_DEFAULT_TIME_ZONE,
      description: task.description ?? null,
      clientApproval: {
        ...this.approvalOf(task),
        decidedAt: ca?.required && ca.decidedAt ? new Date(ca.decidedAt).toISOString() : null,
        reason: ca?.required ? (ca.reason ?? null) : null,
      },
      comments: await this.commentViews(ctx, access.project, comments),
      canDecide: ctx.kind === 'client' && ca?.required === true && ca.state === 'pending',
      canLogTime: this.isMine(ctx, task),
      timeEntries: entries.map((e) => this.entryView(e, infos)),
    };
  }

  // ── Écritures ────────────────────────────────────────────────────────────

  /** `POST /portal/tasks/:taskId/comments` — toujours partagé. */
  async comment(
    ctx: ExternalContext,
    taskId: string,
    body: PortalCommentBody,
  ): Promise<PortalCommentView> {
    const { task, access } = await this.requireTask(ctx, taskId);
    const created = await this.comments.create({
      organizationId: ctx.organizationId,
      projectId: task.projectId,
      taskId: String(task._id),
      authorUserId: ctx.accountId,
      body: body.body,
      mentionedUserIds: [],
      attachmentIds: [],
      editedAt: null,
      deletedAt: null,
      visibility: 'shared',
      revision: 1,
      createdBy: ctx.accountId,
      updatedBy: ctx.accountId,
      _schemaVersion: 1,
    });
    const commentId = String(created._id);
    await this.activity.record(ctx.organizationId, {
      projectId: task.projectId,
      taskId: String(task._id),
      actorUserId: ctx.accountId,
      kind: 'comment.added',
      data: { commentId, mentions: 0, attachments: 0, visibility: 'shared', external: ctx.kind },
    });
    // ADR-0079 § 3 bis : « un client ou un consultant commente » — responsable,
    // collaborateurs, abonnés, chef et adjoint, selon leur mode.
    await this.notifier.taskEvent({
      organizationId: ctx.organizationId,
      recipients: [
        task.assigneeUserId,
        ...(task.collaboratorUserIds ?? []),
        ...(task.followerUserIds ?? []),
        access.project.ownerUserId,
        access.project.deputyUserId,
      ],
      kind: 'work.external_comment',
      projectId: task.projectId,
      taskId: String(task._id),
      title: `${ctx.name} (${ctx.kind === 'client' ? 'client' : 'consultant'}) a commenté #${task.number} ${task.title}`,
      actorUserId: ctx.accountId,
    });
    // ADR-0079 § 9 : les AUTRES externes qui voient la tâche reçoivent un e-mail.
    await this.externalNotifier?.sharedComment(
      ctx.organizationId,
      {
        id: String(task._id),
        projectId: task.projectId,
        number: task.number,
        title: task.title,
        clientVisible: task.clientVisible ?? false,
        consultantAssigneeId: task.consultantAssigneeId ?? null,
        consultantCollaboratorIds: task.consultantCollaboratorIds ?? [],
      },
      ctx.accountId,
    );
    const doc = await this.comments.findById(created._id).lean<WorkCommentLean>().exec();
    return (await this.commentViews(ctx, access.project, [doc!]))[0]!;
  }

  /** `POST /portal/tasks/:taskId/client-decision` — contact client seulement. */
  async clientDecision(
    ctx: ExternalContext,
    taskId: string,
    body: PortalClientDecisionBody,
  ): Promise<PortalTaskView> {
    if (ctx.kind !== 'client') {
      forbidden('WORK_CLIENT_DECISION_FORBIDDEN', 'Seul le contact client valide un livrable.');
    }
    const { task, access } = await this.requireTask(ctx, taskId);
    const ca = task.clientApproval;
    if (!ca?.required || ca.state !== 'pending') {
      conflict('WORK_CLIENT_APPROVAL_NOT_PENDING', 'Ce livrable n’attend pas votre validation.', {
        state: ca?.required ? ca.state : 'none',
      });
    }
    if (task.revision !== body.expectedRevision) staleRevision(task.revision);
    const state = body.decision === 'approve' ? 'approved' : 'changes_requested';
    const reason = body.decision === 'approve' ? null : (body.reason ?? null);
    const res = await this.tasks
      .updateOne(
        {
          _id: task._id,
          organizationId: ctx.organizationId,
          revision: body.expectedRevision,
          'clientApproval.state': 'pending',
        },
        {
          $set: {
            clientApproval: {
              required: true,
              state,
              decidedBy: ctx.accountId,
              decidedAt: new Date(),
              reason,
            },
            updatedBy: ctx.accountId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(task.revision + 1);
    await this.activity.record(ctx.organizationId, {
      projectId: task.projectId,
      taskId: String(task._id),
      actorUserId: ctx.accountId,
      kind:
        state === 'approved'
          ? 'task.client_approval_approved'
          : 'task.client_approval_changes_requested',
      data: { accountId: ctx.accountId, ...(reason ? { reason: reason.slice(0, 500) } : {}) },
    });
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.accountId,
      actorRole: this.auditRole(ctx),
      action:
        state === 'approved'
          ? 'work.external.client_approved'
          : 'work.external.client_changes_requested',
      targetType: 'work_task',
      targetId: String(task._id),
      metadata: { projectId: task.projectId, accountId: ctx.accountId },
    });
    // ADR-0079 § 3 bis : validé ou modifications demandées par le client — responsable,
    // collaborateurs, chef, adjoint. Le MOTIF reste dans Lalanda (jamais dans le titre).
    await this.notifier.taskEvent({
      organizationId: ctx.organizationId,
      recipients: [
        task.assigneeUserId,
        ...(task.collaboratorUserIds ?? []),
        access.project.ownerUserId,
        access.project.deputyUserId,
      ],
      kind: state === 'approved' ? 'work.client_approved' : 'work.client_changes_requested',
      projectId: task.projectId,
      taskId: String(task._id),
      title:
        state === 'approved'
          ? `Le client a approuvé #${task.number} ${task.title}`
          : `Le client demande des modifications sur #${task.number} ${task.title}`,
      actorUserId: ctx.accountId,
    });
    return this.task(ctx, taskId);
  }

  // ── Temps du consultant ──────────────────────────────────────────────────

  private requireConsultant(ctx: ExternalContext): void {
    if (ctx.kind !== 'consultant') {
      forbidden('WORK_EXTERNAL_TIME_FORBIDDEN', 'Seul un consultant saisit du temps.');
    }
  }

  /** Saisie sur SA tâche (responsable ou collaborateur consultant). */
  async createTime(
    ctx: ExternalContext,
    taskId: string,
    body: Omit<CreateTimeEntryBody, 'userId'>,
  ): Promise<PortalTimeEntryView> {
    this.requireConsultant(ctx);
    const { task } = await this.requireTask(ctx, taskId);
    if (!this.isMine(ctx, task)) {
      forbidden(
        'WORK_EXTERNAL_TIME_FORBIDDEN',
        'Vous saisissez du temps sur vos tâches seulement.',
      );
    }
    const view = await this.timeService.create(
      ctx.organizationId,
      taskId,
      body,
      this.actorOf(ctx),
      {
        external: true,
      },
    );
    // ADR-0079 § 3 bis : le référent interne voit le temps de son consultant (rafales
    // regroupées par tâche). Jamais de taux ni de montant.
    const consultant = await this.timesheets.consultantOf(ctx.organizationId, ctx.accountId);
    if (consultant?.referentUserId) {
      const h = Math.floor(view.minutes / 60);
      const m = view.minutes % 60;
      const duree = h > 0 ? `${h} h${m > 0 ? ` ${String(m).padStart(2, '0')}` : ''}` : `${m} min`;
      await this.notifier.taskEvent({
        organizationId: ctx.organizationId,
        recipients: [consultant.referentUserId],
        kind: 'work.consultant_time_logged',
        projectId: task.projectId,
        taskId: String(task._id),
        title: `${ctx.name} (consultant) a saisi ${duree} sur #${task.number} ${task.title}`,
        actorUserId: ctx.accountId,
        audience: 'manager',
      });
    }
    return {
      id: view.id,
      taskId: view.taskId,
      taskNumber: view.taskNumber,
      taskTitle: view.taskTitle,
      workedOn: view.workedOn,
      minutes: view.minutes,
      note: view.note,
      revision: view.revision,
    };
  }

  private async requireOwnEntry(ctx: ExternalContext, entryId: string): Promise<WorkTimeEntryLean> {
    if (!isWorkId(entryId)) timeEntryNotFound();
    const entry = await this.time
      .findOne({
        _id: oid(entryId),
        organizationId: ctx.organizationId,
        userId: ctx.accountId,
        deletedAt: null,
      })
      .lean<WorkTimeEntryLean>()
      .exec();
    if (!entry) timeEntryNotFound();
    const { task } = await this.requireTask(ctx, entry.taskId).catch(() => timeEntryNotFound());
    if (!this.isMine(ctx, task)) timeEntryNotFound();
    return entry;
  }

  async updateTime(
    ctx: ExternalContext,
    entryId: string,
    body: UpdateTimeEntryBody,
  ): Promise<PortalTimeEntryView> {
    this.requireConsultant(ctx);
    await this.requireOwnEntry(ctx, entryId);
    const view = await this.timeService.update(
      ctx.organizationId,
      entryId,
      body,
      this.actorOf(ctx),
      {
        external: true,
      },
    );
    return {
      id: view.id,
      taskId: view.taskId,
      taskNumber: view.taskNumber,
      taskTitle: view.taskTitle,
      workedOn: view.workedOn,
      minutes: view.minutes,
      note: view.note,
      revision: view.revision,
    };
  }

  async removeTime(ctx: ExternalContext, entryId: string): Promise<void> {
    this.requireConsultant(ctx);
    await this.requireOwnEntry(ctx, entryId);
    await this.timeService.remove(ctx.organizationId, entryId, this.actorOf(ctx), {
      external: true,
    });
  }

  /** `GET /portal/timesheet?week=` — sa semaine (lundi), ses saisies, l'état de validation. */
  async timesheet(
    ctx: ExternalContext,
    week: string | undefined,
    now = new Date(),
  ): Promise<PortalTimesheetView> {
    this.requireConsultant(ctx);
    const monday = mondayOfDay(week ?? kinshasaDayOf(now));
    const sunday = new Date(Date.parse(`${monday}T00:00:00Z`) + 6 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const entries = await this.time
      .find({
        organizationId: ctx.organizationId,
        userId: ctx.accountId,
        deletedAt: null,
        workedOn: { $gte: monday, $lte: sunday },
      })
      .sort({ workedOn: 1, _id: 1 })
      .lean<WorkTimeEntryLean[]>()
      .exec();
    const taskIds = [...new Set(entries.map((e) => e.taskId))].filter(isWorkId);
    const tasks =
      taskIds.length === 0
        ? []
        : await this.tasks
            .find(
              { organizationId: ctx.organizationId, _id: { $in: taskIds.map(oid) } },
              { number: 1, title: 1 },
            )
            .lean<{ _id: unknown; number: number; title: string }[]>()
            .exec();
    const infos = new Map(tasks.map((t) => [String(t._id), { number: t.number, title: t.title }]));
    const approval = await this.timesheets.approvalOf(
      ctx.organizationId,
      this.actorOf(ctx),
      ctx.accountId,
      monday,
      false,
      now,
    );
    return {
      week: monday,
      entries: entries.map((e) => this.entryView(e, infos)),
      totalMinutes: entries.reduce((s, e) => s + e.minutes, 0),
      status: approval.status,
      revision: approval.revision,
      reason: approval.reason,
      canSubmit: approval.canSubmit,
      locked: approval.locked,
    };
  }

  /** `POST /portal/timesheet/submit` — validée ensuite par son référent (ADR-0077). */
  async submitTimesheet(
    ctx: ExternalContext,
    body: SubmitTimesheetBody,
  ): Promise<PortalTimesheetView> {
    this.requireConsultant(ctx);
    await this.timesheets.submit(
      ctx.organizationId,
      body,
      this.actorOf(ctx),
      new Date(),
      this.auditRole(ctx),
    );
    return this.timesheet(ctx, body.week);
  }

  /** Accès de la session encore ouverts (garde déjà passée) — sert au contrôle du lot. */
  async openProjectCount(ctx: ExternalContext): Promise<number> {
    return (await this.lifecycle.openProjectsOf(ctx.organizationId, ctx.accountId)).length;
  }
}
