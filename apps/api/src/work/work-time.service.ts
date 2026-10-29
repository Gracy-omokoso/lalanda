// Temps passé et coûts horaires datés — ADR-0039 § 2.6 et § 2.7.
//
// Temps :
//   - `userId` absent : l'appelant ; pour autrui, `work.manage`
//     (`403 WORK_TIME_FOR_OTHER`), et la personne doit être membre ;
//   - `workedOn` jamais futur au jour de Kinshasa (`WORK_TIME_IN_FUTURE`) ;
//   - somme par (utilisateur, jour) ≤ 1 440 minutes (`WORK_TIME_DAY_OVERFLOW`) ;
//   - `work_tasks.loggedMinutes` est un CACHE maintenu par `$inc` dans la MÊME
//     transaction que la saisie ; `recomputeLoggedMinutes` le reconstruit ;
//   - suppression logique : le coût passé d'un projet ne disparaît pas sans trace.
//   Les vues de temps rendent des MINUTES, jamais un coût (§ 4).
//
// Taux (donnée salariale, `treasury.manage` en plus de `work.*`) : le taux
// applicable à une saisie est celui dont `effectiveFrom` est le plus récent
// ≤ `workedOn`. Le coût n'est jamais stocké : il se calcule à la lecture, dans le
// moteur (lot L4a, marge). Journalisé dans `audit_events` (`work.rate.set|removed`).

import {
  WORK_LIMITS,
  addDays,
  kinshasaDayOf,
  type CreateTimeEntryBody,
  type ListTimeEntriesQuery,
  type SetMemberRateBody,
  type TimeEntryView,
  type TimeSummaryView,
  type UpdateTimeEntryBody,
  type WorkMemberRateView,
  type WorkPage,
} from '@lalanda/shared/work';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { beforeTimeCursor, decodeTimeCursor, encodeTimeCursor } from '../crm/time-cursor.js';
import { isDuplicateKey } from '../sales/sales.errors.js';
import {
  actorCan,
  conflict,
  forbidden,
  invalid,
  invalidCursor,
  isWorkId,
  oid,
  rateNotFound,
  staleRevision,
  timeEntryNotFound,
  type WorkActor,
} from './work.common.js';
import { WorkActivityService } from './work-activity.service.js';
import { WorkMembersService } from './work-members.service.js';
import { WorkProjectsService } from './work-projects.service.js';
import { WorkTasksService } from './work-tasks.service.js';
import {
  WorkMemberRate,
  WorkTask,
  WorkTimeEntry,
  type WorkMemberRateDocument,
  type WorkMemberRateLean,
  type WorkTaskDocument,
  type WorkTimeEntryDocument,
  type WorkTimeEntryLean,
} from './work.schemas.js';

/** Lundi de la semaine ISO d'une date civile. */
export function isoWeekStart(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

@Injectable()
export class WorkTimeService {
  constructor(
    @InjectModel(WorkTimeEntry.name) private readonly entries: Model<WorkTimeEntryDocument>,
    @InjectModel(WorkTask.name) private readonly tasks: Model<WorkTaskDocument>,
    @InjectModel(WorkMemberRate.name) private readonly rates: Model<WorkMemberRateDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(WorkTasksService) private readonly taskService: WorkTasksService,
    @Inject(WorkProjectsService) private readonly projects: WorkProjectsService,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(WorkActivityService) private readonly activity: WorkActivityService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Lecture ──────────────────────────────────────────────────────────────

  private async requireOwn(organizationId: string, entryId: string): Promise<WorkTimeEntryLean> {
    if (!isWorkId(entryId)) timeEntryNotFound();
    const doc = await this.entries
      .findOne({ _id: oid(entryId), organizationId, deletedAt: null })
      .lean<WorkTimeEntryLean>()
      .exec();
    if (!doc) timeEntryNotFound();
    return doc;
  }

  private async views(
    organizationId: string,
    docs: readonly WorkTimeEntryLean[],
  ): Promise<TimeEntryView[]> {
    const taskIds = [...new Set(docs.map((d) => d.taskId))].filter(isWorkId);
    const [tasks, refs] = await Promise.all([
      taskIds.length === 0
        ? []
        : this.tasks
            .find({ organizationId, _id: { $in: taskIds.map(oid) } }, { number: 1, title: 1 })
            .lean<{ _id: unknown; number: number; title: string }[]>()
            .exec(),
      this.members.refs(docs.map((d) => d.userId)),
    ]);
    const byId = new Map(tasks.map((t) => [String(t._id), t]));
    return docs.map((d) => ({
      id: String(d._id),
      projectId: d.projectId,
      taskId: d.taskId,
      taskNumber: byId.get(d.taskId)?.number ?? 0,
      taskTitle: byId.get(d.taskId)?.title ?? '',
      user: WorkMembersService.refOf(refs, d.userId),
      workedOn: d.workedOn,
      minutes: d.minutes,
      note: d.note ?? null,
      revision: d.revision,
      createdBy: d.createdBy,
      createdAt: new Date(d.createdAt).toISOString(),
    }));
  }

  async list(
    organizationId: string,
    query: ListTimeEntriesQuery,
    actor: WorkActor,
  ): Promise<WorkPage<TimeEntryView>> {
    const and: Record<string, unknown>[] = [{ organizationId, deletedAt: null }];
    if (query.projectId) {
      await this.projects.requireOwn(organizationId, query.projectId);
      and.push({ projectId: query.projectId });
    }
    if (query.taskId) {
      await this.taskService.requireOwn(organizationId, query.taskId);
      and.push({ taskId: query.taskId });
    }
    if (query.userId) and.push({ userId: query.userId === 'me' ? actor.userId : query.userId });
    if (query.from) and.push({ workedOn: { $gte: query.from } });
    if (query.to) and.push({ workedOn: { $lte: query.to } });
    if (query.cursor !== undefined) {
      const cursor = decodeTimeCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(beforeTimeCursor('createdAt', cursor));
    }
    const docs = await this.entries
      .find({ $and: and })
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<WorkTimeEntryLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: await this.views(organizationId, page),
      nextCursor:
        docs.length > query.limit && last
          ? encodeTimeCursor(new Date(last.createdAt), String(last._id))
          : null,
    };
  }

  /** Minutes par membre, par tâche, par semaine (jamais de coût). */
  async summary(organizationId: string, projectId: string): Promise<TimeSummaryView> {
    const project = await this.projects.requireOwn(organizationId, projectId);
    const id = String(project._id);
    const rows = await this.entries
      .aggregate<{ _id: { userId: string; taskId: string; workedOn: string }; minutes: number }>([
        { $match: { organizationId, projectId: id, deletedAt: null } },
        {
          $group: {
            _id: { userId: '$userId', taskId: '$taskId', workedOn: '$workedOn' },
            minutes: { $sum: '$minutes' },
          },
        },
      ])
      .exec();
    const byMember = new Map<string, number>();
    const byTask = new Map<string, number>();
    const byWeek = new Map<string, number>();
    let total = 0;
    for (const r of rows) {
      total += r.minutes;
      byMember.set(r._id.userId, (byMember.get(r._id.userId) ?? 0) + r.minutes);
      byTask.set(r._id.taskId, (byTask.get(r._id.taskId) ?? 0) + r.minutes);
      const week = isoWeekStart(r._id.workedOn);
      byWeek.set(week, (byWeek.get(week) ?? 0) + r.minutes);
    }
    const taskIds = [...byTask.keys()].filter(isWorkId);
    const [tasks, refs] = await Promise.all([
      taskIds.length === 0
        ? []
        : this.tasks
            .find({ organizationId, _id: { $in: taskIds.map(oid) } }, { number: 1, title: 1 })
            .lean<{ _id: unknown; number: number; title: string }[]>()
            .exec(),
      this.members.refs([...byMember.keys()]),
    ]);
    const taskInfo = new Map(tasks.map((t) => [String(t._id), t]));
    return {
      projectId: id,
      totalMinutes: total,
      byMember: [...byMember]
        .map(([u, minutes]) => ({ user: WorkMembersService.refOf(refs, u), minutes }))
        .sort((a, b) => b.minutes - a.minutes),
      byTask: [...byTask]
        .map(([t, minutes]) => ({
          taskId: t,
          number: taskInfo.get(t)?.number ?? 0,
          title: taskInfo.get(t)?.title ?? '',
          minutes,
        }))
        .sort((a, b) => a.number - b.number),
      byWeek: [...byWeek]
        .map(([weekStart, minutes]) => ({ weekStart, minutes }))
        .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1)),
    };
  }

  // ── Écriture ─────────────────────────────────────────────────────────────

  private assertNotFuture(workedOn: string): void {
    if (workedOn > kinshasaDayOf(new Date())) {
      invalid(
        'workedOn',
        'WORK_TIME_IN_FUTURE',
        'Le temps se saisit une fois travaillé : la date ne peut pas être future (jour de Kinshasa).',
      );
    }
  }

  private async assertDayCapacity(
    organizationId: string,
    userId: string,
    workedOn: string,
    minutes: number,
    session: ClientSession,
    excludeId?: unknown,
  ): Promise<void> {
    const match: Record<string, unknown> = { organizationId, userId, workedOn, deletedAt: null };
    if (excludeId) match['_id'] = { $ne: excludeId };
    const [sum] = await this.entries
      .aggregate<{ total: number }>([
        { $match: match },
        { $group: { _id: null, total: { $sum: '$minutes' } } },
      ])
      .session(session)
      .exec();
    if ((sum?.total ?? 0) + minutes > WORK_LIMITS.minutesPerDayMax) {
      invalid(
        'minutes',
        'WORK_TIME_DAY_OVERFLOW',
        `Une journée compte au plus ${WORK_LIMITS.minutesPerDayMax} minutes : ${sum?.total ?? 0} déjà saisies ce jour-là.`,
      );
    }
  }

  private async inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let out!: T;
      await session.withTransaction(async () => {
        out = await fn(session);
      });
      return out;
    } finally {
      await session.endSession();
    }
  }

  /** Saisie d'autrui : `work.manage` exigé (contrôle de ressource). */
  private assertForOther(actor: WorkActor, userId: string): void {
    if (userId !== actor.userId && !actorCan(actor, 'work.manage')) {
      forbidden(
        'WORK_TIME_FOR_OTHER',
        'Saisir, modifier ou supprimer le temps d’un autre membre exige de gérer les projets.',
      );
    }
  }

  async create(
    organizationId: string,
    taskId: string,
    body: CreateTimeEntryBody,
    actor: WorkActor,
  ): Promise<TimeEntryView> {
    const { task } = await this.taskService.requireWritable(organizationId, taskId);
    const userId = body.userId ?? actor.userId;
    this.assertForOther(actor, userId);
    await this.members.requireMember(organizationId, userId);
    this.assertNotFuture(body.workedOn);
    const id = await this.inTransaction(async (session) => {
      await this.assertDayCapacity(organizationId, userId, body.workedOn, body.minutes, session);
      const [created] = await this.entries.create(
        [
          {
            organizationId,
            projectId: task.projectId,
            taskId: String(task._id),
            userId,
            workedOn: body.workedOn,
            minutes: body.minutes,
            note: body.note ?? null,
            deletedAt: null,
            revision: 1,
            createdBy: actor.userId,
            updatedBy: actor.userId,
            _schemaVersion: 1,
          },
        ],
        { session },
      );
      await this.tasks
        .updateOne(
          { _id: task._id, organizationId },
          { $inc: { loggedMinutes: body.minutes } },
          { session, timestamps: false },
        )
        .exec();
      return String(created!._id);
    });
    await this.activity.record(organizationId, {
      projectId: task.projectId,
      taskId: String(task._id),
      actorUserId: actor.userId,
      kind: 'time.logged',
      data: { entryId: id, userId, workedOn: body.workedOn, minutes: body.minutes },
    });
    return (await this.views(organizationId, [await this.requireOwn(organizationId, id)]))[0]!;
  }

  async update(
    organizationId: string,
    entryId: string,
    body: UpdateTimeEntryBody,
    actor: WorkActor,
  ): Promise<TimeEntryView> {
    const current = await this.requireOwn(organizationId, entryId);
    this.assertForOther(actor, current.userId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    await this.taskService.requireWritable(organizationId, current.taskId);
    const workedOn = body.workedOn ?? current.workedOn;
    const minutes = body.minutes ?? current.minutes;
    this.assertNotFuture(workedOn);
    await this.inTransaction(async (session) => {
      await this.assertDayCapacity(
        organizationId,
        current.userId,
        workedOn,
        minutes,
        session,
        current._id,
      );
      const res = await this.entries
        .updateOne(
          { _id: current._id, organizationId, revision: body.expectedRevision, deletedAt: null },
          {
            $set: {
              workedOn,
              minutes,
              ...(body.note !== undefined ? { note: body.note } : {}),
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(current.revision + 1);
      if (minutes !== current.minutes) {
        await this.tasks
          .updateOne(
            { _id: oid(current.taskId), organizationId },
            { $inc: { loggedMinutes: minutes - current.minutes } },
            { session, timestamps: false },
          )
          .exec();
      }
    });
    await this.activity.record(organizationId, {
      projectId: current.projectId,
      taskId: current.taskId,
      actorUserId: actor.userId,
      kind: 'time.updated',
      data: {
        entryId,
        from: { workedOn: current.workedOn, minutes: current.minutes },
        to: { workedOn, minutes },
      },
    });
    return (await this.views(organizationId, [await this.requireOwn(organizationId, entryId)]))[0]!;
  }

  async remove(organizationId: string, entryId: string, actor: WorkActor): Promise<void> {
    const current = await this.requireOwn(organizationId, entryId);
    this.assertForOther(actor, current.userId);
    await this.taskService.requireWritable(organizationId, current.taskId);
    const removed = await this.inTransaction(async (session) => {
      const res = await this.entries
        .updateOne(
          { _id: current._id, organizationId, deletedAt: null },
          { $set: { deletedAt: new Date(), updatedBy: actor.userId }, $inc: { revision: 1 } },
          { session },
        )
        .exec();
      if (res.modifiedCount !== 1) return false;
      await this.tasks
        .updateOne(
          { _id: oid(current.taskId), organizationId },
          { $inc: { loggedMinutes: -current.minutes } },
          { session, timestamps: false },
        )
        .exec();
      return true;
    });
    if (!removed) return;
    await this.activity.record(organizationId, {
      projectId: current.projectId,
      taskId: current.taskId,
      actorUserId: actor.userId,
      kind: 'time.deleted',
      data: { entryId, userId: current.userId, workedOn: current.workedOn, minutes: current.minutes },
    });
  }

  /** Reconstruit le cache `loggedMinutes` d'une tâche depuis ses saisies. */
  async recomputeLoggedMinutes(organizationId: string, taskId: string): Promise<number> {
    const task = await this.taskService.requireOwn(organizationId, taskId);
    const [sum] = await this.entries
      .aggregate<{ total: number }>([
        { $match: { organizationId, taskId: String(task._id), deletedAt: null } },
        { $group: { _id: null, total: { $sum: '$minutes' } } },
      ])
      .exec();
    const total = sum?.total ?? 0;
    await this.tasks
      .updateOne(
        { _id: task._id, organizationId },
        { $set: { loggedMinutes: total } },
        { timestamps: false },
      )
      .exec();
    return total;
  }

  // ── Taux horaires datés ──────────────────────────────────────────────────

  private async rateViews(docs: readonly WorkMemberRateLean[]): Promise<WorkMemberRateView[]> {
    const refs = await this.members.refs(docs.map((d) => d.userId));
    return docs.map((d) => ({
      id: String(d._id),
      user: WorkMembersService.refOf(refs, d.userId),
      currency: d.currency,
      hourlyCost: d.hourlyCost,
      effectiveFrom: d.effectiveFrom,
      createdBy: d.createdBy,
      createdAt: new Date(d.createdAt).toISOString(),
    }));
  }

  async listRates(organizationId: string): Promise<{ items: WorkMemberRateView[] }> {
    const docs = await this.rates
      .find({ organizationId })
      .sort({ userId: 1, effectiveFrom: -1 })
      .lean<WorkMemberRateLean[]>()
      .exec();
    return { items: await this.rateViews(docs) };
  }

  async setRate(
    organizationId: string,
    body: SetMemberRateBody,
    actor: WorkActor,
  ): Promise<WorkMemberRateView> {
    await this.members.requireMember(organizationId, body.userId);
    let id: string;
    try {
      const created = await this.rates.create({
        organizationId,
        userId: body.userId,
        currency: body.currency,
        hourlyCost: body.hourlyCost,
        effectiveFrom: body.effectiveFrom,
        createdBy: actor.userId,
        _schemaVersion: 1,
      });
      id = String(created._id);
    } catch (err) {
      if (isDuplicateKey(err)) {
        conflict(
          'WORK_RATE_DUPLICATE',
          'Un taux existe déjà pour ce membre à cette date : supprimez-le avant d’en poser un autre.',
        );
      }
      throw err;
    }
    // Le montant n'est pas journalisé : `audit_events` est lu plus largement que les taux.
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role ?? 'unknown',
      action: 'work.rate.set',
      targetType: 'work_member_rate',
      targetId: id,
      metadata: { userId: body.userId, currency: body.currency, effectiveFrom: body.effectiveFrom },
    });
    const doc = await this.rates.findById(id).lean<WorkMemberRateLean>().exec();
    return (await this.rateViews([doc!]))[0]!;
  }

  async removeRate(organizationId: string, rateId: string, actor: WorkActor): Promise<void> {
    if (!isWorkId(rateId)) rateNotFound();
    const doc = await this.rates
      .findOneAndDelete({ _id: oid(rateId), organizationId })
      .lean<WorkMemberRateLean>()
      .exec();
    if (!doc) rateNotFound();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role ?? 'unknown',
      action: 'work.rate.removed',
      targetType: 'work_member_rate',
      targetId: rateId,
      metadata: { userId: doc.userId, currency: doc.currency, effectiveFrom: doc.effectiveFrom },
    });
  }
}
