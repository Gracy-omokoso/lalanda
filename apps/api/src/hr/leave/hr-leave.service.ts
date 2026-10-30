// Demandes d'absence, circuit de validation, grand livre, soldes, calendrier
// (ADR-0045 § 2.7, § 3.2, § 4.3, § 4.4, § 5, § 6.1). ADR-0045 — H3.
//
// - Calculs au MOTEUR : jours décomptés (`leaveDays`), chevauchements
//   (`leaveOverlaps`), solde et débit (`leaveBalance`, `checkLeaveDebit`), étapes
//   (`leaveApprovalSteps`), calendrier (`teamCalendar`), année de congé
//   (`leaveYearOf`). Rien n'est additionné ici.
// - Séparation des tâches : `leaveApprovalDecision` (relation de manager ou droits
//   EFFECTIFS, jamais un rôle) ; on ne valide pas sa propre absence, sauf approbateur
//   unique ; deux étapes, deux personnes.
// - Portée : un membre voit ses demandes, un manager celles de son équipe, `hr.read`
//   toutes ; hors portée → 404. Un type confidentiel n'expose ni son libellé ni son
//   motif au manager (« Absent »).
// - Isolation : chaque requête porte `organizationId` ; identifiant d'une autre
//   organisation (demande, collaborateur, type) → 404.
// - Grand livre en AJOUT SEUL : l'approbation finale écrit `taken` dans la même
//   transaction ; l'annulation d'une absence débitée écrit `taken_reversal`.

import {
  checkLeaveDebit,
  leaveApprovalSteps,
  leaveBalance,
  leaveDays,
  leaveOverlaps,
  leaveYearOf,
  teamCalendar,
  type LeaveLedgerEntryInput,
  type PendingLeaveInput,
  type WorkPattern,
} from '@lalanda/engine';
import {
  type ApproveLeaveRequestBody,
  type CancelLeaveRequestBody,
  type CreateLeaveLedgerEntryBody,
  type CreateLeaveRequestBody,
  type HrCalendarQuery,
  type HrCalendarView,
  type HrMeView,
  type HrTeamView,
  type LeaveBalanceView,
  type LeaveBalancesQuery,
  type LeaveBalancesView,
  type LeaveLedgerEntryView,
  type LeaveLedgerView,
  type LeaveRequestPage,
  type LeaveRequestView,
  type ListLeaveLedgerQuery,
  type ListLeaveRequestsQuery,
  type PendingApprovalsQuery,
  type RejectLeaveRequestBody,
} from '@lalanda/shared/hr';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { forbidden } from '../../authz/authz.service.js';
import type { LeaveApprovalDecision } from '../../authz/permissions.js';
import { Membership, type MembershipDocument } from '../../organizations/membership.schema.js';
import {
  conflict,
  invalidCursor,
  invalidRequestOf,
  isDuplicateKey,
  staleRevision,
} from '../../sales/sales.errors.js';
import { decodeCursor, encodeCursor, isObjectIdHex } from '../../sales/search.js';
import { HrLeaveApprovalsReader } from '../agenda/hr-leave-approvals.reader.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import type { EmployeeLean } from '../employees/employee.schema.js';
import { HrHolidaysService } from '../holidays/hr-holidays.service.js';
import { HrNotifier } from '../hr-notifier.js';
import { employeeNotFound, hrToday, inHrTransaction } from '../scope/hr-errors.js';
import type { HrViewer } from '../scope/hr-scope.service.js';
import { displayNameOf } from './display-name.js';
import { HrLeaveTypesService } from './hr-leave-types.service.js';
import {
  LeaveLedgerEntry,
  type LeaveLedgerEntryDocument,
  type LeaveLedgerEntryLean,
} from './leave-ledger.schema.js';
import {
  MASKED_LEAVE_LABEL,
  currentStepOf,
  decisionOn,
  managerUserIdOf,
  seesLeaveType,
} from './leave-model.js';
import {
  LeaveRequest,
  type LeaveRequestDocument,
  type LeaveRequestLean,
  type StoredApproval,
} from './leave-request.schema.js';
import type { LeaveTypeLean } from './leave-type.schema.js';

/** Demandes de « moi » servies avec la fiche (les plus récentes). */
const ME_REQUESTS_MAX = 50;

function requestNotFound(): never {
  throw new NotFoundException({
    code: 'LEAVE_REQUEST_NOT_FOUND',
    message: 'Demande d’absence introuvable.',
  });
}

function notLinked(): never {
  conflict(
    'EMPLOYEE_NOT_LINKED',
    'Aucun dossier collaborateur n’est relié à votre compte : demandez aux RH de le créer.',
  );
}

function notPending(): never {
  conflict('LEAVE_NOT_PENDING', 'Cette demande a déjà été traitée.');
}

/** Refus de la séparation des tâches → réponse HTTP (codes nommés par l'ADR § 4.3). */
function refuse(decision: Extract<LeaveApprovalDecision, { ok: false }>): never {
  if (decision.code === 'LEAVE_NOT_YOUR_STEP') {
    throw new ForbiddenException({
      code: 'LEAVE_NOT_YOUR_STEP',
      message: 'Cette étape de validation ne vous revient pas.',
    });
  }
  if (decision.code === 'SELF_APPROVAL_FORBIDDEN') {
    conflict('SELF_APPROVAL_FORBIDDEN', 'On ne valide pas sa propre absence.');
  }
  conflict(
    'APPROVER_ALREADY_APPROVED',
    'Vous avez déjà validé une étape de cette demande : une autre personne valide la suivante.',
  );
}

const neg = (days: string): string => (days.startsWith('-') ? days.slice(1) : `-${days}`);

/** Cache des noms : fiches de l'organisation, puis comptes (`user`). */
type Names = Map<string, string>;

@Injectable()
export class HrLeaveService {
  constructor(
    @InjectModel(LeaveRequest.name) private readonly requests: Model<LeaveRequestDocument>,
    @InjectModel(LeaveLedgerEntry.name) private readonly ledger: Model<LeaveLedgerEntryDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(HrLeaveTypesService) private readonly types: HrLeaveTypesService,
    @Inject(HrHolidaysService) private readonly holidays: HrHolidaysService,
    @Inject(HrLeaveApprovalsReader) private readonly approvalsReader: HrLeaveApprovalsReader,
    @Inject(HrNotifier) private readonly notifier: HrNotifier,
  ) {}

  // ── Portée ───────────────────────────────────────────────────────────────

  /** Collaborateurs dont le lecteur voit les demandes ; `null` = tous (`hr.read`). */
  private visibleIds(viewer: HrViewer): Set<string> | null {
    if (viewer.actions.has('hr.read')) return null;
    const ids = new Set(viewer.scope.teamEmployeeIds);
    if (viewer.scope.selfEmployeeId) ids.add(viewer.scope.selfEmployeeId);
    return ids;
  }

  private sees(viewer: HrViewer, employeeId: string): boolean {
    const ids = this.visibleIds(viewer);
    return ids === null ? viewer.byId.has(employeeId) : ids.has(employeeId);
  }

  private typeVisible(viewer: HrViewer, employeeId: string, type: LeaveTypeLean | undefined) {
    return seesLeaveType({
      confidential: type?.confidential ?? true,
      isSelf: viewer.scope.selfEmployeeId === employeeId,
      seesConfidential: viewer.actions.has('hr.sensitive.read'),
      holdsLeaveApprove: viewer.actions.has('leave.approve'),
    });
  }

  private patternOf(viewer: HrViewer, employee: EmployeeLean): WorkPattern {
    return (employee.workPattern ?? viewer.settings.workPattern) as WorkPattern;
  }

  // ── Vues ─────────────────────────────────────────────────────────────────

  private async namesFor(viewer: HrViewer, userIds: readonly string[]): Promise<Names> {
    const names: Names = new Map();
    for (const e of viewer.employees) {
      if (e.userId && e.status !== 'anonymized') names.set(e.userId, displayNameOf(e));
    }
    const missing = [...new Set(userIds)].filter(
      (id) => !names.has(id) && Types.ObjectId.isValid(id),
    );
    if (missing.length > 0) {
      const docs = await this.connection
        .collection('user')
        .find(
          { _id: { $in: missing.map((id) => new Types.ObjectId(id)) } },
          { projection: { name: 1 } },
        )
        .toArray();
      for (const d of docs) {
        if (typeof d['name'] === 'string') names.set(String(d['_id']), d['name']);
      }
    }
    return names;
  }

  private async viewsOf(
    viewer: HrViewer,
    docs: readonly LeaveRequestLean[],
    types: ReadonlyMap<string, LeaveTypeLean>,
  ): Promise<LeaveRequestView[]> {
    const names = await this.namesFor(
      viewer,
      docs.flatMap((d) => d.approvals.map((a) => a.userId)),
    );
    return docs.map((r) => {
      const type = types.get(r.typeId);
      const visible = this.typeVisible(viewer, r.employeeId, type);
      const employee = viewer.byId.get(r.employeeId);
      return {
        id: String(r._id),
        employeeId: r.employeeId,
        employeeName: employee ? displayNameOf(employee) : '',
        typeId: visible ? r.typeId : null,
        typeLabel: visible && type ? type.label : MASKED_LEAVE_LABEL,
        masked: !visible,
        start: { date: r.start.date, half: r.start.half },
        end: { date: r.end.date, half: r.end.half },
        days: r.days,
        reason: visible ? (r.reason ?? null) : null,
        status: r.status,
        steps: [...r.steps],
        approvals: r.approvals.map((a) => ({
          step: a.step,
          userId: a.userId,
          userName: names.get(a.userId) ?? null,
          decision: a.decision,
          at: new Date(a.at).toISOString(),
          comment: a.comment ?? null,
          soleApprover: a.soleApprover,
          onBehalfOfManager: a.onBehalfOfManager,
        })),
        currentStep: currentStepOf(r),
        cancellation:
          r.status === 'cancelled' && r.cancelledAt
            ? {
                at: new Date(r.cancelledAt).toISOString(),
                by: r.cancelledBy ?? '',
                reason: visible ? (r.cancelReason ?? null) : null,
              }
            : null,
        createdBy: r.createdBy,
        revision: r.revision,
        createdAt: new Date(r.createdAt).toISOString(),
        updatedAt: new Date(r.updatedAt).toISOString(),
      };
    });
  }

  private async typesOf(organizationId: string): Promise<Map<string, LeaveTypeLean>> {
    return new Map((await this.types.all(organizationId)).map((t) => [String(t._id), t]));
  }

  async requireOwn(organizationId: string, requestId: string): Promise<LeaveRequestLean> {
    if (typeof requestId !== 'string' || !isObjectIdHex(requestId)) requestNotFound();
    const doc = await this.requests
      .findOne({ _id: new Types.ObjectId(requestId), organizationId })
      .lean<LeaveRequestLean>()
      .exec();
    if (!doc) requestNotFound();
    return doc;
  }

  private async viewOne(
    organizationId: string,
    viewer: HrViewer,
    requestId: string,
  ): Promise<LeaveRequestView> {
    const doc = await this.requireOwn(organizationId, requestId);
    return (await this.viewsOf(viewer, [doc], await this.typesOf(organizationId)))[0]!;
  }

  // ── Soldes ───────────────────────────────────────────────────────────────

  private async ledgerOf(
    organizationId: string,
    employeeId: string,
  ): Promise<LeaveLedgerEntryLean[]> {
    return this.ledger
      .find({ organizationId, employeeId })
      .sort({ effectiveOn: 1, createdAt: 1, _id: 1 })
      .lean<LeaveLedgerEntryLean[]>()
      .exec();
  }

  /** Solde par le moteur ; `pending` : demandes en attente des types qui débitent. */
  private async engineBalance(
    organizationId: string,
    viewer: HrViewer,
    employeeId: string,
    asOf: string,
    types: ReadonlyMap<string, LeaveTypeLean>,
  ) {
    const [ledger, pending] = await Promise.all([
      this.ledgerOf(organizationId, employeeId),
      this.requests
        .find({ organizationId, employeeId, status: 'pending' }, { typeId: 1, start: 1, days: 1 })
        .lean<LeaveRequestLean[]>()
        .exec(),
    ]);
    const entries: LeaveLedgerEntryInput[] = ledger.map((e) => ({
      typeId: e.typeId,
      kind: e.kind,
      days: e.days,
      effectiveOn: e.effectiveOn,
      leaveYear: e.leaveYear,
    }));
    const reserved: PendingLeaveInput[] = pending
      .filter((p) => types.get(p.typeId)?.deductsFromBalance === true)
      .map((p) => ({ typeId: p.typeId, startDate: p.start.date, days: p.days }));
    return leaveBalance(entries, reserved, asOf, viewer.settings.leaveYearStart);
  }

  private async balancesView(
    organizationId: string,
    viewer: HrViewer,
    employeeId: string,
    asOf: string,
    types: ReadonlyMap<string, LeaveTypeLean>,
  ): Promise<LeaveBalancesView> {
    const result = await this.engineBalance(organizationId, viewer, employeeId, asOf, types);
    const byType = new Map(result.balances.map((b) => [b.typeId, b]));
    // Tout type actif qui débite figure, même sans mouvement (solde nul, calculé).
    for (const [id, t] of types) {
      if (t.active && t.deductsFromBalance && !byType.has(id)) {
        byType.set(id, {
          typeId: id,
          leaveYear: result.leaveYear,
          accrued: '0',
          allocated: '0',
          adjusted: '0',
          carriedOver: '0',
          expired: '0',
          taken: '0',
          upcoming: '0',
          pending: '0',
          available: '0',
        });
      }
    }
    const balances: LeaveBalanceView[] = [...byType.values()]
      .filter((b) => this.typeVisible(viewer, employeeId, types.get(b.typeId)))
      .map((b) => ({ ...b, typeLabel: types.get(b.typeId)?.label ?? '' }))
      .sort((a, b) => (a.typeLabel < b.typeLabel ? -1 : a.typeLabel > b.typeLabel ? 1 : 0));
    return { employeeId, asOf: result.asOf, leaveYear: result.leaveYear, balances };
  }

  /** `GET /hr/leave-balances` — soi, son équipe (manager) ou `hr.read` ; sinon 404. */
  async balances(
    organizationId: string,
    viewer: HrViewer,
    query: LeaveBalancesQuery,
  ): Promise<LeaveBalancesView> {
    const employeeId = query.employeeId ?? viewer.scope.selfEmployeeId;
    if (!employeeId) notLinked();
    if (!this.sees(viewer, employeeId)) employeeNotFound();
    return this.balancesView(
      organizationId,
      viewer,
      employeeId,
      query.asOf ?? hrToday(),
      await this.typesOf(organizationId),
    );
  }

  // ── « Moi » et « mon équipe » (§ 3.1) ────────────────────────────────────

  async completeMe(organizationId: string, viewer: HrViewer, me: HrMeView): Promise<HrMeView> {
    const selfId = viewer.scope.selfEmployeeId;
    if (!selfId || !me.employee) return me;
    const types = await this.typesOf(organizationId);
    const [balances, docs] = await Promise.all([
      this.balancesView(organizationId, viewer, selfId, hrToday(), types),
      this.requests
        .find({ organizationId, employeeId: selfId })
        .sort({ 'start.date': -1, _id: -1 })
        .limit(ME_REQUESTS_MAX)
        .lean<LeaveRequestLean[]>()
        .exec(),
    ]);
    return {
      ...me,
      balances: balances.balances,
      requests: await this.viewsOf(viewer, docs, types),
    };
  }

  async completeTeam(
    organizationId: string,
    viewer: HrViewer,
    team: HrTeamView,
  ): Promise<HrTeamView> {
    if (team.items.length === 0) return team;
    const types = await this.typesOf(organizationId);
    const today = hrToday();
    const ids = team.items.map((m) => m.id);
    const docs = await this.requests
      .find({
        organizationId,
        employeeId: { $in: ids },
        status: { $in: ['pending', 'approved'] },
        'end.date': { $gte: today },
      })
      .sort({ 'start.date': 1, _id: 1 })
      .lean<LeaveRequestLean[]>()
      .exec();
    const views = await this.viewsOf(viewer, docs, types);
    const items = await Promise.all(
      team.items.map(async (m) => ({
        ...m,
        balances: (await this.balancesView(organizationId, viewer, m.id, today, types)).balances,
        absences: views.filter((v) => v.employeeId === m.id),
      })),
    );
    return { items };
  }

  // ── Demandes ─────────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    viewer: HrViewer,
    body: CreateLeaveRequestBody,
    actor: HrActor,
  ): Promise<LeaveRequestView> {
    const selfId = viewer.scope.selfEmployeeId;
    const forOther = body.employeeId !== undefined && body.employeeId !== selfId;
    if (forOther && !viewer.actions.has('hr.manage')) {
      throw new ForbiddenException(forbidden('hr.manage', viewer.role));
    }
    const employeeId = body.employeeId ?? selfId;
    if (!employeeId) notLinked();
    const employee = viewer.byId.get(employeeId);
    if (!employee) employeeNotFound();
    if (employee.status !== 'active') {
      conflict('EMPLOYEE_NOT_ACTIVE', 'Ce collaborateur n’est plus actif.');
    }
    const type = await this.types.requireOwn(organizationId, body.typeId);
    if (!type.active) conflict('LEAVE_TYPE_ARCHIVED', 'Ce type d’absence est archivé.');
    if (type.hrOnly && !viewer.actions.has('hr.manage')) {
      throw new ForbiddenException({
        code: 'LEAVE_TYPE_HR_ONLY',
        message: 'Ce type d’absence est saisi par les ressources humaines seulement.',
      });
    }
    if (type.unit === 'day' && (body.start.half !== 'full' || body.end.half !== 'full')) {
      invalidRequestOf([
        {
          path: 'start',
          code: 'LEAVE_HALF_DAY_NOT_ALLOWED',
          message: 'Ce type d’absence se pose par journées entières.',
        },
      ]);
    }
    const holidays = await this.holidays.engineInput(organizationId);
    let days: string;
    try {
      days = leaveDays(body.start, body.end, this.patternOf(viewer, employee), holidays).days;
    } catch (err) {
      if (err instanceof RangeError) {
        throw new BadRequestException({ code: 'LEAVE_TOO_LONG', message: err.message });
      }
      throw err;
    }
    if (Number(days) === 0) {
      throw new HttpException(
        {
          code: 'LEAVE_NO_WORKING_DAY',
          message: 'Cette période ne couvre aucun jour travaillé.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const existing = await this.requests
      .find({
        organizationId,
        employeeId,
        status: { $in: ['pending', 'approved'] },
        'start.date': { $lte: body.end.date },
        'end.date': { $gte: body.start.date },
      })
      .lean<LeaveRequestLean[]>()
      .exec();
    const overlaps = leaveOverlaps(
      { employeeId, start: body.start, end: body.end },
      existing.map((r) => ({
        id: String(r._id),
        employeeId: r.employeeId,
        typeId: r.typeId,
        status: r.status,
        start: r.start,
        end: r.end,
        days: r.days,
      })),
    ).overlaps;
    if (overlaps.length > 0) {
      conflict(
        'LEAVE_OVERLAP',
        'Une autre demande de ce collaborateur couvre déjà cette période.',
        {
          requestIds: overlaps.map((o) => o.requestId),
        },
      );
    }
    if (type.deductsFromBalance) {
      const today = hrToday();
      const sameYear =
        leaveYearOf(today, viewer.settings.leaveYearStart) ===
        leaveYearOf(body.start.date, viewer.settings.leaveYearStart);
      const asOf = sameYear ? today : body.start.date;
      const balance = await this.engineBalance(
        organizationId,
        viewer,
        employeeId,
        asOf,
        await this.typesOf(organizationId),
      );
      const available =
        balance.balances.find((b) => b.typeId === String(type._id))?.available ?? '0';
      const debit = checkLeaveDebit(available, days, type.allowNegative);
      if (!debit.ok) {
        conflict('LEAVE_BALANCE_INSUFFICIENT', 'Le solde de ce type d’absence ne suffit pas.', {
          available,
          requested: days,
          shortfall: debit.shortfall,
        });
      }
    }
    const managerUserId = await this.memberManagerUserId(organizationId, viewer, employee);
    const steps = leaveApprovalSteps(
      { approvalFlow: viewer.settings.approvalFlow },
      { confidential: type.confidential, requiresHrApproval: type.requiresHrApproval },
      { managerEmployeeId: employee.managerEmployeeId ?? null, managerUserId },
    ).steps;
    const created = await this.requests.create({
      organizationId,
      employeeId,
      typeId: String(type._id),
      start: body.start,
      end: body.end,
      days,
      reason: body.reason ?? null,
      attachmentId: null,
      status: 'pending',
      steps,
      approvals: [],
      debited: false,
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    const requestId = String(created._id);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.leave.requested',
      targetType: 'leave_request',
      targetId: requestId,
      metadata: { employeeId, days, steps, forOther },
    });
    const doc = await this.requireOwn(organizationId, requestId);
    await this.notifyStep(organizationId, viewer, doc, employee, actor.userId);
    return this.viewOne(organizationId, viewer, requestId);
  }

  /** Compte du manager, s'il est encore membre de l'organisation ; sinon `null`. */
  private async memberManagerUserId(
    organizationId: string,
    viewer: HrViewer,
    employee: EmployeeLean,
  ): Promise<string | null> {
    const userId = managerUserIdOf(employee, viewer.byId);
    if (userId === null) return null;
    const member = await this.memberships.exists({ organizationId, userId }).exec();
    return member ? userId : null;
  }

  /** `hr.leave_requested` aux validateurs de l'étape en attente. */
  private async notifyStep(
    organizationId: string,
    viewer: HrViewer,
    r: LeaveRequestLean,
    employee: EmployeeLean,
    actorUserId: string,
  ): Promise<void> {
    const step = currentStepOf(r);
    if (step === null) return;
    let recipients: string[];
    if (step === 'manager') {
      const m = managerUserIdOf(employee, viewer.byId);
      recipients = m ? [m] : [];
    } else {
      const prior = new Set(r.approvals.map((a) => a.userId));
      recipients = (await this.notifier.approversOf(organizationId)).filter(
        (u) => u !== employee.userId && !prior.has(u),
      );
    }
    await this.notifier.leaveRequested({
      organizationId,
      requestId: String(r._id),
      employeeName: displayNameOf(employee),
      actorUserId,
      recipients,
    });
  }

  async list(
    organizationId: string,
    viewer: HrViewer,
    query: ListLeaveRequestsQuery,
  ): Promise<LeaveRequestPage> {
    const visible = this.visibleIds(viewer);
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.employeeId !== undefined) {
      if (!this.sees(viewer, query.employeeId)) employeeNotFound();
      and.push({ employeeId: query.employeeId });
    } else if (visible !== null) {
      and.push({ employeeId: { $in: [...visible] } });
    }
    if (query.status !== undefined) and.push({ status: query.status });
    if (query.from !== undefined) and.push({ 'end.date': { $gte: query.from } });
    if (query.to !== undefined) and.push({ 'start.date': { $lte: query.to } });
    if (query.cursor !== undefined) {
      const c = decodeCursor(query.cursor);
      if (c === null) invalidCursor();
      and.push({
        $or: [
          { 'start.date': { $lt: c.sortName } },
          { 'start.date': c.sortName, _id: { $lt: c.id } },
        ],
      });
    }
    const docs = await this.requests
      .find({ $and: and })
      .sort({ 'start.date': -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<LeaveRequestLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: await this.viewsOf(viewer, page, await this.typesOf(organizationId)),
      nextCursor:
        docs.length > query.limit && last ? encodeCursor(last.start.date, String(last._id)) : null,
    };
  }

  /** `GET /hr/leave-approvals/pending` — demandes que l'appelant peut valider. */
  async pending(
    organizationId: string,
    viewer: HrViewer,
    query: PendingApprovalsQuery,
  ): Promise<LeaveRequestPage> {
    const found = await this.approvalsReader.pendingFor(
      organizationId,
      viewer.userId,
      viewer.actions.has('leave.approve'),
    );
    const offset = query.cursor === undefined ? 0 : Number.parseInt(query.cursor, 10);
    if (!Number.isInteger(offset) || offset < 0) invalidCursor();
    const page = found.requests.slice(offset, offset + query.limit);
    return {
      items: await this.viewsOf(viewer, page, found.types),
      nextCursor:
        found.requests.length > offset + query.limit ? String(offset + query.limit) : null,
    };
  }

  async approve(
    organizationId: string,
    viewer: HrViewer,
    requestId: string,
    body: ApproveLeaveRequestBody,
    actor: HrActor,
  ): Promise<LeaveRequestView> {
    return this.decide(organizationId, viewer, requestId, 'approve', body, actor);
  }

  async reject(
    organizationId: string,
    viewer: HrViewer,
    requestId: string,
    body: RejectLeaveRequestBody,
    actor: HrActor,
  ): Promise<LeaveRequestView> {
    return this.decide(organizationId, viewer, requestId, 'reject', body, actor);
  }

  private async decide(
    organizationId: string,
    viewer: HrViewer,
    requestId: string,
    decision: 'approve' | 'reject',
    body: { expectedRevision?: number; comment?: string | null },
    actor: HrActor,
  ): Promise<LeaveRequestView> {
    const r = await this.requireOwn(organizationId, requestId);
    if (r.status !== 'pending') notPending();
    if (body.expectedRevision !== undefined && body.expectedRevision !== r.revision) {
      staleRevision(r.revision);
    }
    const employee = viewer.byId.get(r.employeeId);
    if (!employee) requestNotFound();
    const ctx = await this.approvalsReader.contextOf(
      organizationId,
      viewer.userId,
      viewer.actions.has('leave.approve'),
    );
    const verdict = decisionOn(
      r,
      employee.userId ?? null,
      managerUserIdOf(employee, viewer.byId),
      ctx,
      decision,
    );
    if (verdict === null) notPending();
    if (!verdict.ok) refuse(verdict);
    const step = currentStepOf(r)!;
    const approval: StoredApproval = {
      step,
      userId: viewer.userId,
      decision: decision === 'approve' ? 'approved' : 'rejected',
      at: new Date(),
      comment: body.comment ?? null,
      soleApprover: verdict.soleApprover,
      onBehalfOfManager: verdict.onBehalfOfManager,
    };
    const approvedSoFar = r.approvals.filter((a) => a.decision === 'approved').length;
    const final = decision === 'reject' || approvedSoFar + 1 === r.steps.length;
    const status = decision === 'reject' ? 'rejected' : final ? 'approved' : 'pending';
    const type = (await this.typesOf(organizationId)).get(r.typeId);
    const debit = status === 'approved' && type?.deductsFromBalance === true;
    await inHrTransaction(this.connection, async (session) => {
      const res = await this.requests
        .updateOne(
          { _id: r._id, organizationId, revision: r.revision, status: 'pending' },
          {
            $push: { approvals: approval },
            $set: { status, debited: debit, updatedBy: actor.userId },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(r.revision + 1);
      if (debit) {
        await this.writeLedger(
          {
            organizationId,
            employeeId: r.employeeId,
            typeId: r.typeId,
            kind: 'taken',
            days: neg(r.days),
            effectiveOn: r.start.date,
            leaveYear: leaveYearOf(r.start.date, viewer.settings.leaveYearStart),
            requestId,
            period: null,
            note: null,
            createdBy: actor.userId,
          },
          session,
        );
      }
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: decision === 'approve' ? 'hr.leave.approved' : 'hr.leave.rejected',
          targetType: 'leave_request',
          targetId: requestId,
          metadata: {
            step,
            final,
            soleApprover: verdict.soleApprover,
            onBehalfOfManager: verdict.onBehalfOfManager,
          },
        },
        { session },
      );
    });
    const after = await this.requireOwn(organizationId, requestId);
    if (status === 'pending') {
      await this.notifyStep(organizationId, viewer, after, employee, actor.userId);
    } else {
      await this.notifier.leaveDecided({
        organizationId,
        requestId,
        employeeName: displayNameOf(employee),
        actorUserId: actor.userId,
        approved: status === 'approved',
        beneficiaryUserId: employee.userId ?? null,
        creatorUserId: r.createdBy,
        informedManagerUserId: type?.confidential ? managerUserIdOf(employee, viewer.byId) : null,
      });
    }
    return (await this.viewsOf(viewer, [after], await this.typesOf(organizationId)))[0]!;
  }

  async cancel(
    organizationId: string,
    viewer: HrViewer,
    requestId: string,
    body: CancelLeaveRequestBody,
    actor: HrActor,
  ): Promise<LeaveRequestView> {
    const r = await this.requireOwn(organizationId, requestId);
    const employee = viewer.byId.get(r.employeeId);
    if (!employee || !this.sees(viewer, r.employeeId)) requestNotFound();
    if (r.status !== 'pending' && r.status !== 'approved') {
      conflict('LEAVE_NOT_CANCELLABLE', 'Cette demande n’est plus annulable.');
    }
    const isBeneficiary = !!employee.userId && employee.userId === viewer.userId;
    const started = r.start.date <= hrToday();
    const ownWay = isBeneficiary && (r.status === 'pending' || !started);
    if (!ownWay) {
      if (viewer.actions.has('hr.manage')) {
        if (!body.reason) {
          invalidRequestOf([
            {
              path: 'reason',
              code: 'LEAVE_CANCEL_REASON_REQUIRED',
              message: 'Un motif est obligatoire pour annuler l’absence d’un collaborateur.',
            },
          ]);
        }
      } else if (isBeneficiary) {
        conflict(
          'LEAVE_ALREADY_STARTED',
          'Cette absence a commencé : demandez aux RH de l’annuler.',
        );
      } else {
        throw new ForbiddenException({
          code: 'LEAVE_CANCEL_FORBIDDEN',
          message: 'Seul le demandeur ou les RH peuvent annuler cette demande.',
        });
      }
    }
    const wasApproved = r.status === 'approved';
    await inHrTransaction(this.connection, async (session) => {
      await this.cancelOne(
        organizationId,
        r,
        body.reason ?? null,
        actor,
        viewer.settings.leaveYearStart,
        session,
        { cause: 'request' },
      );
    });
    if (wasApproved) {
      const manager = managerUserIdOf(employee, viewer.byId);
      const approvers = r.approvals.map((a) => a.userId);
      await this.notifier.leaveCancelled({
        organizationId,
        requestId,
        employeeName: displayNameOf(employee),
        actorUserId: actor.userId,
        recipients: [...(manager ? [manager] : []), ...approvers],
      });
    }
    return this.viewOne(organizationId, viewer, requestId);
  }

  private async cancelOne(
    organizationId: string,
    r: LeaveRequestLean,
    reason: string | null,
    actor: HrActor,
    leaveYearStart: string,
    session: ClientSession,
    metadata: Record<string, string>,
  ): Promise<void> {
    const res = await this.requests
      .updateOne(
        { _id: r._id, organizationId, revision: r.revision },
        {
          $set: {
            status: 'cancelled',
            cancelledAt: new Date(),
            cancelledBy: actor.userId,
            cancelReason: reason,
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
        { session },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(r.revision + 1);
    if (r.debited) {
      await this.writeLedger(
        {
          organizationId,
          employeeId: r.employeeId,
          typeId: r.typeId,
          kind: 'taken_reversal',
          days: r.days,
          effectiveOn: r.start.date,
          leaveYear: leaveYearOf(r.start.date, leaveYearStart),
          requestId: String(r._id),
          period: null,
          note: reason,
          createdBy: actor.userId,
        },
        session,
      );
    }
    await this.audit.recordStrict(
      {
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'hr.leave.cancelled',
        targetType: 'leave_request',
        targetId: String(r._id),
        metadata: { ...metadata, wasApproved: r.status === 'approved', reversed: r.debited },
      },
      { session },
    );
  }

  /**
   * Sortie d'un collaborateur (port `HR_EMPLOYEE_LIFECYCLE`, § 3.1) : ses absences
   * FUTURES (premier jour après la date de sortie), en attente ou approuvées, sont
   * annulées dans la transaction de la sortie ; une absence débitée est restituée
   * (`taken_reversal`). Chaque annulation est journalisée.
   */
  async cancelAfterExit(input: {
    organizationId: string;
    employeeId: string;
    actorUserId: string;
    endDate: string;
    session: ClientSession;
  }): Promise<number> {
    const docs = await this.requests
      .find(
        {
          organizationId: input.organizationId,
          employeeId: input.employeeId,
          status: { $in: ['pending', 'approved'] },
          'start.date': { $gt: input.endDate },
        },
        null,
        { session: input.session },
      )
      .lean<LeaveRequestLean[]>()
      .exec();
    if (docs.length === 0) return 0;
    const settings = await this.connection
      .collection('hr_settings')
      .findOne({ organizationId: input.organizationId }, { session: input.session });
    const leaveYearStart =
      typeof settings?.['leaveYearStart'] === 'string'
        ? (settings['leaveYearStart'] as string)
        : '01-01';
    const actor: HrActor = { userId: input.actorUserId, role: 'unknown' };
    for (const r of docs) {
      await this.cancelOne(
        input.organizationId,
        r,
        'Sortie du collaborateur',
        actor,
        leaveYearStart,
        input.session,
        { cause: 'employee_exit', endDate: input.endDate },
      );
    }
    return docs.length;
  }

  // ── Grand livre ──────────────────────────────────────────────────────────

  private async writeLedger(
    entry: Omit<LeaveLedgerEntryLean, '_id' | 'createdAt' | '_schemaVersion'>,
    session?: ClientSession,
  ): Promise<string> {
    try {
      const [created] = await this.ledger.create([{ ...entry, _schemaVersion: 1 }], { session });
      return String(created!._id);
    } catch (err) {
      if (isDuplicateKey(err)) {
        conflict('LEAVE_LEDGER_DUPLICATE', 'Ce mouvement est déjà inscrit au grand livre.');
      }
      throw err;
    }
  }

  async ledgerList(
    organizationId: string,
    viewer: HrViewer,
    query: ListLeaveLedgerQuery,
  ): Promise<LeaveLedgerView> {
    const employeeId = query.employeeId ?? viewer.scope.selfEmployeeId;
    if (!employeeId) notLinked();
    const isSelf = viewer.scope.selfEmployeeId === employeeId;
    if (!isSelf && !viewer.actions.has('hr.read')) employeeNotFound();
    if (!viewer.byId.has(employeeId)) employeeNotFound();
    const types = await this.typesOf(organizationId);
    const filter: Record<string, unknown> = { organizationId, employeeId };
    if (query.typeId !== undefined) filter['typeId'] = query.typeId;
    const docs = await this.ledger
      .find(filter)
      .sort({ effectiveOn: 1, createdAt: 1, _id: 1 })
      .lean<LeaveLedgerEntryLean[]>()
      .exec();
    const items: LeaveLedgerEntryView[] = docs
      .filter((e) => this.typeVisible(viewer, employeeId, types.get(e.typeId)))
      .map((e) => ({
        id: String(e._id),
        employeeId: e.employeeId,
        typeId: e.typeId,
        kind: e.kind,
        days: e.days,
        effectiveOn: e.effectiveOn,
        leaveYear: e.leaveYear,
        requestId: e.requestId ?? null,
        period: e.period ?? null,
        note: e.note ?? null,
        createdBy: e.createdBy,
        createdAt: new Date(e.createdAt).toISOString(),
      }));
    return { items };
  }

  /** Attribution ou ajustement manuel (`hr.manage`), note obligatoire, audité. */
  async adjust(
    organizationId: string,
    viewer: HrViewer,
    body: CreateLeaveLedgerEntryBody,
    actor: HrActor,
  ): Promise<LeaveLedgerEntryView> {
    if (!viewer.byId.has(body.employeeId)) employeeNotFound();
    const type = await this.types.requireOwn(organizationId, body.typeId);
    const leaveYear = leaveYearOf(body.effectiveOn, viewer.settings.leaveYearStart);
    let id = '';
    await inHrTransaction(this.connection, async (session) => {
      id = await this.writeLedger(
        {
          organizationId,
          employeeId: body.employeeId,
          typeId: String(type._id),
          kind: body.kind,
          days: body.days,
          effectiveOn: body.effectiveOn,
          leaveYear,
          requestId: null,
          period: null,
          note: body.note,
          createdBy: actor.userId,
        },
        session,
      );
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'hr.leave_balance.adjusted',
          targetType: 'employee',
          targetId: body.employeeId,
          metadata: {
            typeId: String(type._id),
            kind: body.kind,
            days: body.days,
            effectiveOn: body.effectiveOn,
          },
        },
        { session },
      );
    });
    const all = await this.ledgerList(organizationId, viewer, {
      employeeId: body.employeeId,
      typeId: String(type._id),
    });
    return all.items.find((e) => e.id === id)!;
  }

  // ── Calendrier (§ 3.2) ───────────────────────────────────────────────────

  async calendar(
    organizationId: string,
    viewer: HrViewer,
    query: HrCalendarQuery,
  ): Promise<HrCalendarView> {
    const span =
      (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000;
    if (span < 0 || span + 1 > 366) {
      invalidRequestOf([
        {
          path: 'to',
          code: 'HR_CALENDAR_RANGE',
          message: 'Fenêtre du calendrier : de 1 à 366 jours, la fin après le début.',
        },
      ]);
    }
    const s = viewer.scope;
    const self = s.selfEmployeeId ? [s.selfEmployeeId] : [];
    const wanted =
      query.scope === 'me'
        ? self
        : query.scope === 'team'
          ? [...self, ...s.teamEmployeeIds]
          : query.scope === 'department'
            ? [...self, ...s.departmentEmployeeIds]
            : s.calendarEmployeeIds;
    const allowed = new Set([...s.calendarEmployeeIds, ...self]);
    const visible = [...new Set(wanted)].filter((id) => allowed.has(id)).sort();
    const [docs, types, holidays] = await Promise.all([
      visible.length === 0
        ? Promise.resolve([] as LeaveRequestLean[])
        : this.requests
            .find({
              organizationId,
              employeeId: { $in: visible },
              status: { $in: ['pending', 'approved'] },
              'start.date': { $lte: query.to },
              'end.date': { $gte: query.from },
            })
            .lean<LeaveRequestLean[]>()
            .exec(),
      this.types.all(organizationId),
      this.holidays.engineInput(organizationId),
    ]);
    const result = teamCalendar(
      docs.map((r) => ({
        id: String(r._id),
        employeeId: r.employeeId,
        typeId: r.typeId,
        status: r.status,
        start: r.start,
        end: r.end,
        days: r.days,
      })),
      types.map((t) => ({ id: String(t._id), label: t.label, confidential: t.confidential })),
      {
        selfEmployeeId: s.selfEmployeeId,
        visibleEmployeeIds: visible,
        pendingVisibleEmployeeIds: s.pendingVisibleEmployeeIds,
        seesConfidential:
          viewer.actions.has('hr.sensitive.read') || viewer.actions.has('leave.approve'),
      },
      holidays,
      query.from,
      query.to,
    );
    const nameOf = (id: string) => {
      const e = viewer.byId.get(id);
      return e ? displayNameOf(e) : '';
    };
    return {
      version: result.version,
      from: result.from,
      to: result.to,
      scope: query.scope,
      entries: result.entries.map((e) => ({ ...e, employeeName: nameOf(e.employeeId) })),
      days: result.days,
      holidays: result.holidays,
      employees: visible.map((id) => ({
        id,
        name: nameOf(id),
        departmentId: viewer.byId.get(id)?.departmentId ?? null,
      })),
    };
  }
}
