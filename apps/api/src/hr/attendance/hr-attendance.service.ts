// Pointages, journées de présence et corrections (ADR-0051 § 2.3, § 3.4, § 4, § 6.2).
// ADR-0051 — H12.
//
// - ÉTEINT par défaut : toute route rend `409 HR_FEATURE_DISABLED` tant que l'organisation
//   n'a pas activé `attendance.enabled` (décision ouverte n° 8).
// - Pointage SIMPLE : « J'arrive » / « Je pars », horodatage SERVEUR ; rien d'autre n'est
//   lu ni stocké (ni IP, ni position, ni appareil). Au plus 20 pointages par jour et par
//   collaborateur (`429 ATTENDANCE_RATE_LIMITED`).
// - Calculs au MOTEUR : journées, paires, minutes et constats (`attendanceDays`) ; aucune
//   durée légale, aucune heure supplémentaire (J3). Rien n'est additionné ici.
// - Correction : demandée, puis DÉCIDÉE par `attendanceCorrectionDecision` (manager
//   désigné ou `hr.manage`, jamais le collaborateur ni l'auteur d'une saisie pour autrui,
//   sauf approbateur unique marqué). Approuvée : pointages `source: 'correction'` écrits
//   et `voidedBy` posé sur les annulés, DANS LA MÊME TRANSACTION.
// - Portée : le collaborateur, son manager (équipe), `hr.read` ; hors portée → 404.

import { attendanceDays, kinshasaInstant, type AttendanceDayResult } from '@lalanda/engine';
import {
  ATTENDANCE_CLOCK_NOTICE,
  ATTENDANCE_LIMITS,
  PLANNING_LIMITS,
  type AttendanceCorrectionStatus,
  type AttendanceDaysQuery,
  type AttendanceEventKind,
  type AttendanceSource,
  type ClockAttendanceBody,
  type CreateAttendanceCorrectionBody,
  type CreateAttendanceEventBody,
  type DecideAttendanceCorrectionBody,
  type ListAttendanceCorrectionsQuery,
  type RejectAttendanceCorrectionBody,
} from '@lalanda/shared/hr';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { forbidden } from '../../authz/authz.service.js';
import {
  attendanceCorrectionDecision,
  type AttendanceCorrectionDecision,
} from '../../authz/permissions.js';
import {
  conflict,
  invalidCursor,
  invalidRequestOf,
  staleRevision,
} from '../../sales/sales.errors.js';
import { decodeCursor, encodeCursor, isObjectIdHex } from '../../sales/search.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import type { EmployeeLean } from '../employees/employee.schema.js';
import { HrHolidaysService } from '../holidays/hr-holidays.service.js';
import { displayNameOf } from '../leave/display-name.js';
import { managerUserIdOf } from '../leave/leave-model.js';
import {
  HrPresenceReader,
  addDaysIso,
  shiftInputOf,
  spanDays,
} from '../planning/hr-presence-reader.js';
import { employeeNotFound, inHrTransaction } from '../scope/hr-errors.js';
import type { HrViewer } from '../scope/hr-scope.service.js';
import {
  AttendanceCorrection,
  AttendanceEvent,
  type AttendanceCorrectionDocument,
  type AttendanceCorrectionLean,
  type AttendanceEventDocument,
  type AttendanceEventLean,
} from './attendance.schemas.js';
import { HrPresenceNotifier } from './hr-presence-notifier.js';
import { HrPresenceSettingsService, featureDisabled } from './hr-presence-settings.js';

const HOUR_MS = 3_600_000;

// ── Vues ────────────────────────────────────────────────────────────────────

export interface AttendanceEventView {
  id: string;
  employeeId: string;
  kind: AttendanceEventKind;
  at: string;
  source: AttendanceSource;
  note: string | null;
  voidedBy: string | null;
  correctionId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface AttendanceClockView {
  event: AttendanceEventView;
  /** Ce que Lalanda enregistre : l'heure du serveur, rien d'autre (§ 10). */
  notice: string;
}

export interface AttendanceDaysView {
  employeeId: string;
  employeeName: string;
  from: string;
  to: string;
  planningEnabled: boolean;
  lateToleranceMinutes: number | null;
  /** Version du moteur (`HR_VERSION`). */
  version: string;
  /** Total de la période, en minutes (moteur). */
  minutes: number;
  days: AttendanceDayResult[];
  /** Pointages de la période (annulés compris, marqués `voidedBy`). */
  events: AttendanceEventView[];
}

export interface AttendanceCorrectionView {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  proposed: { kind: AttendanceEventKind; at: string }[];
  voidEventIds: string[];
  reason: string;
  status: AttendanceCorrectionStatus;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
  soleApprover: boolean;
  createdEventIds: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceCorrectionPage {
  items: AttendanceCorrectionView[];
  nextCursor: string | null;
}

// ── Erreurs ─────────────────────────────────────────────────────────────────

function notLinked(): never {
  conflict(
    'EMPLOYEE_NOT_LINKED',
    'Aucun dossier collaborateur n’est relié à votre compte : demandez aux RH de le créer.',
  );
}

function correctionNotFound(): never {
  throw new NotFoundException({
    code: 'ATTENDANCE_CORRECTION_NOT_FOUND',
    message: 'Demande de correction introuvable.',
  });
}

function eventNotFound(): never {
  throw new NotFoundException({
    code: 'ATTENDANCE_EVENT_NOT_FOUND',
    message: 'Pointage introuvable.',
  });
}

function inFuture(): never {
  throw new UnprocessableEntityException({
    code: 'ATTENDANCE_IN_FUTURE',
    message: 'Un pointage ne peut pas être daté dans le futur.',
  });
}

function rateLimited(): never {
  throw new HttpException(
    {
      code: 'ATTENDANCE_RATE_LIMITED',
      message: `${ATTENDANCE_LIMITS.eventsPerDayMax} pointages par jour et par collaborateur au plus.`,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

function refuse(d: Extract<AttendanceCorrectionDecision, { ok: false }>): never {
  if (d.code === 'ATTENDANCE_CORRECTION_NOT_YOURS') {
    throw new ForbiddenException({
      code: 'ATTENDANCE_CORRECTION_NOT_YOURS',
      message: 'Cette correction est décidée par le manager du collaborateur ou par les RH.',
    });
  }
  if (d.code === 'SELF_APPROVAL_FORBIDDEN') {
    conflict('SELF_APPROVAL_FORBIDDEN', 'On ne décide pas la correction de ses propres pointages.');
  }
  conflict(
    'CREATOR_APPROVAL_FORBIDDEN',
    'Vous avez saisi cette correction : une autre personne la décide.',
  );
}

function rangeCheck(from: string, to: string): void {
  if (spanDays(from, to) > PLANNING_LIMITS.rangeDaysMax) {
    invalidRequestOf([
      {
        path: 'to',
        code: 'HR_RANGE_TOO_LONG',
        message: `Période de ${PLANNING_LIMITS.rangeDaysMax} jours au plus.`,
      },
    ]);
  }
}

function eventViewOf(e: AttendanceEventLean): AttendanceEventView {
  return {
    id: String(e._id),
    employeeId: e.employeeId,
    kind: e.kind,
    at: new Date(e.at).toISOString(),
    source: e.source,
    note: e.note ?? null,
    voidedBy: e.voidedBy ?? null,
    correctionId: e.correctionId ?? null,
    createdBy: e.createdBy,
    createdAt: new Date(e.createdAt).toISOString(),
  };
}

@Injectable()
export class HrAttendanceService {
  constructor(
    @InjectModel(AttendanceEvent.name) private readonly events: Model<AttendanceEventDocument>,
    @InjectModel(AttendanceCorrection.name)
    private readonly corrections: Model<AttendanceCorrectionDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(HrPresenceSettingsService) private readonly settings: HrPresenceSettingsService,
    @Inject(HrPresenceReader) private readonly reader: HrPresenceReader,
    @Inject(HrHolidaysService) private readonly holidays: HrHolidaysService,
    @Inject(HrPresenceNotifier) private readonly notifier: HrPresenceNotifier,
  ) {}

  // ── Portée ───────────────────────────────────────────────────────────────

  /** Le lecteur voit les présences de ce collaborateur : soi, équipe, `hr.read`. */
  private sees(viewer: HrViewer, employeeId: string): boolean {
    if (!viewer.byId.has(employeeId)) return false;
    if (viewer.actions.has('hr.read')) return true;
    return (
      viewer.scope.selfEmployeeId === employeeId ||
      viewer.scope.teamEmployeeIds.includes(employeeId)
    );
  }

  /** Saisir pour autrui : manager (équipe) ou `hr.manage` ; jamais pour soi par ce chemin. */
  private requireEntryFor(viewer: HrViewer, employeeId: string): EmployeeLean {
    const employee = viewer.byId.get(employeeId);
    if (!employee || employee.status === 'anonymized') employeeNotFound();
    const isTeam = viewer.scope.teamEmployeeIds.includes(employeeId);
    const isSelf = viewer.scope.selfEmployeeId === employeeId;
    if (viewer.actions.has('hr.manage') && !isSelf) return employee;
    if (isTeam) return employee;
    if (isSelf) {
      throw new ForbiddenException({
        code: 'ATTENDANCE_ENTRY_NOT_YOURS',
        message:
          'On ne saisit pas ses propres présences pour autrui : pointez, ou demandez une correction.',
      });
    }
    if (!this.sees(viewer, employeeId)) employeeNotFound();
    throw new ForbiddenException(forbidden('hr.manage', viewer.role));
  }

  // ── Pointer ──────────────────────────────────────────────────────────────

  private async checkRate(organizationId: string, employeeId: string, at: Date): Promise<void> {
    // Jour civil de Kinshasa (UTC+1) du pointage.
    const day = new Date(at.getTime() + HOUR_MS).toISOString().slice(0, 10);
    const start = new Date(kinshasaInstant(day, 0));
    const end = new Date(kinshasaInstant(addDaysIso(day, 1), 0));
    const n = await this.events
      .countDocuments({
        organizationId,
        employeeId,
        source: { $in: ['self', 'manager', 'hr'] },
        at: { $gte: start, $lt: end },
      })
      .exec();
    if (n >= ATTENDANCE_LIMITS.eventsPerDayMax) rateLimited();
  }

  /** `POST /hr/attendance/clock` — pour soi, horodatage serveur. */
  async clock(
    organizationId: string,
    viewer: HrViewer,
    body: ClockAttendanceBody,
    actor: HrActor,
  ): Promise<AttendanceClockView> {
    const s = await this.settings.requireAttendance(organizationId);
    if (!s.attendance.selfClock) featureDisabled('selfClock');
    const employeeId = viewer.scope.selfEmployeeId;
    if (!employeeId) notLinked();
    const employee = viewer.byId.get(employeeId);
    if (!employee || employee.status !== 'active') {
      conflict('EMPLOYEE_NOT_ACTIVE', 'Ce collaborateur n’est plus actif.');
    }
    const at = new Date();
    await this.checkRate(organizationId, employeeId, at);
    const doc = await this.events.create({
      organizationId,
      employeeId,
      kind: body.kind,
      at,
      source: 'self',
      note: null,
      voidedBy: null,
      correctionId: null,
      createdBy: actor.userId,
      _schemaVersion: 1,
    });
    return {
      event: eventViewOf(doc.toObject() as AttendanceEventLean),
      notice: ATTENDANCE_CLOCK_NOTICE,
    };
  }

  /** `POST /hr/attendance/events` — saisie pour autrui (manager ou RH), note obligatoire. */
  async record(
    organizationId: string,
    viewer: HrViewer,
    body: CreateAttendanceEventBody,
    actor: HrActor,
  ): Promise<AttendanceEventView> {
    await this.settings.requireAttendance(organizationId);
    const employee = this.requireEntryFor(viewer, body.employeeId);
    const at = new Date(body.at);
    if (at.getTime() > Date.now()) inFuture();
    await this.checkRate(organizationId, body.employeeId, at);
    const source: AttendanceSource = viewer.actions.has('hr.manage') ? 'hr' : 'manager';
    const doc = await this.events.create({
      organizationId,
      employeeId: String(employee._id),
      kind: body.kind,
      at,
      source,
      note: body.note,
      voidedBy: null,
      correctionId: null,
      createdBy: actor.userId,
      _schemaVersion: 1,
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.attendance.event_recorded',
      targetType: 'hr_attendance_event',
      targetId: String(doc._id),
      metadata: { employeeId: body.employeeId, kind: body.kind, source },
    });
    return eventViewOf(doc.toObject() as AttendanceEventLean);
  }

  // ── Journées (moteur) ────────────────────────────────────────────────────

  /** `GET /hr/attendance/days` — journées calculées par le moteur, constats compris. */
  async days(
    organizationId: string,
    viewer: HrViewer,
    query: AttendanceDaysQuery,
  ): Promise<AttendanceDaysView> {
    const s = await this.settings.requireAttendance(organizationId);
    rangeCheck(query.from, query.to);
    const employeeId = query.employeeId ?? viewer.scope.selfEmployeeId;
    if (!employeeId) notLinked();
    if (!this.sees(viewer, employeeId)) employeeNotFound();
    const employee = viewer.byId.get(employeeId)!;
    // Fenêtre élargie d'un jour de chaque côté : une paire peut franchir minuit.
    const windowStart = new Date(kinshasaInstant(addDaysIso(query.from, -1), 0));
    const windowEnd = new Date(kinshasaInstant(addDaysIso(query.to, 2), 0));
    const [events, shifts, absences, holidays] = await Promise.all([
      this.events
        .find({ organizationId, employeeId, at: { $gte: windowStart, $lt: windowEnd } })
        .sort({ at: 1, _id: 1 })
        .lean<AttendanceEventLean[]>()
        .exec(),
      s.planning.enabled
        ? this.reader.shiftsIn(
            organizationId,
            [employeeId],
            addDaysIso(query.from, -1),
            addDaysIso(query.to, 1),
            ['published'],
          )
        : Promise.resolve([]),
      this.reader.approvedLeaves(organizationId, [employeeId], query.from, query.to),
      this.holidays.engineInput(organizationId),
    ]);
    const result = attendanceDays(
      events.map((e) => ({
        id: String(e._id),
        kind: e.kind,
        at: new Date(e.at).toISOString(),
        voidedBy: e.voidedBy ?? null,
      })),
      shifts.map(shiftInputOf),
      absences.map(({ start, end }) => ({ start, end })),
      holidays,
      query.from,
      query.to,
      {
        planningEnabled: s.planning.enabled,
        lateToleranceMinutes: s.attendance.lateToleranceMinutes,
        now: new Date().toISOString(),
      },
    );
    const from = new Date(kinshasaInstant(query.from, 0));
    const to = new Date(kinshasaInstant(addDaysIso(query.to, 1), 0));
    return {
      employeeId,
      employeeName: displayNameOf(employee),
      from: query.from,
      to: query.to,
      planningEnabled: s.planning.enabled,
      lateToleranceMinutes: s.attendance.lateToleranceMinutes,
      version: result.version,
      minutes: result.minutes,
      days: result.days,
      events: events.filter((e) => e.at >= from && e.at < to).map(eventViewOf),
    };
  }

  // ── Corrections ──────────────────────────────────────────────────────────

  private correctionViewOf(
    viewer: HrViewer,
    c: AttendanceCorrectionLean,
  ): AttendanceCorrectionView {
    const employee = viewer.byId.get(c.employeeId);
    return {
      id: String(c._id),
      employeeId: c.employeeId,
      employeeName: employee ? displayNameOf(employee) : '',
      date: c.date,
      proposed: c.proposed.map((p) => ({ kind: p.kind, at: new Date(p.at).toISOString() })),
      voidEventIds: [...c.voidEventIds],
      reason: c.reason,
      status: c.status,
      requestedBy: c.requestedBy,
      decidedBy: c.decidedBy ?? null,
      decidedAt: c.decidedAt ? new Date(c.decidedAt).toISOString() : null,
      comment: c.comment ?? null,
      soleApprover: c.soleApprover,
      createdEventIds: [...(c.createdEventIds ?? [])],
      revision: c.revision,
      createdAt: new Date(c.createdAt).toISOString(),
      updatedAt: new Date(c.updatedAt).toISOString(),
    };
  }

  private async requireCorrection(
    organizationId: string,
    id: string,
  ): Promise<AttendanceCorrectionLean> {
    if (typeof id !== 'string' || !isObjectIdHex(id)) correctionNotFound();
    const doc = await this.corrections
      .findOne({ _id: new Types.ObjectId(id), organizationId })
      .lean<AttendanceCorrectionLean>()
      .exec();
    if (!doc) correctionNotFound();
    return doc;
  }

  /** `POST /hr/attendance/corrections` — pour soi (`attendance.clock`) ou pour autrui. */
  async requestCorrection(
    organizationId: string,
    viewer: HrViewer,
    body: CreateAttendanceCorrectionBody,
    actor: HrActor,
  ): Promise<AttendanceCorrectionView> {
    await this.settings.requireAttendance(organizationId);
    const selfId = viewer.scope.selfEmployeeId;
    const forOther = body.employeeId !== undefined && body.employeeId !== selfId;
    let employee: EmployeeLean;
    if (forOther) {
      employee = this.requireEntryFor(viewer, body.employeeId!);
    } else {
      if (!viewer.actions.has('attendance.clock')) {
        throw new ForbiddenException(forbidden('attendance.clock', viewer.role));
      }
      if (!selfId) notLinked();
      employee = viewer.byId.get(selfId)!;
    }
    const employeeId = String(employee._id);
    const now = Date.now();
    for (const p of body.proposed) if (Date.parse(p.at) > now) inFuture();
    const voidIds = [...new Set(body.voidEventIds)];
    if (voidIds.length > 0) {
      const found = await this.events
        .find({
          organizationId,
          employeeId,
          _id: { $in: voidIds.map((id) => new Types.ObjectId(id)) },
        })
        .lean<AttendanceEventLean[]>()
        .exec();
      if (found.length !== voidIds.length) eventNotFound();
      if (found.some((e) => e.voidedBy)) {
        conflict('ATTENDANCE_EVENT_ALREADY_VOIDED', 'Un de ces pointages est déjà annulé.');
      }
    }
    const doc = await this.corrections.create({
      organizationId,
      employeeId,
      date: body.date,
      proposed: body.proposed.map((p) => ({ kind: p.kind, at: new Date(p.at) })),
      voidEventIds: voidIds,
      reason: body.reason,
      status: 'pending',
      requestedBy: actor.userId,
      decidedBy: null,
      decidedAt: null,
      comment: null,
      soleApprover: false,
      createdEventIds: [],
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    const id = String(doc._id);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.attendance.correction_requested',
      targetType: 'hr_attendance_correction',
      targetId: id,
      metadata: {
        employeeId,
        date: body.date,
        proposed: body.proposed.length,
        voided: voidIds.length,
        forOther,
      },
    });
    const manager = managerUserIdOf(employee, viewer.byId);
    const recipients =
      manager && manager !== actor.userId
        ? [manager]
        : await this.notifier.hrManagersOf(organizationId);
    await this.notifier.correctionRequested({
      organizationId,
      actorUserId: actor.userId,
      entityId: id,
      employeeName: displayNameOf(employee),
      recipients: recipients.filter((u) => u !== employee.userId),
    });
    return this.correctionViewOf(viewer, doc.toObject() as AttendanceCorrectionLean);
  }

  /** `GET /hr/attendance/corrections` — soi, équipe, `hr.read`. */
  async listCorrections(
    organizationId: string,
    viewer: HrViewer,
    query: ListAttendanceCorrectionsQuery,
  ): Promise<AttendanceCorrectionPage> {
    await this.settings.requireAttendance(organizationId);
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.employeeId !== undefined) {
      if (!this.sees(viewer, query.employeeId)) employeeNotFound();
      and.push({ employeeId: query.employeeId });
    } else if (!viewer.actions.has('hr.read')) {
      const ids = new Set(viewer.scope.teamEmployeeIds);
      if (viewer.scope.selfEmployeeId) ids.add(viewer.scope.selfEmployeeId);
      and.push({ employeeId: { $in: [...ids] } });
    }
    if (query.status !== undefined) and.push({ status: query.status });
    if (query.cursor !== undefined) {
      const c = decodeCursor(query.cursor);
      if (c === null) invalidCursor();
      const at = new Date(c.sortName);
      if (Number.isNaN(at.getTime())) invalidCursor();
      and.push({ $or: [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: c.id } }] });
    }
    const docs = await this.corrections
      .find({ $and: and })
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<AttendanceCorrectionLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((c) => this.correctionViewOf(viewer, c)),
      nextCursor:
        docs.length > query.limit && last
          ? encodeCursor(new Date(last.createdAt).toISOString(), String(last._id))
          : null,
    };
  }

  async approveCorrection(
    organizationId: string,
    viewer: HrViewer,
    id: string,
    body: DecideAttendanceCorrectionBody,
    actor: HrActor,
  ): Promise<AttendanceCorrectionView> {
    return this.decide(organizationId, viewer, id, 'approve', body.comment ?? null, actor);
  }

  async rejectCorrection(
    organizationId: string,
    viewer: HrViewer,
    id: string,
    body: RejectAttendanceCorrectionBody,
    actor: HrActor,
  ): Promise<AttendanceCorrectionView> {
    return this.decide(organizationId, viewer, id, 'reject', body.comment, actor);
  }

  private async decide(
    organizationId: string,
    viewer: HrViewer,
    id: string,
    decision: 'approve' | 'reject',
    comment: string | null,
    actor: HrActor,
  ): Promise<AttendanceCorrectionView> {
    await this.settings.requireAttendance(organizationId);
    const c = await this.requireCorrection(organizationId, id);
    const employee = viewer.byId.get(c.employeeId);
    if (!employee) correctionNotFound();
    if (!this.sees(viewer, c.employeeId) && !viewer.actions.has('hr.manage')) {
      correctionNotFound();
    }
    if (c.status !== 'pending') {
      conflict(
        'ATTENDANCE_CORRECTION_NOT_PENDING',
        'Cette demande de correction est déjà décidée.',
      );
    }
    const manager = managerUserIdOf(employee, viewer.byId);
    const holdsHrManage = viewer.actions.has('hr.manage');
    const hrManagers = await this.notifier.hrManagersOf(organizationId);
    const verdict = attendanceCorrectionDecision({
      decision,
      deciderUserId: viewer.userId,
      beneficiaryUserId: employee.userId ?? null,
      requestedBy: c.requestedBy,
      isDesignatedManager: manager !== null && manager === viewer.userId,
      hasOtherDesignatedManager: manager !== null && manager !== viewer.userId,
      holdsHrManage,
      hrManagerCountInOrg: hrManagers.length,
      allowSoleApprover: viewer.settings.allowSoleApprover,
    });
    if (!verdict.ok) {
      // Le collaborateur lui-même, sans autre titre pour décider : le refus nomme la
      // vraie raison (critère 11 : 409 SELF_APPROVAL_FORBIDDEN), pas l'absence de rôle.
      if (verdict.code === 'ATTENDANCE_CORRECTION_NOT_YOURS' && employee.userId === viewer.userId) {
        refuse({ ok: false, code: 'SELF_APPROVAL_FORBIDDEN' });
      }
      refuse(verdict);
    }
    const now = new Date();
    const createdIds: string[] = [];
    await inHrTransaction(this.connection, async (session) => {
      createdIds.length = 0;
      if (decision === 'approve') {
        if (c.voidEventIds.length > 0) {
          const res = await this.events
            .updateMany(
              {
                organizationId,
                employeeId: c.employeeId,
                _id: { $in: c.voidEventIds.map((v) => new Types.ObjectId(v)) },
                voidedBy: null,
              },
              { $set: { voidedBy: id } },
              { session },
            )
            .exec();
          if (res.matchedCount !== c.voidEventIds.length) {
            conflict(
              'ATTENDANCE_EVENT_ALREADY_VOIDED',
              'Un des pointages à annuler l’a déjà été par une autre correction.',
            );
          }
        }
        if (c.proposed.length > 0) {
          const note = `Correction : ${c.reason}`.slice(0, ATTENDANCE_LIMITS.note);
          const docs = await this.events.insertMany(
            c.proposed.map((p) => ({
              organizationId,
              employeeId: c.employeeId,
              kind: p.kind,
              at: p.at,
              source: 'correction' as const,
              note,
              voidedBy: null,
              correctionId: id,
              createdBy: actor.userId,
              _schemaVersion: 1,
            })),
            { session },
          );
          createdIds.push(...docs.map((d) => String(d._id)));
        }
      }
      const res = await this.corrections
        .updateOne(
          { _id: c._id, organizationId, revision: c.revision, status: 'pending' },
          {
            $set: {
              status: decision === 'approve' ? 'approved' : 'rejected',
              decidedBy: viewer.userId,
              decidedAt: now,
              comment,
              soleApprover: verdict.soleApprover,
              createdEventIds: createdIds,
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(c.revision + 1);
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action:
            decision === 'approve'
              ? 'hr.attendance.correction_approved'
              : 'hr.attendance.correction_rejected',
          targetType: 'hr_attendance_correction',
          targetId: id,
          metadata: {
            employeeId: c.employeeId,
            soleApprover: verdict.soleApprover,
            voided: decision === 'approve' ? c.voidEventIds.length : 0,
            created: createdIds.length,
          },
        },
        { session },
      );
    });
    await this.notifier.correctionDecided({
      organizationId,
      actorUserId: actor.userId,
      entityId: id,
      approved: decision === 'approve',
      beneficiaryUserId: employee.userId ?? null,
      requestedBy: c.requestedBy,
      employeeName: displayNameOf(employee),
    });
    return this.correctionViewOf(viewer, await this.requireCorrection(organizationId, id));
  }
}
