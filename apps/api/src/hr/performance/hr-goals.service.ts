// Objectifs individuels (ADR-0051 § 2.5, § 3.5). ADR-0051 — H15.
//
// - Le collaborateur PROPOSE pour lui-même (`proposed`) ; le manager de la chaîne ou un
//   détenteur de `hr.manage` + `performance.read` POSE un objectif pour autrui : il est
//   alors convenu par celui qui le pose (`agreed`, `agreedBy`).
// - `agreed` n'est JAMAIS posé par le collaborateur pour lui-même
//   (`409 SELF_APPROVAL_FORBIDDEN`), le statut final non plus ; il est posé par une
//   personne avec un commentaire (`goalTransition` du moteur pour l'enchaînement).
// - Avancement : déclarations en ajout seul ; AUCUN avancement calculé, aucune somme de
//   poids imposée, aucun effet automatique.
// - Hors portée : 404. Aucun champ d'objectif n'entre dans l'IA, le brief ni une
//   notification (titre : l'étape seulement).

import { goalTransition } from '@lalanda/engine';
import {
  GOAL_STATUSES,
  HrCalendarDay,
  HrId,
  PERFORMANCE_LIMITS,
  type CloseGoalBody,
  type CreateGoalBody,
  type GoalProgressBody,
  type GoalStatus,
  type UpdateGoalBody,
} from '@lalanda/shared/hr';
import {
  ForbiddenException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';
import { z } from 'zod';

import { AuditService } from '../../authz/audit.service.js';
import { conflict, staleRevision } from '../../sales/sales.errors.js';
import { employeeNotFound } from '../scope/hr-errors.js';
import {
  HrPerformanceAccess,
  directManagerUserId,
  employeeName,
  goalNotFound,
  reviewCycleNotFound,
  type PerformanceRelation,
  type PerformanceViewer,
} from './hr-performance-access.js';
import { HrPerformanceNotifier } from './hr-performance-notifier.js';
import {
  Goal,
  ReviewCycle,
  type GoalDocument,
  type GoalLean,
  type ReviewCycleDocument,
} from './performance.schemas.js';

/** `GET /hr/goals` — période par chevauchement (`from`, `to`). */
export const ListGoalsQuery = z
  .object({
    employeeId: HrId.optional(),
    from: HrCalendarDay.optional(),
    to: HrCalendarDay.optional(),
    status: z.enum(GOAL_STATUSES).optional(),
  })
  .strict();
export type ListGoalsQuery = z.output<typeof ListGoalsQuery>;

/** `POST /hr/goals/:id/agree`. */
export const AgreeGoalBody = z.object({ expectedRevision: z.number().int().min(1) }).strict();
export type AgreeGoalBody = z.output<typeof AgreeGoalBody>;

export interface GoalView {
  id: string;
  employeeId: string;
  period: { from: string; to: string };
  reviewCycleId: string | null;
  title: string;
  description: string | null;
  measure: string | null;
  target: Goal['target'];
  weight: number | null;
  workProjectId: string | null;
  status: GoalStatus;
  proposedBy: string;
  agreedBy: string | null;
  agreedAt: string | null;
  closedBy: string | null;
  closedAt: string | null;
  closeComment: string | null;
  progress: { at: string; by: string; percent: number | null; note: string }[];
  visibility: 'private';
  revision: number;
  createdAt: string;
  updatedAt: string;
}

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

export function goalViewOf(g: GoalLean): GoalView {
  return {
    id: String(g._id),
    employeeId: g.employeeId,
    period: { from: g.period.from, to: g.period.to },
    reviewCycleId: g.reviewCycleId ?? null,
    title: g.title,
    description: g.description ?? null,
    measure: g.measure ?? null,
    target: g.target ?? null,
    weight: g.weight ?? null,
    workProjectId: g.workProjectId ?? null,
    status: g.status,
    proposedBy: g.proposedBy,
    agreedBy: g.agreedBy ?? null,
    agreedAt: iso(g.agreedAt),
    closedBy: g.closedBy ?? null,
    closedAt: iso(g.closedAt),
    closeComment: g.closeComment ?? null,
    progress: (g.progress ?? []).map((p) => ({
      at: new Date(p.at).toISOString(),
      by: p.by,
      percent: p.percent ?? null,
      note: p.note,
    })),
    visibility: 'private',
    revision: g.revision,
    createdAt: new Date(g.createdAt).toISOString(),
    updatedAt: new Date(g.updatedAt).toISOString(),
  };
}

function selfApprovalForbidden(): never {
  conflict(
    'SELF_APPROVAL_FORBIDDEN',
    'Un objectif est convenu et clos par le manager ou les RH, jamais par le collaborateur pour lui-même.',
  );
}

function goalWrongStatus(status: GoalStatus): never {
  conflict('GOAL_WRONG_STATUS', 'Cet objectif ne peut pas changer ainsi dans son statut actuel.', {
    status,
  });
}

/** Le lecteur voit l'objectif sans pouvoir l'écrire (`performance.read` sans `hr.manage`). */
function writeForbidden(role: string): never {
  throw new ForbiddenException({
    code: 'FORBIDDEN',
    action: 'hr.manage',
    role,
    customized: false,
    message: 'Votre rôle permet de consulter les objectifs du personnel, pas de les modifier.',
  });
}

@Injectable()
export class HrGoalsService {
  constructor(
    @InjectModel(Goal.name) private readonly goals: Model<GoalDocument>,
    @InjectModel(ReviewCycle.name) private readonly cycles: Model<ReviewCycleDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(HrPerformanceAccess) private readonly access: HrPerformanceAccess,
    @Inject(HrPerformanceNotifier) private readonly notifier: HrPerformanceNotifier,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Manager de la chaîne, ou `hr.manage` + `performance.read`. */
  private canManage(pv: PerformanceViewer, rel: PerformanceRelation): boolean {
    return rel.chain || (rel.perf && pv.hrManage);
  }

  async list(
    organizationId: string,
    pv: PerformanceViewer,
    q: ListGoalsQuery,
  ): Promise<GoalView[]> {
    const filter: Record<string, unknown> = { organizationId };
    if (q.employeeId !== undefined) {
      if (this.access.relationTo(pv, q.employeeId) === null) employeeNotFound();
      filter['employeeId'] = q.employeeId;
    } else {
      const visible = this.access.visibleEmployeeIds(pv);
      if (visible !== 'all') filter['employeeId'] = { $in: visible };
    }
    if (q.from !== undefined) filter['period.to'] = { $gte: q.from };
    if (q.to !== undefined) filter['period.from'] = { $lte: q.to };
    if (q.status !== undefined) filter['status'] = q.status;
    const rows = await this.goals
      .find(filter)
      .sort({ 'period.to': -1, _id: 1 })
      .limit(500)
      .lean<GoalLean[]>()
      .exec();
    return rows.map(goalViewOf);
  }

  async create(
    organizationId: string,
    pv: PerformanceViewer,
    body: CreateGoalBody,
  ): Promise<GoalView> {
    const employeeId = body.employeeId ?? pv.selfEmployeeId;
    if (employeeId === null || employeeId === undefined) {
      conflict(
        'EMPLOYEE_NOT_LINKED',
        'Votre compte n’est relié à aucune fiche collaborateur : demandez aux RH de la relier.',
      );
    }
    const rel = this.access.relationTo(pv, employeeId);
    if (rel === null) employeeNotFound();
    const employee = pv.viewer.byId.get(employeeId)!;
    if (employee.status === 'anonymized') employeeNotFound();
    if (!rel.self && !this.canManage(pv, rel)) writeForbidden(pv.role);
    await this.checkLinks(organizationId, body.reviewCycleId ?? null, body.workProjectId ?? null);

    // Pour soi : une proposition. Pour autrui : posé, donc convenu par celui qui le pose.
    const proposal = rel.self;
    const now = new Date();
    const [created] = await this.goals.create([
      {
        organizationId,
        employeeId,
        period: { from: body.period.from, to: body.period.to },
        reviewCycleId: body.reviewCycleId ?? null,
        title: body.title,
        description: body.description ?? null,
        measure: body.measure ?? null,
        target: targetOf(body.target),
        weight: body.weight ?? null,
        workProjectId: body.workProjectId ?? null,
        status: proposal ? 'proposed' : 'agreed',
        proposedBy: pv.userId,
        agreedBy: proposal ? null : pv.userId,
        agreedAt: proposal ? null : now,
        progress: [],
        visibility: 'private',
        revision: 1,
        createdBy: pv.userId,
        updatedBy: pv.userId,
        _schemaVersion: 1,
      },
    ]);
    const goal = created!.toObject() as unknown as GoalLean;
    if (proposal) {
      await this.notifier.send({
        organizationId,
        kind: 'hr.goal_proposed',
        entityType: 'goal',
        entityId: String(goal._id),
        recipients: [directManagerUserId(pv.viewer.byId, employeeId)],
        title: `Objectif proposé par ${employeeName(employee)}`,
        href: '/rh/objectifs',
        actorUserId: pv.userId,
      });
    } else {
      await this.notifyAgreed(organizationId, goal, pv);
    }
    return goalViewOf(goal);
  }

  async update(
    organizationId: string,
    pv: PerformanceViewer,
    goalId: string,
    body: UpdateGoalBody,
  ): Promise<GoalView> {
    const { goal, rel } = await this.readable(organizationId, pv, goalId);
    if (goal.revision !== body.expectedRevision) staleRevision(goal.revision);
    const manager = this.canManage(pv, rel) && !rel.self;
    if (!manager && !rel.self) writeForbidden(pv.role);
    const editable: readonly GoalStatus[] = manager ? ['proposed', 'agreed'] : ['proposed'];
    if (!editable.includes(goal.status)) goalWrongStatus(goal.status);
    if (body.reviewCycleId !== undefined || body.workProjectId !== undefined) {
      await this.checkLinks(organizationId, body.reviewCycleId ?? null, body.workProjectId ?? null);
    }
    const set: Record<string, unknown> = { updatedBy: pv.userId };
    if (body.period !== undefined) set['period'] = { from: body.period.from, to: body.period.to };
    if (body.reviewCycleId !== undefined) set['reviewCycleId'] = body.reviewCycleId;
    if (body.title !== undefined) set['title'] = body.title;
    if (body.description !== undefined) set['description'] = body.description ?? null;
    if (body.measure !== undefined) set['measure'] = body.measure ?? null;
    if (body.target !== undefined) set['target'] = targetOf(body.target);
    if (body.weight !== undefined) set['weight'] = body.weight;
    if (body.workProjectId !== undefined) set['workProjectId'] = body.workProjectId;
    return this.write(organizationId, goal, set);
  }

  async agree(
    organizationId: string,
    pv: PerformanceViewer,
    goalId: string,
    body: AgreeGoalBody,
  ): Promise<GoalView> {
    const { goal, rel } = await this.readable(organizationId, pv, goalId);
    if (rel.self) selfApprovalForbidden();
    if (!this.canManage(pv, rel)) writeForbidden(pv.role);
    if (goal.revision !== body.expectedRevision) staleRevision(goal.revision);
    if (!goalTransition(goal.status, 'agreed').ok) goalWrongStatus(goal.status);
    const view = await this.write(organizationId, goal, {
      status: 'agreed',
      agreedBy: pv.userId,
      agreedAt: new Date(),
      updatedBy: pv.userId,
    });
    await this.audit.record({
      organizationId,
      actorUserId: pv.userId,
      actorRole: pv.role,
      action: 'hr.goal.agreed',
      targetType: 'hr_goal',
      targetId: goalId,
      metadata: { employeeId: goal.employeeId },
    });
    await this.notifyAgreed(organizationId, { ...goal, status: 'agreed' }, pv);
    return view;
  }

  async close(
    organizationId: string,
    pv: PerformanceViewer,
    goalId: string,
    body: CloseGoalBody,
  ): Promise<GoalView> {
    const { goal, rel } = await this.readable(organizationId, pv, goalId);
    if (rel.self) selfApprovalForbidden();
    if (!this.canManage(pv, rel)) writeForbidden(pv.role);
    if (goal.revision !== body.expectedRevision) staleRevision(goal.revision);
    if (!goalTransition(goal.status, body.status).ok) goalWrongStatus(goal.status);
    const view = await this.write(organizationId, goal, {
      status: body.status,
      closedBy: pv.userId,
      closedAt: new Date(),
      closeComment: body.comment,
      updatedBy: pv.userId,
    });
    await this.audit.record({
      organizationId,
      actorUserId: pv.userId,
      actorRole: pv.role,
      action: 'hr.goal.closed',
      targetType: 'hr_goal',
      targetId: goalId,
      // Le statut posé, jamais le commentaire.
      metadata: { employeeId: goal.employeeId, status: body.status },
    });
    return view;
  }

  /** Déclaration d'avancement, ajout seul ; aucun avancement calculé. */
  async progress(
    organizationId: string,
    pv: PerformanceViewer,
    goalId: string,
    body: GoalProgressBody,
  ): Promise<GoalView> {
    const { goal, rel } = await this.readable(organizationId, pv, goalId);
    if (!rel.self && !this.canManage(pv, rel)) writeForbidden(pv.role);
    if (goal.status !== 'agreed') goalWrongStatus(goal.status);
    if ((goal.progress ?? []).length >= PERFORMANCE_LIMITS.progressMax) {
      conflict('GOAL_PROGRESS_FULL', 'Nombre maximal de déclarations d’avancement atteint.');
    }
    const res = await this.goals
      .updateOne(
        {
          _id: goal._id,
          organizationId,
          status: 'agreed',
          [`progress.${PERFORMANCE_LIMITS.progressMax - 1}`]: { $exists: false },
        },
        {
          $push: {
            progress: {
              at: new Date(),
              by: pv.userId,
              percent: body.percent ?? null,
              note: body.note,
            },
          },
          $set: { updatedBy: pv.userId },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(goal.revision + 1);
    return goalViewOf((await this.goals.findById(goal._id).lean<GoalLean>().exec())!);
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  private async readable(
    organizationId: string,
    pv: PerformanceViewer,
    goalId: string,
  ): Promise<{ goal: GoalLean; rel: PerformanceRelation }> {
    if (!Types.ObjectId.isValid(goalId)) goalNotFound();
    const goal = await this.goals
      .findOne({ _id: new Types.ObjectId(goalId), organizationId })
      .lean<GoalLean>()
      .exec();
    if (!goal) goalNotFound();
    const rel = this.access.relationTo(pv, goal.employeeId);
    if (rel === null) goalNotFound();
    const employee = pv.viewer.byId.get(goal.employeeId);
    if (!employee || employee.status === 'anonymized') goalNotFound();
    return { goal, rel };
  }

  private async write(
    organizationId: string,
    goal: GoalLean,
    set: Record<string, unknown>,
  ): Promise<GoalView> {
    const res = await this.goals
      .updateOne(
        { _id: goal._id, organizationId, revision: goal.revision },
        { $set: set, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(goal.revision + 1);
    return goalViewOf((await this.goals.findById(goal._id).lean<GoalLean>().exec())!);
  }

  /** Campagne et projet RUN de la MÊME organisation (sinon 404 / 422). */
  private async checkLinks(
    organizationId: string,
    reviewCycleId: string | null,
    workProjectId: string | null,
  ): Promise<void> {
    if (reviewCycleId !== null) {
      const cycle = await this.cycles
        .exists({ _id: new Types.ObjectId(reviewCycleId), organizationId })
        .exec();
      if (!cycle) reviewCycleNotFound();
    }
    if (workProjectId !== null) {
      const project = await this.connection
        .collection('work_projects')
        .findOne(
          { _id: new Types.ObjectId(workProjectId), organizationId, archivedAt: null },
          { projection: { _id: 1 } },
        );
      if (!project) {
        throw new UnprocessableEntityException({
          code: 'GOAL_WORK_PROJECT_UNKNOWN',
          message: 'Projet inconnu ou archivé.',
        });
      }
    }
  }

  private async notifyAgreed(
    organizationId: string,
    goal: GoalLean,
    pv: PerformanceViewer,
  ): Promise<void> {
    const employee = pv.viewer.byId.get(goal.employeeId);
    await this.notifier.send({
      organizationId,
      kind: 'hr.goal_agreed',
      entityType: 'goal',
      entityId: String(goal._id),
      recipients: [employee?.status === 'anonymized' ? null : (employee?.userId ?? null)],
      title: 'Un objectif a été convenu avec vous',
      href: '/rh/objectifs',
      actorUserId: pv.userId,
    });
  }
}

function targetOf(t: CreateGoalBody['target']): Goal['target'] {
  if (t === undefined || t === null) return null;
  return t.kind === 'text'
    ? { kind: 'text', value: t.value }
    : { kind: 'number', value: t.value, unit: t.unit ?? null };
}
