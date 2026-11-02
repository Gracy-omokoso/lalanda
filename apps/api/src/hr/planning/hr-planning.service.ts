// Plannings : créneaux, besoins minimaux, constats (ADR-0051 § 2.4, § 3.6, § 4, § 6.2).
// ADR-0051 — H12.
//
// - ÉTEINTS par défaut : toute route rend `409 HR_FEATURE_DISABLED` tant que l'organisation
//   n'a pas activé `planning.enabled` (décision ouverte n° 9).
// - Une GRILLE (O5) : établie et publiée par le manager (son équipe) ou `hr.manage` ;
//   aucune approbation, aucune affectation automatique. Le collaborateur ne publie pas son
//   créneau ; il signale une indisponibilité.
// - Calculs au MOTEUR : chevauchement (`shiftOverlaps`, seul refus : `409 SHIFT_OVERLAP`),
//   constats (`shiftConflicts` : `SHIFT_DURING_LEAVE`, `SHIFT_ABOVE_INDICATIVE_LIMIT` avec
//   le seuil SAISI, vide par défaut) et sous-effectif (`staffingGaps`). Aucune durée
//   maximale, aucun repos, aucun travail de nuit contrôlé (J3).
// - Portée : un créneau publié se voit selon le calendrier d'équipe d'ADR-0045
//   (`teamCalendarVisibility`) ; un brouillon, par ses planificateurs. Hors portée → 404.

import {
  shiftConflicts,
  shiftOverlaps,
  staffingGaps,
  type ShiftFinding,
  type ShiftInput,
  type StaffingGap,
  type Weekday,
} from '@lalanda/engine';
import {
  PLANNING_LIMITS,
  type CopyShiftWeekBody,
  type CreateShiftBody,
  type ListShiftsQuery,
  type PlanningGapsQuery,
  type PublishShiftsBody,
  type ShiftStatus,
  type ShiftUnavailabilityBody,
  type StaffingNeedBody,
  type UpdateShiftBody,
} from '@lalanda/shared/hr';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { forbidden } from '../../authz/authz.service.js';
import { conflict, invalidRequestOf, staleRevision } from '../../sales/sales.errors.js';
import { isObjectIdHex } from '../../sales/search.js';
import { HrPresenceNotifier } from '../attendance/hr-presence-notifier.js';
import { HrPresenceSettingsService } from '../attendance/hr-presence-settings.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import { Department, type DepartmentDocument } from '../departments/department.schema.js';
import type { EmployeeLean } from '../employees/employee.schema.js';
import { displayNameOf } from '../leave/display-name.js';
import { departmentNotFound, employeeNotFound } from '../scope/hr-errors.js';
import type { HrViewer } from '../scope/hr-scope.service.js';
import {
  HrPresenceReader,
  addDaysIso,
  isMonday,
  mondayOfIso,
  shiftInputOf,
  spanDays,
} from './hr-presence-reader.js';
import {
  Shift,
  StaffingNeed,
  type ShiftDocument,
  type ShiftLean,
  type StaffingNeedDocument,
  type StaffingNeedLean,
} from './planning.schemas.js';

// ── Vues ────────────────────────────────────────────────────────────────────

export interface ShiftView {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  start: string;
  end: string;
  crossesMidnight: boolean;
  label: string | null;
  location: string | null;
  departmentId: string | null;
  workProjectId: string | null;
  status: ShiftStatus;
  publishedAt: string | null;
  note: string | null;
  /** Indisponibilité signalée : le collaborateur et ses planificateurs seulement. */
  unavailability: { comment: string; at: string } | null;
  /** Le lecteur peut modifier, publier ou annuler ce créneau. */
  canPlan: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftListView {
  from: string;
  to: string;
  scope: string;
  items: ShiftView[];
  /** Constats du moteur sur les créneaux que le lecteur planifie (jamais un refus). */
  findings: ShiftFinding[];
}

export interface ShiftWriteView {
  shift: ShiftView;
  findings: ShiftFinding[];
}

export interface StaffingNeedView {
  id: string;
  departmentId: string | null;
  location: string | null;
  weekday: string;
  start: string;
  end: string;
  crossesMidnight: boolean;
  minStaff: number;
  label: string | null;
  revision: number;
}

export interface PlanningGapsView {
  version: string;
  from: string;
  to: string;
  /** `UNDERSTAFFED_SLOT` : des nombres seulement, aucun nom. */
  gaps: (StaffingGap & {
    departmentId: string | null;
    location: string | null;
    label: string | null;
  })[];
  slotsChecked: number;
  findings: ShiftFinding[];
}

// ── Erreurs ─────────────────────────────────────────────────────────────────

function shiftNotFound(): never {
  throw new NotFoundException({ code: 'SHIFT_NOT_FOUND', message: 'Créneau introuvable.' });
}

function needNotFound(): never {
  throw new NotFoundException({
    code: 'STAFFING_NEED_NOT_FOUND',
    message: 'Besoin d’effectif introuvable.',
  });
}

function notLinked(): never {
  conflict(
    'EMPLOYEE_NOT_LINKED',
    'Aucun dossier collaborateur n’est relié à votre compte : demandez aux RH de le créer.',
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

function overlap(ids: readonly string[]): never {
  conflict('SHIFT_OVERLAP', 'Ce créneau chevauche un autre créneau du même collaborateur.', {
    shiftIds: [...ids],
  });
}

function needViewOf(n: StaffingNeedLean): StaffingNeedView {
  return {
    id: String(n._id),
    departmentId: n.departmentId ?? null,
    location: n.location ?? null,
    weekday: n.weekday,
    start: n.start,
    end: n.end,
    crossesMidnight: n.crossesMidnight,
    minStaff: n.minStaff,
    label: n.label ?? null,
    revision: n.revision,
  };
}

type ShiftFields = Omit<CreateShiftBody, 'employeeId'>;

@Injectable()
export class HrPlanningService {
  constructor(
    @InjectModel(Shift.name) private readonly shifts: Model<ShiftDocument>,
    @InjectModel(StaffingNeed.name) private readonly needs: Model<StaffingNeedDocument>,
    @InjectModel(Department.name) private readonly departments: Model<DepartmentDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(HrPresenceSettingsService) private readonly settings: HrPresenceSettingsService,
    @Inject(HrPresenceReader) private readonly reader: HrPresenceReader,
    @Inject(HrPresenceNotifier) private readonly notifier: HrPresenceNotifier,
  ) {}

  // ── Portée ───────────────────────────────────────────────────────────────

  /** Planificateur : `hr.manage` (tous), ou manager de l'équipe ; jamais pour soi seul. */
  private plans(viewer: HrViewer, employeeId: string): boolean {
    if (!viewer.byId.has(employeeId)) return false;
    if (viewer.actions.has('hr.manage')) return true;
    return viewer.scope.teamEmployeeIds.includes(employeeId);
  }

  /** Collaborateurs dont le lecteur voit les créneaux PUBLIÉS (calendrier d'équipe). */
  private calendarIds(viewer: HrViewer): Set<string> {
    const ids = new Set(viewer.scope.calendarEmployeeIds);
    if (viewer.scope.selfEmployeeId) ids.add(viewer.scope.selfEmployeeId);
    for (const id of viewer.scope.teamEmployeeIds) ids.add(id);
    if (viewer.actions.has('hr.read')) for (const e of viewer.employees) ids.add(String(e._id));
    return ids;
  }

  private seesShift(viewer: HrViewer, s: ShiftLean): boolean {
    if (this.plans(viewer, s.employeeId)) return true;
    return s.status === 'published' && this.calendarIds(viewer).has(s.employeeId);
  }

  /** Employé planifiable : 404 hors portée, 403 visible mais non planifiable. */
  private requirePlannable(viewer: HrViewer, employeeId: string): EmployeeLean {
    const employee = viewer.byId.get(employeeId);
    if (!employee || employee.status === 'anonymized') employeeNotFound();
    if (this.plans(viewer, employeeId)) return employee;
    const visible =
      viewer.actions.has('hr.read') ||
      viewer.scope.selfEmployeeId === employeeId ||
      viewer.scope.calendarEmployeeIds.includes(employeeId);
    if (!visible) employeeNotFound();
    throw new ForbiddenException(forbidden('hr.manage', viewer.role));
  }

  private shiftViewOf(viewer: HrViewer, s: ShiftLean): ShiftView {
    const employee = viewer.byId.get(s.employeeId);
    const canPlan = this.plans(viewer, s.employeeId);
    const ownsIt = viewer.scope.selfEmployeeId === s.employeeId;
    return {
      id: String(s._id),
      employeeId: s.employeeId,
      employeeName: employee ? displayNameOf(employee) : '',
      date: s.date,
      start: s.start,
      end: s.end,
      crossesMidnight: s.crossesMidnight,
      label: s.label ?? null,
      location: s.location ?? null,
      departmentId: s.departmentId ?? null,
      workProjectId: s.workProjectId ?? null,
      status: s.status,
      publishedAt: s.publishedAt ? new Date(s.publishedAt).toISOString() : null,
      note: s.note ?? null,
      unavailability:
        s.unavailability && (canPlan || ownsIt)
          ? { comment: s.unavailability.comment, at: new Date(s.unavailability.at).toISOString() }
          : null,
      canPlan,
      revision: s.revision,
      createdAt: new Date(s.createdAt).toISOString(),
      updatedAt: new Date(s.updatedAt).toISOString(),
    };
  }

  private async requireShift(organizationId: string, id: string): Promise<ShiftLean> {
    if (typeof id !== 'string' || !isObjectIdHex(id)) shiftNotFound();
    const doc = await this.shifts
      .findOne({ _id: new Types.ObjectId(id), organizationId })
      .lean<ShiftLean>()
      .exec();
    if (!doc) shiftNotFound();
    return doc;
  }

  /** Créneau visible ET planifiable par le lecteur ; 404 sinon (403 si visible seulement). */
  private async requirePlannableShift(
    organizationId: string,
    viewer: HrViewer,
    id: string,
  ): Promise<ShiftLean> {
    const s = await this.requireShift(organizationId, id);
    if (this.plans(viewer, s.employeeId)) return s;
    if (!this.seesShift(viewer, s)) shiftNotFound();
    throw new ForbiddenException(forbidden('hr.manage', viewer.role));
  }

  // ── Constats (moteur) ────────────────────────────────────────────────────

  /** Constats de la semaine d'un collaborateur, filtrés sur un créneau. */
  private async findingsFor(
    organizationId: string,
    employeeId: string,
    shiftId: string,
    date: string,
    indicativeMaxMinutesPerWeek: number | null,
  ): Promise<ShiftFinding[]> {
    const monday = mondayOfIso(date);
    const [shifts, absences] = await Promise.all([
      this.reader.shiftsIn(organizationId, [employeeId], monday, addDaysIso(monday, 6)),
      this.reader.approvedLeaves(organizationId, [employeeId], monday, addDaysIso(monday, 7)),
    ]);
    const result = shiftConflicts(shifts.map(shiftInputOf), absences, {
      indicativeMaxMinutesPerWeek,
    });
    return result.findings.filter(
      (f) =>
        f.shiftIds.includes(shiftId) ||
        (f.code === 'SHIFT_ABOVE_INDICATIVE_LIMIT' && f.week === monday),
    );
  }

  private async checkOverlap(
    organizationId: string,
    candidate: ShiftInput,
    pending: readonly ShiftInput[] = [],
  ): Promise<string[]> {
    const around = await this.reader.shiftsIn(
      organizationId,
      [candidate.employeeId],
      addDaysIso(candidate.date, -1),
      addDaysIso(candidate.date, 1),
    );
    return shiftOverlaps(candidate, [...around.map(shiftInputOf), ...pending]);
  }

  private async checkRefs(
    organizationId: string,
    employee: EmployeeLean,
    body: { departmentId?: string | null; workProjectId?: string | null },
  ): Promise<{ departmentId: string | null; workProjectId: string | null }> {
    // Sans service saisi, celui du collaborateur : le besoin par service le retrouve.
    const departmentId =
      body.departmentId === undefined ? (employee.departmentId ?? null) : body.departmentId;
    if (body.departmentId) {
      const found = await this.departments
        .exists({ _id: new Types.ObjectId(body.departmentId), organizationId })
        .exec();
      if (!found) departmentNotFound();
    }
    const workProjectId = body.workProjectId ?? null;
    if (workProjectId !== null) {
      const project = await this.connection
        .collection('work_projects')
        .findOne(
          { _id: new Types.ObjectId(workProjectId), organizationId, archivedAt: null },
          { projection: { _id: 1 } },
        );
      if (!project) {
        throw new UnprocessableEntityException({
          code: 'SHIFT_WORK_PROJECT_UNKNOWN',
          message: 'Projet inconnu ou archivé.',
        });
      }
    }
    return { departmentId, workProjectId };
  }

  // ── Lecture ──────────────────────────────────────────────────────────────

  /** `GET /hr/shifts` — publiés selon la portée ; brouillons pour leurs planificateurs. */
  async list(
    organizationId: string,
    viewer: HrViewer,
    query: ListShiftsQuery,
  ): Promise<ShiftListView> {
    const s = await this.settings.requirePlanning(organizationId);
    rangeCheck(query.from, query.to);
    const sc = viewer.scope;
    const self = sc.selfEmployeeId ? [sc.selfEmployeeId] : [];
    if (query.scope === 'me' && self.length === 0) notLinked();
    const wanted =
      query.scope === 'me'
        ? self
        : query.scope === 'team'
          ? [...self, ...sc.teamEmployeeIds]
          : query.scope === 'department'
            ? [...self, ...sc.departmentEmployeeIds]
            : viewer.employees.map((e) => String(e._id));
    const calendar = this.calendarIds(viewer);
    const ids = [...new Set(wanted)].filter((id) => calendar.has(id) || this.plans(viewer, id));
    const docs = await this.reader.shiftsIn(organizationId, ids, query.from, query.to);
    const visible = docs.filter((d) => this.seesShift(viewer, d));
    const planned = visible.filter((d) => this.plans(viewer, d.employeeId));
    let findings: ShiftFinding[] = [];
    if (planned.length > 0) {
      const employees = [...new Set(planned.map((d) => d.employeeId))];
      const monday = mondayOfIso(query.from);
      const weekShifts = await this.reader.shiftsIn(
        organizationId,
        employees,
        monday,
        addDaysIso(mondayOfIso(query.to), 6),
      );
      const absences = await this.reader.approvedLeaves(
        organizationId,
        employees,
        monday,
        addDaysIso(mondayOfIso(query.to), 7),
      );
      const plannedIds = new Set(planned.map((d) => String(d._id)));
      findings = shiftConflicts(weekShifts.map(shiftInputOf), absences, {
        indicativeMaxMinutesPerWeek: s.planning.indicativeMaxMinutesPerWeek,
      }).findings.filter(
        (f) =>
          f.shiftIds.some((id) => plannedIds.has(id)) ||
          (f.code === 'SHIFT_ABOVE_INDICATIVE_LIMIT' && employees.includes(f.employeeId)),
      );
    }
    return {
      from: query.from,
      to: query.to,
      scope: query.scope,
      items: visible.map((d) => this.shiftViewOf(viewer, d)),
      findings,
    };
  }

  // ── Écriture ─────────────────────────────────────────────────────────────

  /** `POST /hr/shifts` — brouillon. */
  async create(
    organizationId: string,
    viewer: HrViewer,
    body: CreateShiftBody,
    actor: HrActor,
  ): Promise<ShiftWriteView> {
    const s = await this.settings.requirePlanning(organizationId);
    const employee = this.requirePlannable(viewer, body.employeeId);
    if (employee.status !== 'active') {
      conflict('EMPLOYEE_NOT_ACTIVE', 'Ce collaborateur n’est plus actif.');
    }
    const refs = await this.checkRefs(organizationId, employee, body);
    const id = new Types.ObjectId();
    const candidate = this.candidateOf(String(id), body.employeeId, body, 'draft', refs);
    const overlaps = await this.checkOverlap(organizationId, candidate);
    if (overlaps.length > 0) overlap(overlaps);
    await this.shifts.create({
      _id: id,
      organizationId,
      employeeId: body.employeeId,
      ...this.fieldsOf(body, refs),
      status: 'draft',
      publishedAt: null,
      publishedBy: null,
      unavailability: null,
      copiedFromId: null,
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.shift.created',
      targetType: 'hr_shift',
      targetId: String(id),
      metadata: { employeeId: body.employeeId, date: body.date },
    });
    return this.writeView(
      organizationId,
      viewer,
      String(id),
      s.planning.indicativeMaxMinutesPerWeek,
    );
  }

  /** `PUT /hr/shifts/:id` — un créneau publié le reste ; le collaborateur est prévenu. */
  async update(
    organizationId: string,
    viewer: HrViewer,
    id: string,
    body: UpdateShiftBody,
    actor: HrActor,
  ): Promise<ShiftWriteView> {
    const s = await this.settings.requirePlanning(organizationId);
    const current = await this.requirePlannableShift(organizationId, viewer, id);
    if (current.status === 'cancelled') conflict('SHIFT_CANCELLED', 'Ce créneau est annulé.');
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const employee = this.requirePlannable(viewer, body.employeeId);
    if (employee.status !== 'active') {
      conflict('EMPLOYEE_NOT_ACTIVE', 'Ce collaborateur n’est plus actif.');
    }
    const refs = await this.checkRefs(organizationId, employee, body);
    const candidate = this.candidateOf(id, body.employeeId, body, current.status, refs);
    const overlaps = await this.checkOverlap(organizationId, candidate);
    if (overlaps.length > 0) overlap(overlaps);
    const { expectedRevision: _ignored, ...fields } = body;
    void _ignored;
    const res = await this.shifts
      .updateOne(
        { _id: current._id, organizationId, revision: current.revision },
        {
          $set: {
            employeeId: body.employeeId,
            ...this.fieldsOf(fields, refs),
            // Un créneau déplacé ou réaffecté perd l'indisponibilité signalée.
            unavailability: null,
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(current.revision + 1);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.shift.updated',
      targetType: 'hr_shift',
      targetId: id,
      metadata: { employeeId: body.employeeId, date: body.date, status: current.status },
    });
    if (current.status === 'published') {
      const users = [current.employeeId, body.employeeId]
        .map((e) => viewer.byId.get(e)?.userId ?? null)
        .filter((u): u is string => u !== null);
      await this.notifier.shiftChanged({
        organizationId,
        actorUserId: actor.userId,
        entityId: id,
        recipients: users,
        title: 'Un créneau de votre planning a changé',
      });
    }
    return this.writeView(organizationId, viewer, id, s.planning.indicativeMaxMinutesPerWeek);
  }

  /** `POST /hr/shifts/:id/cancel`. */
  async cancel(
    organizationId: string,
    viewer: HrViewer,
    id: string,
    expectedRevision: number,
    actor: HrActor,
  ): Promise<ShiftView> {
    await this.settings.requirePlanning(organizationId);
    const current = await this.requirePlannableShift(organizationId, viewer, id);
    if (current.status === 'cancelled') conflict('SHIFT_CANCELLED', 'Ce créneau est déjà annulé.');
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    const res = await this.shifts
      .updateOne(
        { _id: current._id, organizationId, revision: current.revision },
        {
          $set: {
            status: 'cancelled',
            cancelledAt: new Date(),
            cancelledBy: actor.userId,
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(current.revision + 1);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.shift.cancelled',
      targetType: 'hr_shift',
      targetId: id,
      metadata: { employeeId: current.employeeId, date: current.date, status: current.status },
    });
    if (current.status === 'published') {
      const userId = viewer.byId.get(current.employeeId)?.userId ?? null;
      await this.notifier.shiftChanged({
        organizationId,
        actorUserId: actor.userId,
        entityId: id,
        recipients: userId ? [userId] : [],
        title: 'Un créneau de votre planning a été annulé',
      });
    }
    return this.shiftViewOf(viewer, await this.requireShift(organizationId, id));
  }

  /** `POST /hr/shifts/publish` — brouillons publiés ; déjà publiés : inchangés. */
  async publish(
    organizationId: string,
    viewer: HrViewer,
    body: PublishShiftsBody,
    actor: HrActor,
  ): Promise<{ published: number; items: ShiftView[] }> {
    await this.settings.requirePlanning(organizationId);
    const ids = [...new Set(body.ids)];
    const docs = await this.shifts
      .find({ organizationId, _id: { $in: ids.map((i) => new Types.ObjectId(i)) } })
      .lean<ShiftLean[]>()
      .exec();
    if (docs.length !== ids.length) shiftNotFound();
    for (const d of docs) {
      if (!this.plans(viewer, d.employeeId)) {
        if (!this.seesShift(viewer, d)) shiftNotFound();
        throw new ForbiddenException(forbidden('hr.manage', viewer.role));
      }
      if (d.status === 'cancelled') {
        conflict('SHIFT_CANCELLED', 'Un créneau annulé ne se publie pas.', {
          shiftId: String(d._id),
        });
      }
    }
    const drafts = docs.filter((d) => d.status === 'draft');
    const now = new Date();
    let published = 0;
    const byUser = new Map<string, string>();
    for (const d of drafts) {
      const res = await this.shifts
        .updateOne(
          { _id: d._id, organizationId, status: 'draft' },
          {
            $set: {
              status: 'published',
              publishedAt: now,
              publishedBy: actor.userId,
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
        )
        .exec();
      if (res.modifiedCount === 1) {
        published += 1;
        const userId = viewer.byId.get(d.employeeId)?.userId;
        if (userId && !byUser.has(userId)) byUser.set(userId, String(d._id));
      }
    }
    if (published > 0) {
      await this.audit.record({
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'hr.shifts.published',
        targetType: 'hr_shift',
        targetId: String(drafts[0]!._id),
        metadata: { count: published },
      });
      await this.notifier.shiftsPublished({ organizationId, actorUserId: actor.userId, byUser });
    }
    const after = await this.shifts
      .find({ organizationId, _id: { $in: ids.map((i) => new Types.ObjectId(i)) } })
      .sort({ date: 1, start: 1, _id: 1 })
      .lean<ShiftLean[]>()
      .exec();
    return { published, items: after.map((d) => this.shiftViewOf(viewer, d)) };
  }

  /** `POST /hr/shifts/copy-week` — des BROUILLONS ; un chevauchement est sauté, jamais forcé. */
  async copyWeek(
    organizationId: string,
    viewer: HrViewer,
    body: CopyShiftWeekBody,
    actor: HrActor,
  ): Promise<{
    created: ShiftView[];
    skipped: { shiftId: string; code: 'SHIFT_OVERLAP' | 'EMPLOYEE_NOT_ACTIVE' }[];
  }> {
    await this.settings.requirePlanning(organizationId);
    const issues = [];
    if (!isMonday(body.fromWeekStart)) {
      issues.push({
        path: 'fromWeekStart',
        code: 'WEEK_START_NOT_MONDAY',
        message: 'Une semaine commence un lundi.',
      });
    }
    if (!isMonday(body.toWeekStart)) {
      issues.push({
        path: 'toWeekStart',
        code: 'WEEK_START_NOT_MONDAY',
        message: 'Une semaine commence un lundi.',
      });
    }
    if (body.fromWeekStart === body.toWeekStart) {
      issues.push({
        path: 'toWeekStart',
        code: 'WEEK_COPY_SAME_WEEK',
        message: 'Copiez vers une autre semaine.',
      });
    }
    if (issues.length > 0) invalidRequestOf(issues);
    let employeeIds: string[];
    if (body.employeeIds !== undefined) {
      employeeIds = [...new Set(body.employeeIds)];
      for (const e of employeeIds) this.requirePlannable(viewer, e);
    } else {
      employeeIds = viewer.employees.map((e) => String(e._id)).filter((e) => this.plans(viewer, e));
    }
    const offset = spanDays(body.fromWeekStart, body.toWeekStart) - 1;
    const source = await this.reader.shiftsIn(
      organizationId,
      employeeIds,
      body.fromWeekStart,
      addDaysIso(body.fromWeekStart, 6),
    );
    const createdIds: string[] = [];
    const pending: ShiftInput[] = [];
    const skipped: { shiftId: string; code: 'SHIFT_OVERLAP' | 'EMPLOYEE_NOT_ACTIVE' }[] = [];
    for (const src of source) {
      const employee = viewer.byId.get(src.employeeId);
      if (!employee || employee.status !== 'active') {
        skipped.push({ shiftId: String(src._id), code: 'EMPLOYEE_NOT_ACTIVE' });
        continue;
      }
      const id = new Types.ObjectId();
      const date = addDaysIso(src.date, offset);
      const candidate: ShiftInput = {
        ...shiftInputOf(src),
        id: String(id),
        date,
        status: 'draft',
      };
      if ((await this.checkOverlap(organizationId, candidate, pending)).length > 0) {
        skipped.push({ shiftId: String(src._id), code: 'SHIFT_OVERLAP' });
        continue;
      }
      pending.push(candidate);
      await this.shifts.create({
        _id: id,
        organizationId,
        employeeId: src.employeeId,
        date,
        start: src.start,
        end: src.end,
        crossesMidnight: src.crossesMidnight,
        label: src.label ?? null,
        location: src.location ?? null,
        departmentId: src.departmentId ?? null,
        workProjectId: src.workProjectId ?? null,
        note: src.note ?? null,
        status: 'draft',
        publishedAt: null,
        publishedBy: null,
        unavailability: null,
        copiedFromId: String(src._id),
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
      createdIds.push(String(id));
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.shifts.week_copied',
      targetType: 'hr_shift',
      targetId: body.toWeekStart,
      metadata: {
        fromWeekStart: body.fromWeekStart,
        toWeekStart: body.toWeekStart,
        created: createdIds.length,
        skipped: skipped.length,
      },
    });
    const created = await this.shifts
      .find({ organizationId, _id: { $in: createdIds.map((i) => new Types.ObjectId(i)) } })
      .sort({ date: 1, start: 1, _id: 1 })
      .lean<ShiftLean[]>()
      .exec();
    return { created: created.map((d) => this.shiftViewOf(viewer, d)), skipped };
  }

  /** `POST /hr/shifts/:id/unavailability` — le collaborateur, sur SON créneau publié. */
  async signalUnavailability(
    organizationId: string,
    viewer: HrViewer,
    id: string,
    body: ShiftUnavailabilityBody,
    actor: HrActor,
  ): Promise<ShiftView> {
    await this.settings.requirePlanning(organizationId);
    const current = await this.requireShift(organizationId, id);
    if (viewer.scope.selfEmployeeId !== current.employeeId) {
      if (!this.seesShift(viewer, current)) shiftNotFound();
      throw new ForbiddenException({
        code: 'SHIFT_NOT_YOURS',
        message: 'Seul le collaborateur planifié signale son indisponibilité.',
      });
    }
    if (current.status !== 'published') {
      if (current.status === 'draft') shiftNotFound();
      conflict('SHIFT_CANCELLED', 'Ce créneau est annulé.');
    }
    const res = await this.shifts
      .updateOne(
        { _id: current._id, organizationId, status: 'published' },
        {
          $set: {
            unavailability: { comment: body.comment, at: new Date(), by: actor.userId },
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(current.revision + 1);
    const employee = viewer.byId.get(current.employeeId)!;
    await this.notifier.shiftChanged({
      organizationId,
      actorUserId: actor.userId,
      entityId: id,
      recipients: [current.publishedBy, current.createdBy].filter(
        (u): u is string => typeof u === 'string',
      ),
      title: `Indisponibilité signalée : ${displayNameOf(employee)}`,
    });
    return this.shiftViewOf(viewer, await this.requireShift(organizationId, id));
  }

  private candidateOf(
    id: string,
    employeeId: string,
    body: ShiftFields,
    status: ShiftStatus,
    refs: { departmentId: string | null },
  ): ShiftInput {
    return {
      id,
      employeeId,
      date: body.date,
      start: body.start,
      end: body.end,
      crossesMidnight: body.crossesMidnight === true,
      status,
      departmentId: refs.departmentId,
      location: body.location ?? null,
    };
  }

  private fieldsOf(
    body: ShiftFields,
    refs: { departmentId: string | null; workProjectId: string | null },
  ): Record<string, unknown> {
    return {
      date: body.date,
      start: body.start,
      end: body.end,
      crossesMidnight: body.crossesMidnight === true,
      label: body.label ?? null,
      location: body.location ?? null,
      departmentId: refs.departmentId,
      workProjectId: refs.workProjectId,
      note: body.note ?? null,
    };
  }

  private async writeView(
    organizationId: string,
    viewer: HrViewer,
    id: string,
    indicativeMaxMinutesPerWeek: number | null,
  ): Promise<ShiftWriteView> {
    const doc = await this.requireShift(organizationId, id);
    return {
      shift: this.shiftViewOf(viewer, doc),
      findings: await this.findingsFor(
        organizationId,
        doc.employeeId,
        id,
        doc.date,
        indicativeMaxMinutesPerWeek,
      ),
    };
  }

  // ── Besoins minimaux ─────────────────────────────────────────────────────

  async listNeeds(organizationId: string): Promise<{ items: StaffingNeedView[] }> {
    await this.settings.requirePlanning(organizationId);
    const docs = await this.needs
      .find({ organizationId })
      .sort({ weekday: 1, start: 1, _id: 1 })
      .lean<StaffingNeedLean[]>()
      .exec();
    return { items: docs.map(needViewOf) };
  }

  private async needFields(organizationId: string, body: StaffingNeedBody) {
    if (body.departmentId) {
      const found = await this.departments
        .exists({ _id: new Types.ObjectId(body.departmentId), organizationId })
        .exec();
      if (!found) departmentNotFound();
    }
    return {
      departmentId: body.departmentId ?? null,
      location: body.location ?? null,
      weekday: body.weekday,
      start: body.start,
      end: body.end,
      crossesMidnight: body.crossesMidnight === true,
      minStaff: body.minStaff,
      label: body.label ?? null,
    };
  }

  private async requireNeed(organizationId: string, id: string): Promise<StaffingNeedLean> {
    if (typeof id !== 'string' || !isObjectIdHex(id)) needNotFound();
    const doc = await this.needs
      .findOne({ _id: new Types.ObjectId(id), organizationId })
      .lean<StaffingNeedLean>()
      .exec();
    if (!doc) needNotFound();
    return doc;
  }

  async createNeed(
    organizationId: string,
    body: StaffingNeedBody,
    actor: HrActor,
  ): Promise<StaffingNeedView> {
    await this.settings.requirePlanning(organizationId);
    const doc = await this.needs.create({
      organizationId,
      ...(await this.needFields(organizationId, body)),
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.staffing_need.created',
      targetType: 'hr_staffing_need',
      targetId: String(doc._id),
      metadata: { weekday: body.weekday, minStaff: body.minStaff },
    });
    return needViewOf(doc.toObject() as StaffingNeedLean);
  }

  async updateNeed(
    organizationId: string,
    id: string,
    expectedRevision: number,
    body: StaffingNeedBody,
    actor: HrActor,
  ): Promise<StaffingNeedView> {
    await this.settings.requirePlanning(organizationId);
    const current = await this.requireNeed(organizationId, id);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    const res = await this.needs
      .updateOne(
        { _id: current._id, organizationId, revision: current.revision },
        {
          $set: { ...(await this.needFields(organizationId, body)), updatedBy: actor.userId },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(current.revision + 1);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.staffing_need.updated',
      targetType: 'hr_staffing_need',
      targetId: id,
      metadata: { weekday: body.weekday, minStaff: body.minStaff },
    });
    return needViewOf(await this.requireNeed(organizationId, id));
  }

  async deleteNeed(organizationId: string, id: string, actor: HrActor): Promise<void> {
    await this.settings.requirePlanning(organizationId);
    const current = await this.requireNeed(organizationId, id);
    await this.needs.deleteOne({ _id: current._id, organizationId }).exec();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.staffing_need.deleted',
      targetType: 'hr_staffing_need',
      targetId: id,
      metadata: { weekday: current.weekday, minStaff: current.minStaff },
    });
  }

  // ── Sous-effectif (moteur) ───────────────────────────────────────────────

  /**
   * `GET /hr/planning/gaps` — `hr.read` : tous les besoins ; manager : les besoins des
   * services de son équipe. Des NOMBRES par créneau, jamais un nom (§ 8).
   */
  async gaps(
    organizationId: string,
    viewer: HrViewer,
    query: PlanningGapsQuery,
  ): Promise<PlanningGapsView> {
    const s = await this.settings.requirePlanning(organizationId);
    rangeCheck(query.from, query.to);
    const seesAll = viewer.actions.has('hr.read');
    const team = viewer.scope.teamEmployeeIds;
    if (!seesAll && team.length === 0) {
      throw new ForbiddenException(forbidden('hr.read', viewer.role));
    }
    const departments = new Set(
      [...team, ...(viewer.scope.selfEmployeeId ? [viewer.scope.selfEmployeeId] : [])]
        .map((id) => viewer.byId.get(id)?.departmentId ?? null)
        .filter((d): d is string => d !== null),
    );
    const allNeeds = await this.needs.find({ organizationId }).lean<StaffingNeedLean[]>().exec();
    const needs = allNeeds.filter(
      (n) => seesAll || (n.departmentId !== null && departments.has(n.departmentId)),
    );
    const from = addDaysIso(query.from, -1);
    const to = addDaysIso(query.to, 1);
    const [shifts, absences] = await Promise.all([
      this.reader.shiftsIn(organizationId, null, from, to, ['published']),
      this.reader.approvedLeaves(organizationId, null, from, to),
    ]);
    const result = staffingGaps(
      shifts.map(shiftInputOf),
      needs.map((n) => ({
        id: String(n._id),
        departmentId: n.departmentId ?? null,
        location: n.location ?? null,
        weekday: n.weekday as Weekday,
        start: n.start,
        end: n.end,
        minStaff: n.minStaff,
      })),
      absences,
      query.from,
      query.to,
    );
    const byId = new Map(needs.map((n) => [String(n._id), n]));
    const plannedEmployees = new Set(
      shifts.map((x) => x.employeeId).filter((e) => seesAll || this.plans(viewer, e)),
    );
    const findings = shiftConflicts(
      shifts.filter((x) => plannedEmployees.has(x.employeeId)).map(shiftInputOf),
      absences.filter((a) => plannedEmployees.has(a.employeeId)),
      { indicativeMaxMinutesPerWeek: s.planning.indicativeMaxMinutesPerWeek },
    ).findings;
    return {
      version: result.version,
      from: result.from,
      to: result.to,
      gaps: result.gaps.map((g) => {
        const n = byId.get(g.needId);
        return {
          ...g,
          departmentId: n?.departmentId ?? null,
          location: n?.location ?? null,
          label: n?.label ?? null,
        };
      }),
      slotsChecked: result.slotsChecked,
      findings,
    };
  }
}
