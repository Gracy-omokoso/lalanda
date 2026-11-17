// Validation hebdomadaire des feuilles de temps — ADR-0077 § 4 (lève l'écart
// d'ADR-0045 O5 pour la validation seulement).
//
//   - le membre SOUMET sa semaine (en cours, renvoyée ou rouverte → soumise) ;
//   - le validateur APPROUVE (verrou des saisies) ou RENVOIE avec un motif ;
//   - le validateur ROUVRE une semaine approuvée, avec un motif, tracé (historique,
//     audit) ; le verrou est alors levé.
//
// Validateur : le manager du membre (relation du moteur RH, `viewerIsManager` du port
// `WORK_ABSENCES_SOURCE`), ou un détenteur effectif de `work.manage` ; jamais soi-même
// (`403 WORK_TIMESHEET_SELF_APPROVAL`). Hors portée : 404 (on ne confirme pas
// l'existence). Rien n'est relié à la paie (ADR-0070).
//
// Aussi fournisseur du port `WORK_TIMESHEET_AGENDA_SOURCE` (« Mes tâches ») et du
// nombre du brief du matin (fait `mes_validations_temps.en_attente`).

import {
  WORK_TIMESHEET_APPROVAL_KIND_LABEL,
  addDays,
  kinshasaDayOf,
  timesheetHref,
  type DecideTimesheetBody,
  type DecideTimesheetWithReasonBody,
  type PendingTimesheetView,
  type SubmitTimesheetBody,
  type TimesheetAction,
  type TimesheetApprovalView,
  type WorkTimesheetMyTaskItem,
} from '@lalanda/shared/work';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { can } from '../../authz/permissions.js';
import { isDuplicateKey } from '../../sales/sales.errors.js';
import { WorkNotifier } from '../work-notifier.js';
import type { TimesheetAgendaPage, TimesheetAgendaReader } from '../my-tasks.ports.js';
import {
  WORK_ABSENCES_SOURCE,
  noWorkAbsences,
  type WorkAbsencesSource,
} from '../work-absences.port.js';
import { WorkMembersService } from '../work-members.service.js';
import {
  actorCan,
  badRequest,
  conflict,
  forbidden,
  memberNotFound,
  staleRevision,
  type WorkActor,
} from '../work.common.js';
import { WorkTimeEntry, type WorkTimeEntryDocument } from '../work.schemas.js';
import {
  WorkTimesheetWeek,
  type TimesheetStoredStatus,
  type WorkTimesheetWeekDocument,
  type WorkTimesheetWeekLean,
} from './work-timesheet-week.schema.js';

/** Semaines soumises lues au plus (« Mes tâches », brief, liste à valider). */
export const MAX_PENDING_TIMESHEETS = 500;

/** Lundi de la semaine qui contient `day` (`AAAA-MM-JJ`). */
export function mondayOfDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

const SUBMITTABLE: readonly (TimesheetStoredStatus | 'open')[] = ['open', 'returned', 'reopened'];

type Scope = 'agenda' | 'all';

@Injectable()
export class WorkTimesheetApprovalsService implements TimesheetAgendaReader {
  private readonly absences: WorkAbsencesSource;

  constructor(
    @InjectModel(WorkTimesheetWeek.name) private readonly weeks: Model<WorkTimesheetWeekDocument>,
    @InjectModel(WorkTimeEntry.name) private readonly time: Model<WorkTimeEntryDocument>,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(WORK_ABSENCES_SOURCE) absences: WorkAbsencesSource | null = null,
    // ADR-0078 § 2.5 : feuilles de temps des consultants (comptes externes), lecture seule.
    @Optional() @InjectConnection() private readonly connection: Connection | null = null,
    // ADR-0079 § 3 : soumise, validée, renvoyée, rouverte (ADR-0077 n'émettait rien).
    @Optional() @Inject(WorkNotifier) private readonly notifier: WorkNotifier | null = null,
  ) {
    this.absences = absences ?? noWorkAbsences;
  }

  /**
   * ADR-0078 § 2.5 : compte CONSULTANT actif de l'organisation (sa feuille est validée par
   * son référent interne ou par `work.manage`), sinon `null`.
   */
  async consultantOf(
    organizationId: string,
    userId: string,
  ): Promise<{ referentUserId: string | null } | null> {
    if (!this.connection || !/^[0-9a-f]{24}$/i.test(userId)) return null;
    const doc = await this.connection
      .collection('work_external_accounts')
      .findOne(
        { _id: new Types.ObjectId(userId), organizationId, kind: 'consultant' },
        { projection: { referentUserId: 1 } },
      );
    if (!doc) return null;
    const referent = doc['referentUserId'];
    return { referentUserId: typeof referent === 'string' ? referent : null };
  }

  /** Consultants de l'organisation dont l'appelant est le référent. */
  private async consultantsReferredBy(organizationId: string, userId: string): Promise<string[]> {
    if (!this.connection) return [];
    const docs = await this.connection
      .collection('work_external_accounts')
      .find(
        { organizationId, kind: 'consultant', referentUserId: userId },
        { projection: { _id: 1 } },
      )
      .toArray();
    return docs.map((d) => String(d['_id']));
  }

  /**
   * ADR-0079 § 3 : qui valide la semaine de `userId` — son manager (direct ou indirect)
   * s'il en a un relié à un compte, sinon les détenteurs de `work.manage` (ADR-0077 § 4.6).
   * Au plus 200 membres examinés.
   */
  private async validatorsOf(
    organizationId: string,
    userId: string,
    week: string,
  ): Promise<string[]> {
    // ADR-0078 § 2.5 : la semaine d'un consultant va à son référent interne, sinon à
    // `work.manage`.
    const consultant = await this.consultantOf(organizationId, userId);
    const perms = await this.members.permissions(organizationId);
    if (consultant) {
      if (consultant.referentUserId && perms.has(consultant.referentUserId)) {
        return [consultant.referentUserId];
      }
      return [...perms.entries()]
        .filter(([u, m]) => u !== userId && can(m.role, 'work.manage', m.context))
        .map(([u]) => u);
    }
    const candidates = [...perms.entries()]
      .filter(([u, m]) => u !== userId && can(m.role, 'work.read', m.context))
      .slice(0, 200);
    const managers: string[] = [];
    for (const [u] of candidates) {
      const ctx = await this.absences.timesheetContextOf(
        organizationId,
        u,
        userId,
        week,
        addDays(week, 6),
      );
      if (ctx.viewerIsManager) managers.push(u);
    }
    if (managers.length > 0) return managers;
    return candidates.filter(([, m]) => can(m.role, 'work.manage', m.context)).map(([u]) => u);
  }

  private async notifyWeek(
    organizationId: string,
    kind:
      | 'work.timesheet_submitted'
      | 'work.timesheet_approved'
      | 'work.timesheet_returned'
      | 'work.timesheet_reopened',
    doc: WorkTimesheetWeekLean,
    actor: WorkActor,
  ): Promise<void> {
    if (!this.notifier) return;
    try {
      const refs = await this.members.refs([actor.userId], organizationId);
      const who = WorkMembersService.refOf(refs, actor.userId).name;
      const recipients =
        kind === 'work.timesheet_submitted'
          ? await this.validatorsOf(organizationId, doc.userId, doc.week)
          : [doc.userId];
      const title = {
        'work.timesheet_submitted': `${who} a soumis sa feuille de temps de la semaine du ${doc.week}`,
        'work.timesheet_approved': `${who} a validé votre feuille de temps de la semaine du ${doc.week}`,
        'work.timesheet_returned': `${who} vous a renvoyé votre feuille de temps de la semaine du ${doc.week}`,
        'work.timesheet_reopened': `${who} a rouvert votre feuille de temps de la semaine du ${doc.week}`,
      }[kind];
      await this.notifier.memberEvent({
        organizationId,
        recipients,
        kind,
        entity: { type: 'timesheet', id: String(doc._id) },
        title,
        href: timesheetHref(doc.userId, doc.week),
        actorUserId: actor.userId,
        audience: kind === 'work.timesheet_submitted' ? 'manager' : 'requester',
      });
    } catch {
      /* une notification perdue ne défait jamais une décision */
    }
  }

  // ── Lecture ──────────────────────────────────────────────────────────────

  private find(organizationId: string, userId: string, week: string) {
    return this.weeks
      .findOne({ organizationId, userId, week })
      .lean<WorkTimesheetWeekLean>()
      .exec();
  }

  /** Minutes saisies (non supprimées) du membre pour la semaine. */
  private async minutesOf(organizationId: string, userId: string, week: string): Promise<number> {
    const [row] = await this.time
      .aggregate<{ total: number }>([
        {
          $match: {
            organizationId,
            userId,
            deletedAt: null,
            workedOn: { $gte: week, $lte: addDays(week, 6) },
          },
        },
        { $group: { _id: null, total: { $sum: '$minutes' } } },
      ])
      .exec();
    return row?.total ?? 0;
  }

  /** L'appelant peut-il décider pour ce membre ? Jamais pour soi. */
  async isValidator(
    organizationId: string,
    actor: WorkActor,
    userId: string,
    week: string,
  ): Promise<boolean> {
    if (userId === actor.userId) return false;
    if (actorCan(actor, 'work.manage')) return true;
    // ADR-0078 § 2.5 : un consultant est validé par son référent interne.
    const consultant = await this.consultantOf(organizationId, userId);
    if (consultant) return consultant.referentUserId === actor.userId;
    const ctx = await this.absences.timesheetContextOf(
      organizationId,
      actor.userId,
      userId,
      week,
      addDays(week, 6),
    );
    return ctx.viewerIsManager;
  }

  /** État de validation d'une semaine, pour la feuille de temps. */
  async approvalOf(
    organizationId: string,
    actor: WorkActor,
    userId: string,
    week: string,
    validator: boolean,
    now = new Date(),
  ): Promise<TimesheetApprovalView> {
    const doc = await this.find(organizationId, userId, week);
    const status = doc?.status ?? 'open';
    const refs = await this.members.refs(
      [doc?.decidedBy ?? null, ...(doc?.history ?? []).map((h) => h.by)],
      organizationId,
    );
    const currentMonday = mondayOfDay(kinshasaDayOf(now));
    return {
      status,
      revision: doc?.revision ?? 0,
      submittedAt: doc?.submittedAt ? new Date(doc.submittedAt).toISOString() : null,
      decidedAt: doc?.decidedAt ? new Date(doc.decidedAt).toISOString() : null,
      decidedBy: doc?.decidedBy ? WorkMembersService.refOf(refs, doc.decidedBy) : null,
      approvedMinutes: doc?.approvedMinutes ?? null,
      reason: doc?.reason ?? null,
      locked: status === 'approved',
      canSubmit: userId === actor.userId && SUBMITTABLE.includes(status) && week <= currentMonday,
      canDecide: validator && status === 'submitted',
      canReopen: validator && status === 'approved',
      history: (doc?.history ?? []).map((h) => ({
        action: h.action,
        at: new Date(h.at).toISOString(),
        by: WorkMembersService.refOf(refs, h.by),
        reason: h.reason ?? null,
      })),
    };
  }

  // ── Verrou (ADR-0077 § 4.3) ─────────────────────────────────────────────

  /** `409 WORK_TIMESHEET_LOCKED` si la semaine de `workedOn` du membre est approuvée. */
  async assertWeekOpen(
    organizationId: string,
    userId: string,
    workedOn: string,
    session?: ClientSession,
  ): Promise<void> {
    const week = mondayOfDay(workedOn);
    const q = this.weeks.findOne({ organizationId, userId, week, status: 'approved' }, { _id: 1 });
    if (session) q.session(session);
    const locked = await q.lean().exec();
    if (locked) {
      conflict(
        'WORK_TIMESHEET_LOCKED',
        'Cette semaine de temps est validée : demandez sa réouverture au validateur pour la modifier.',
        { week, userId },
      );
    }
  }

  // ── Écritures ────────────────────────────────────────────────────────────

  private entry(action: TimesheetAction, by: string, reason: string | null = null) {
    return { action, at: new Date(), by, reason };
  }

  private async record(
    organizationId: string,
    actor: WorkActor,
    action: TimesheetAction,
    doc: WorkTimesheetWeekLean,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role ?? 'unknown',
      action: `work.timesheet.${action}`,
      targetType: 'work_timesheet_week',
      targetId: String(doc._id),
      metadata: { userId: doc.userId, week: doc.week, ...extra },
    });
  }

  async submit(
    organizationId: string,
    body: SubmitTimesheetBody,
    actor: WorkActor,
    now = new Date(),
    /** ADR-0078 : rôle inscrit à l'audit pour une soumission depuis l'espace externe. */
    auditRole?: string,
  ): Promise<TimesheetApprovalView> {
    if (body.week > mondayOfDay(kinshasaDayOf(now))) {
      badRequest('WORK_TIMESHEET_WEEK', 'Une semaine à venir ne se soumet pas.');
    }
    const userId = actor.userId;
    const current = await this.find(organizationId, userId, body.week);
    const status = current?.status ?? 'open';
    if (!SUBMITTABLE.includes(status)) {
      conflict('WORK_TIMESHEET_STATE', 'Cette semaine est déjà soumise ou validée.', { status });
    }
    if ((current?.revision ?? 0) !== body.expectedRevision) staleRevision(current?.revision ?? 0);
    const minutes = await this.minutesOf(organizationId, userId, body.week);
    let doc: WorkTimesheetWeekLean | null;
    if (!current) {
      try {
        doc = (
          await this.weeks.create({
            organizationId,
            userId,
            week: body.week,
            status: 'submitted',
            submittedAt: new Date(),
            submittedBy: userId,
            decidedAt: null,
            decidedBy: null,
            approvedMinutes: null,
            reason: null,
            history: [this.entry('submitted', userId)],
            revision: 1,
            _schemaVersion: 1,
          })
        ).toObject() as WorkTimesheetWeekLean;
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        staleRevision((await this.find(organizationId, userId, body.week))?.revision ?? 1);
      }
    } else {
      doc = await this.weeks
        .findOneAndUpdate(
          { _id: current._id, organizationId, revision: body.expectedRevision },
          {
            $set: { status: 'submitted', submittedAt: new Date(), submittedBy: userId },
            $push: { history: this.entry('submitted', userId) },
            $inc: { revision: 1 },
          },
          { new: true },
        )
        .lean<WorkTimesheetWeekLean>()
        .exec();
      if (!doc) staleRevision(current.revision + 1);
    }
    await this.record(
      organizationId,
      auditRole ? { ...actor, role: auditRole as WorkActor['role'] } : actor,
      'submitted',
      doc!,
      { minutes },
    );
    await this.notifyWeek(organizationId, 'work.timesheet_submitted', doc!, actor);
    return this.approvalOf(organizationId, actor, userId, body.week, false, now);
  }

  /** Contrôles communs d'une décision : membre, portée, soi-même, état, révision. */
  private async decisionTarget(
    organizationId: string,
    body: DecideTimesheetBody,
    actor: WorkActor,
    expected: TimesheetStoredStatus,
  ): Promise<WorkTimesheetWeekLean> {
    if (body.userId === actor.userId) {
      forbidden(
        'WORK_TIMESHEET_SELF_APPROVAL',
        'Vous ne validez pas votre propre feuille de temps : votre manager ou un gestionnaire des projets le fait.',
      );
    }
    if (
      (await this.members.roleOf(organizationId, body.userId)) === undefined &&
      (await this.consultantOf(organizationId, body.userId)) === null
    ) {
      memberNotFound();
    }
    if (!(await this.isValidator(organizationId, actor, body.userId, body.week))) memberNotFound();
    const current = await this.find(organizationId, body.userId, body.week);
    const status = current?.status ?? 'open';
    if (!current || status !== expected) {
      conflict(
        'WORK_TIMESHEET_STATE',
        expected === 'submitted'
          ? 'Seule une semaine soumise s’approuve ou se renvoie.'
          : 'Seule une semaine validée se rouvre.',
        { status },
      );
    }
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    return current;
  }

  private async decide(
    organizationId: string,
    current: WorkTimesheetWeekLean,
    expectedRevision: number,
    action: 'approved' | 'returned' | 'reopened',
    actor: WorkActor,
    reason: string | null,
    approvedMinutes: number | null,
  ): Promise<WorkTimesheetWeekLean> {
    const doc = await this.weeks
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: expectedRevision, status: current.status },
        {
          $set: {
            status: action,
            decidedAt: new Date(),
            decidedBy: actor.userId,
            ...(action === 'approved' ? { approvedMinutes, reason: null } : { reason }),
          },
          $push: { history: this.entry(action, actor.userId, reason) },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<WorkTimesheetWeekLean>()
      .exec();
    if (!doc) staleRevision(current.revision + 1);
    return doc;
  }

  async approve(
    organizationId: string,
    body: DecideTimesheetBody,
    actor: WorkActor,
  ): Promise<TimesheetApprovalView> {
    const current = await this.decisionTarget(organizationId, body, actor, 'submitted');
    const minutes = await this.minutesOf(organizationId, body.userId, body.week);
    const doc = await this.decide(
      organizationId,
      current,
      body.expectedRevision,
      'approved',
      actor,
      null,
      minutes,
    );
    await this.record(organizationId, actor, 'approved', doc, { minutes });
    await this.notifyWeek(organizationId, 'work.timesheet_approved', doc, actor);
    return this.approvalOf(organizationId, actor, body.userId, body.week, true);
  }

  async returnWeek(
    organizationId: string,
    body: DecideTimesheetWithReasonBody,
    actor: WorkActor,
  ): Promise<TimesheetApprovalView> {
    const current = await this.decisionTarget(organizationId, body, actor, 'submitted');
    const doc = await this.decide(
      organizationId,
      current,
      body.expectedRevision,
      'returned',
      actor,
      body.reason,
      null,
    );
    await this.record(organizationId, actor, 'returned', doc, { reason: body.reason });
    await this.notifyWeek(organizationId, 'work.timesheet_returned', doc, actor);
    return this.approvalOf(organizationId, actor, body.userId, body.week, true);
  }

  async reopen(
    organizationId: string,
    body: DecideTimesheetWithReasonBody,
    actor: WorkActor,
  ): Promise<TimesheetApprovalView> {
    const current = await this.decisionTarget(organizationId, body, actor, 'approved');
    const doc = await this.decide(
      organizationId,
      current,
      body.expectedRevision,
      'reopened',
      actor,
      body.reason,
      null,
    );
    await this.record(organizationId, actor, 'reopened', doc, {
      reason: body.reason,
      approvedMinutes: current.approvedMinutes ?? null,
    });
    await this.notifyWeek(organizationId, 'work.timesheet_reopened', doc, actor);
    return this.approvalOf(organizationId, actor, body.userId, body.week, true);
  }

  // ── Semaines à valider ──────────────────────────────────────────────────

  /**
   * Semaines soumises que l'appelant peut valider. `agenda` (« Mes tâches », brief) :
   * son équipe, plus — avec `work.manage` — les membres sans manager relié ; `all`
   * (liste à valider) : avec `work.manage`, toutes sauf les siennes.
   */
  private async pendingDocs(
    organizationId: string,
    actor: WorkActor,
    scope: Scope,
  ): Promise<{ docs: WorkTimesheetWeekLean[]; truncated: boolean }> {
    const rows = await this.weeks
      .find({ organizationId, status: 'submitted', userId: { $ne: actor.userId } })
      .sort({ submittedAt: 1, _id: 1 })
      .limit(MAX_PENDING_TIMESHEETS + 1)
      .lean<WorkTimesheetWeekLean[]>()
      .exec();
    const truncated = rows.length > MAX_PENDING_TIMESHEETS;
    const holdsManage = actorCan(actor, 'work.manage');
    const management = this.absences.managementOf
      ? await this.absences.managementOf(organizationId, actor.userId)
      : { teamUserIds: [], withManagerUserIds: [] };
    // ADR-0078 § 2.5 : les consultants dont l'appelant est le référent comptent comme son
    // équipe ; un consultant a toujours un référent (il ne remonte pas aux gestionnaires
    // dans « Mes tâches », mais reste dans la liste « à valider » d'un `work.manage`).
    const referred = await this.consultantsReferredBy(organizationId, actor.userId);
    const team = new Set([...management.teamUserIds, ...referred]);
    const withManager = new Set(management.withManagerUserIds);
    if (this.connection) {
      const consultants = await this.connection
        .collection('work_external_accounts')
        .find({ organizationId, kind: 'consultant' }, { projection: { _id: 1 } })
        .toArray();
      for (const c of consultants) withManager.add(String(c['_id']));
    }
    const docs = rows.slice(0, MAX_PENDING_TIMESHEETS).filter((d) => {
      if (team.has(d.userId)) return true;
      if (!holdsManage) return false;
      return scope === 'all' || !withManager.has(d.userId);
    });
    return { docs, truncated };
  }

  async pending(organizationId: string, actor: WorkActor): Promise<PendingTimesheetView[]> {
    const { docs } = await this.pendingDocs(organizationId, actor, 'all');
    return this.pendingViews(organizationId, docs);
  }

  private async pendingViews(
    organizationId: string,
    docs: readonly WorkTimesheetWeekLean[],
  ): Promise<PendingTimesheetView[]> {
    const [refs, minutes] = await Promise.all([
      this.members.refs(
        docs.map((d) => d.userId),
        organizationId,
      ),
      Promise.all(docs.map((d) => this.minutesOf(organizationId, d.userId, d.week))),
    ]);
    return docs.map((d, i) => ({
      user: WorkMembersService.refOf(refs, d.userId),
      week: d.week,
      totalMinutes: minutes[i]!,
      submittedAt: new Date(d.submittedAt ?? d.updatedAt).toISOString(),
      revision: d.revision,
    }));
  }

  /** Port `WORK_TIMESHEET_AGENDA_SOURCE` : éléments de « Mes tâches » du validateur. */
  async agendaOf(
    organizationId: string,
    actor: WorkActor,
    limit: number,
  ): Promise<TimesheetAgendaPage> {
    const { docs, truncated } = await this.pendingDocs(organizationId, actor, 'agenda');
    const views = await this.pendingViews(organizationId, docs.slice(0, limit));
    const items: WorkTimesheetMyTaskItem[] = views.map((v) => ({
      source: 'work_timesheet',
      kind: 'timesheet_approval',
      id: `work:timesheet:${v.user.userId}:${v.week}`,
      userId: v.user.userId,
      userName: v.user.name,
      week: v.week,
      totalMinutes: v.totalMinutes,
      dueDate: addDays(v.week, 6),
      priority: 'none',
      rank: v.submittedAt,
      done: false,
      kindLabel: WORK_TIMESHEET_APPROVAL_KIND_LABEL,
      href: timesheetHref(v.user.userId, v.week),
    }));
    return { items, truncated: truncated || docs.length > limit };
  }

  /** Nombre du brief du matin (même audience que « Mes tâches »). */
  async countFor(organizationId: string, actor: WorkActor): Promise<number> {
    return (await this.pendingDocs(organizationId, actor, 'agenda')).docs.length;
  }

  /** Semaines approuvées des membres donnés (marge : part du temps validé). */
  async approvedWeeksOf(
    organizationId: string,
    userIds: readonly string[],
  ): Promise<{ userId: string; week: string }[]> {
    if (userIds.length === 0) return [];
    return this.weeks
      .find(
        { organizationId, status: 'approved', userId: { $in: [...new Set(userIds)] } },
        { _id: 0, userId: 1, week: 1 },
      )
      .lean<{ userId: string; week: string }[]>()
      .exec();
  }
}
