// Dossiers collaborateurs (ADR-0045 § 2.1, § 3.1). ADR-0045 — H2.
//
// Isolation : chaque requête porte `organizationId` ; une fiche, un service, un
// manager ou un compte d'une autre organisation est introuvable (404), y compris par
// identifiant forgé dans un corps. Écriture concurrente : `expectedRevision` →
// `409 STALE_REVISION`. Cycles hiérarchiques : moteur `reportingCycle`. Statut dérivé
// (« à venir », « en période d'essai ») : moteur `employeeStatusOf`.
//
// Aucune donnée sensible ici : la sortie ne pose que la date et la catégorie (le
// motif détaillé est une section chiffrée), l'anonymisation efface le dossier sensible
// par `HrPrivateService`.

import { employeeStatusOf, orgChart, reportingCycle } from '@lalanda/engine';
import {
  HR_JOB_TITLE_TO_COMPLETE,
  employeeNumberKey,
  type CreateEmployeeBody,
  type EmployeeExitResult,
  type EmployeePage,
  type EmployeeView,
  type EmployeesFromMembersResult,
  type ExitEmployeeBody,
  type HrMeView,
  type HrSettingsView,
  type HrTeamView,
  type ListEmployeesQuery,
  type OrgChartView,
  type UpdateEmployeeBody,
} from '@lalanda/shared/hr';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { Membership, type MembershipDocument } from '../../organizations/membership.schema.js';
import {
  conflict,
  invalidCursor,
  invalidRequestOf,
  isDuplicateKey,
  staleRevision,
} from '../../sales/sales.errors.js';
import {
  afterCursor,
  decodeCursor,
  encodeCursor,
  escapeRegex,
  isObjectIdHex,
  normalizeForSearch,
  searchKeyOf,
} from '../../sales/search.js';
import { HrDepartmentsService, type HrActor } from '../departments/hr-departments.service.js';
import { leaveTypeNotFound } from '../leave/hr-leave-types.service.js';
import { LeaveType, type LeaveTypeDocument } from '../leave/leave-type.schema.js';
import { HrPrivateService } from '../private/hr-private.service.js';
import {
  employeeNotFound,
  employeeNumberExists,
  hrToday,
  inHrTransaction,
  managerCycle,
  userAlreadyLinked,
  userNotMember,
} from '../scope/hr-errors.js';
import { engineEmployeeOf, type HrViewer } from '../scope/hr-scope.service.js';
import { HrSettingsService } from '../settings/hr-settings.service.js';
import { Employee, type EmployeeDocument, type EmployeeLean } from './employee.schema.js';
import {
  HR_EMPLOYEE_LIFECYCLE,
  noHrEmployeeLifecycle,
  type HrEmployeeLifecycle,
} from './hr-employee-lifecycle.port.js';

export function displayNameOf(e: Pick<EmployeeLean, 'preferredName' | 'firstName' | 'lastName'>) {
  return e.preferredName ?? `${e.firstName} ${e.lastName}`;
}

/** Fiche non sensible ; `withNotes: false` hors détenteurs de `hr.read`. */
export function employeeViewOf(
  e: EmployeeLean,
  today: string,
  options: { withNotes: boolean },
): EmployeeView {
  return {
    id: String(e._id),
    firstName: e.firstName,
    lastName: e.lastName,
    preferredName: e.preferredName ?? null,
    displayName: displayNameOf(e),
    employeeNumber: e.employeeNumber ?? null,
    userId: e.userId ?? null,
    workEmail: e.workEmail ?? null,
    workPhone: e.workPhone ?? null,
    jobTitle: e.jobTitle,
    departmentId: e.departmentId ?? null,
    // ADR-0045 — H3 : copies d'affichage posées par `withNames`.
    departmentName: null,
    managerEmployeeId: e.managerEmployeeId ?? null,
    managerName: null,
    contractType: e.contractType,
    contractTypeLabel: null,
    startDate: e.startDate,
    probationEndDate: e.probationEndDate ?? null,
    contractEndDate: e.contractEndDate ?? null,
    endDate: e.endDate ?? null,
    exitCategory: e.exitCategory ?? null,
    status: e.status,
    derivedStatus: employeeStatusOf(engineEmployeeOf(e), today),
    workPattern: e.workPattern ?? null,
    workLocation: e.workLocation ?? null,
    leavePolicyOverrides: options.withNotes
      ? ((e.leavePolicyOverrides as EmployeeView['leavePolicyOverrides']) ?? null)
      : null,
    notes: options.withNotes ? (e.notes ?? null) : null,
    revision: e.revision,
    createdAt: new Date(e.createdAt).toISOString(),
    updatedAt: new Date(e.updatedAt).toISOString(),
  };
}

function keysOf(e: {
  firstName: string;
  lastName: string;
  preferredName: string | null;
  employeeNumber: string | null;
  jobTitle: string;
  workEmail: string | null;
}) {
  return {
    sortName: normalizeForSearch(`${e.lastName} ${e.firstName}`),
    searchKey: searchKeyOf([
      e.firstName,
      e.lastName,
      e.preferredName,
      e.employeeNumber,
      e.jobTitle,
      e.workEmail,
    ]),
    employeeNumberKey: e.employeeNumber ? employeeNumberKey(e.employeeNumber) : null,
  };
}

/** Champs fusionnés soumis aux règles de cohérence (fiche entière). */
interface EmployeeShape {
  contractType: string;
  startDate: string;
  probationEndDate: string | null;
  contractEndDate: string | null;
}

@Injectable()
export class HrEmployeesService {
  private readonly lifecycle: HrEmployeeLifecycle;

  constructor(
    @InjectModel(Employee.name) private readonly employees: Model<EmployeeDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(HrSettingsService) private readonly settings: HrSettingsService,
    @Inject(HrDepartmentsService) private readonly departments: HrDepartmentsService,
    @Inject(HrPrivateService) private readonly privates: HrPrivateService,
    @Inject(HR_EMPLOYEE_LIFECYCLE) lifecycle: HrEmployeeLifecycle | null,
    // ADR-0045 — H3 : exceptions d'acquisition (`leavePolicyOverrides`).
    @InjectModel(LeaveType.name) private readonly leaveTypes: Model<LeaveTypeDocument>,
  ) {
    this.lifecycle = lifecycle ?? noHrEmployeeLifecycle;
  }

  // ── Lecture ──────────────────────────────────────────────────────────────

  async list(organizationId: string, query: ListEmployeesQuery): Promise<EmployeePage> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.status !== 'all') and.push({ status: query.status });
    if (query.departmentId !== undefined) and.push({ departmentId: query.departmentId });
    if (query.managerId !== undefined) and.push({ managerEmployeeId: query.managerId });
    if (query.q !== undefined) {
      const term = normalizeForSearch(query.q);
      if (term !== '') and.push({ searchKey: { $regex: escapeRegex(term) } });
    }
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(afterCursor(cursor));
    }
    const docs = await this.employees
      .find({ $and: and })
      .sort({ sortName: 1, _id: 1 })
      .limit(query.limit + 1)
      .lean<EmployeeLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    const today = hrToday();
    return {
      items: await this.withNames(
        organizationId,
        page.map((d) => employeeViewOf(d, today, { withNotes: true })),
      ),
      nextCursor:
        docs.length > query.limit && last ? encodeCursor(last.sortName, String(last._id)) : null,
    };
  }

  /** Fiche de l'organisation, ou 404. */
  async requireOwn(organizationId: string, employeeId: string): Promise<EmployeeLean> {
    if (typeof employeeId !== 'string' || !isObjectIdHex(employeeId)) employeeNotFound();
    const doc = await this.employees
      .findOne({ _id: new Types.ObjectId(employeeId), organizationId })
      .lean<EmployeeLean>()
      .exec();
    if (!doc) employeeNotFound();
    return doc;
  }

  view(e: EmployeeLean, withNotes: boolean): EmployeeView {
    return employeeViewOf(e, hrToday(), { withNotes });
  }

  /**
   * ADR-0045 — H3 : noms du service, du manager et du type de contrat, lus à la
   * requête (copies d'affichage, jamais stockées).
   */
  async withNames<T extends EmployeeView>(organizationId: string, views: T[]): Promise<T[]> {
    if (views.length === 0) return views;
    const managerIds = [
      ...new Set(views.map((v) => v.managerEmployeeId).filter((v): v is string => !!v)),
    ].filter(isObjectIdHex);
    const [departments, settings, managers] = await Promise.all([
      this.departments.all(organizationId),
      this.settings.view(organizationId),
      managerIds.length === 0
        ? Promise.resolve([] as EmployeeLean[])
        : this.employees
            .find(
              { organizationId, _id: { $in: managerIds.map((id) => new Types.ObjectId(id)) } },
              { firstName: 1, lastName: 1, preferredName: 1 },
            )
            .lean<EmployeeLean[]>()
            .exec(),
    ]);
    const dept = new Map(departments.map((d) => [String(d._id), d.name]));
    const types = new Map(settings.contractTypes.map((t) => [t.key, t.label]));
    const names = new Map(managers.map((m) => [String(m._id), displayNameOf(m)]));
    for (const v of views) {
      v.departmentName = v.departmentId ? (dept.get(v.departmentId) ?? null) : null;
      v.managerName = v.managerEmployeeId ? (names.get(v.managerEmployeeId) ?? null) : null;
      v.contractTypeLabel = types.get(v.contractType) ?? null;
    }
    return views;
  }

  private async named(organizationId: string, view: EmployeeView): Promise<EmployeeView> {
    return (await this.withNames(organizationId, [view]))[0]!;
  }

  async me(viewer: HrViewer): Promise<HrMeView> {
    const selfId = viewer.scope.selfEmployeeId;
    const self = selfId ? viewer.byId.get(selfId) : undefined;
    return {
      employee: self
        ? await this.named(self.organizationId, this.view(self, viewer.actions.has('hr.read')))
        : null,
      private: self ? await this.privates.summary(self.organizationId, String(self._id)) : null,
      isManager: viewer.scope.isManager,
      canApprove: viewer.scope.isManager || viewer.scope.holdsLeaveApprove,
      directReportIds: viewer.scope.directReportIds,
      teamEmployeeIds: viewer.scope.teamEmployeeIds,
      orgChartVisible: viewer.scope.orgChartVisible,
      // ADR-0045 — H3 : posés par `HrLeaveService.completeMe`.
      balances: [],
      requests: [],
    };
  }

  async team(organizationId: string, viewer: HrViewer): Promise<HrTeamView> {
    const today = hrToday();
    const direct = new Set(viewer.scope.directReportIds);
    // ADR-0045 — H3 : noms du service et du manager (copies d'affichage).
    const dept = new Map(
      (await this.departments.all(organizationId)).map((d) => [String(d._id), d.name]),
    );
    const nameOf = (id: string | null | undefined) => {
      const e = id ? viewer.byId.get(id) : undefined;
      return e ? displayNameOf(e) : null;
    };
    const items = viewer.scope.teamEmployeeIds
      .map((id) => viewer.byId.get(id))
      .filter((e): e is EmployeeLean => e !== undefined)
      .sort((a, b) => (a.sortName < b.sortName ? -1 : a.sortName > b.sortName ? 1 : 0))
      .map((e) => ({
        id: String(e._id),
        displayName: displayNameOf(e),
        jobTitle: e.jobTitle,
        departmentId: e.departmentId ?? null,
        departmentName: e.departmentId ? (dept.get(e.departmentId) ?? null) : null,
        managerEmployeeId: e.managerEmployeeId ?? null,
        managerName: nameOf(e.managerEmployeeId),
        isDirect: direct.has(String(e._id)),
        derivedStatus: employeeStatusOf(engineEmployeeOf(e), today),
        workEmail: e.workEmail ?? null,
        workPhone: e.workPhone ?? null,
        // ADR-0045 — H3 : posés par `HrLeaveService.completeTeam`.
        balances: [],
        absences: [],
      }));
    return { items };
  }

  /** Organigramme : `hr.read`, ou membre relié à une fiche si `orgChartVisibility = members`. */
  async orgChart(
    organizationId: string,
    viewer: HrViewer,
    view: 'departments' | 'reporting',
  ): Promise<OrgChartView> {
    if (!viewer.scope.orgChartVisible) {
      throw new ForbiddenException({
        code: 'HR_ORG_CHART_HIDDEN',
        message: 'L’organigramme est réservé aux ressources humaines dans cette organisation.',
      });
    }
    const departments = await this.departments.all(organizationId);
    const chart = orgChart(
      departments.map((d) => ({
        id: String(d._id),
        name: d.name,
        parentId: d.parentId ?? null,
        headEmployeeId: d.headEmployeeId ?? null,
        active: d.active,
      })),
      viewer.employees.map(engineEmployeeOf),
      view,
    );
    const people: OrgChartView['people'] = {};
    for (const e of viewer.employees) {
      if (e.status !== 'active') continue;
      people[String(e._id)] = {
        displayName: displayNameOf(e),
        jobTitle: e.jobTitle,
        departmentId: e.departmentId ?? null,
        managerEmployeeId: e.managerEmployeeId ?? null,
      };
    }
    const names: OrgChartView['departments'] = {};
    for (const d of departments) if (d.active) names[String(d._id)] = { name: d.name };
    return { ...chart, people, departments: names } as OrgChartView;
  }

  // ── Écriture ─────────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    body: CreateEmployeeBody,
    actor: HrActor,
  ): Promise<EmployeeView> {
    const settings = await this.settings.view(organizationId);
    const fields = {
      firstName: body.firstName,
      lastName: body.lastName,
      preferredName: body.preferredName ?? null,
      employeeNumber: body.employeeNumber ?? null,
      userId: body.userId ?? null,
      workEmail: body.workEmail ?? null,
      workPhone: body.workPhone ?? null,
      jobTitle: body.jobTitle,
      departmentId: body.departmentId ?? null,
      managerEmployeeId: body.managerEmployeeId ?? null,
      contractType: body.contractType,
      startDate: body.startDate,
      probationEndDate: body.probationEndDate ?? null,
      contractEndDate: body.contractEndDate ?? null,
      workPattern: body.workPattern ?? null,
      workLocation: body.workLocation ?? null,
      notes: body.notes ?? null,
    };
    this.checkShape(fields, settings);
    await this.checkRefs(organizationId, null, fields);
    const id = await this.insert(organizationId, fields, actor);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.employee.created',
      targetType: 'employee',
      targetId: id,
    });
    return this.named(organizationId, this.view(await this.requireOwn(organizationId, id), true));
  }

  async update(
    organizationId: string,
    employeeId: string,
    body: UpdateEmployeeBody,
    actor: HrActor,
  ): Promise<EmployeeView> {
    const current = await this.requireOwn(organizationId, employeeId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    if (current.status === 'anonymized') anonymized();
    const { expectedRevision: _r, ...changes } = body;
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(changes)) if (v !== undefined) set[k] = v;
    const merged = { ...current, ...set } as EmployeeLean;
    // La cohérence n'est vérifiée que si l'un de ses champs change : une fiche ancienne
    // reste modifiable même si un réglage a changé depuis.
    if (
      ['contractType', 'startDate', 'probationEndDate', 'contractEndDate'].some((k) => k in set)
    ) {
      this.checkShape(merged, await this.settings.view(organizationId), current.contractType);
    }
    await this.checkRefs(organizationId, employeeId, {
      userId: 'userId' in set ? merged.userId : undefined,
      departmentId: 'departmentId' in set ? merged.departmentId : undefined,
      managerEmployeeId: 'managerEmployeeId' in set ? merged.managerEmployeeId : undefined,
    });
    // ADR-0045 — H3 : une exception d'acquisition ne vise qu'un type de l'organisation.
    if (set['leavePolicyOverrides']) {
      const typeIds = Object.keys(set['leavePolicyOverrides'] as Record<string, unknown>);
      const found = await this.leaveTypes
        .countDocuments({
          organizationId,
          _id: { $in: typeIds.map((id) => new Types.ObjectId(id)) },
        })
        .exec();
      if (found !== typeIds.length) leaveTypeNotFound();
    }
    Object.assign(set, keysOf(merged), { updatedBy: actor.userId });
    try {
      const res = await this.employees
        .updateOne(
          { _id: current._id, organizationId, revision: current.revision },
          { $set: set, $inc: { revision: 1 } },
        )
        .exec();
      if (res.matchedCount !== 1) {
        staleRevision((await this.requireOwn(organizationId, employeeId)).revision);
      }
    } catch (err) {
      this.duplicate(err);
      throw err;
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.employee.updated',
      targetType: 'employee',
      targetId: employeeId,
      metadata: { fields: Object.keys(changes).filter((k) => k !== 'notes') },
    });
    return this.named(
      organizationId,
      this.view(await this.requireOwn(organizationId, employeeId), true),
    );
  }

  /** Une fiche par membre choisi ; nom tiré du compte, poste à compléter. */
  async fromMembers(
    organizationId: string,
    userIds: readonly string[],
    actor: HrActor,
  ): Promise<EmployeesFromMembersResult> {
    for (const userId of userIds) await this.checkUser(organizationId, null, userId);
    const settings = await this.settings.view(organizationId);
    const contractType =
      settings.contractTypes.find((t) => t.active && !t.hasEndDate)?.key ??
      settings.contractTypes.find((t) => t.active)!.key;
    const names = await this.accountNames(userIds);
    const today = hrToday();
    const created: string[] = [];
    for (const userId of userIds) {
      const { firstName, lastName } = names.get(userId) ?? {
        firstName: 'Collaborateur',
        lastName: 'À compléter',
      };
      created.push(
        await this.insert(
          organizationId,
          {
            firstName,
            lastName,
            preferredName: null,
            employeeNumber: null,
            userId,
            workEmail: null,
            workPhone: null,
            jobTitle: HR_JOB_TITLE_TO_COMPLETE,
            departmentId: null,
            managerEmployeeId: null,
            contractType,
            startDate: today,
            probationEndDate: null,
            contractEndDate: null,
            workPattern: null,
            workLocation: null,
            notes: null,
          },
          actor,
        ),
      );
    }
    for (const id of created) {
      await this.audit.record({
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'hr.employee.created',
        targetType: 'employee',
        targetId: id,
        metadata: { fromMember: true },
      });
    }
    const docs = await this.employees
      .find({ organizationId, _id: { $in: created.map((id) => new Types.ObjectId(id)) } })
      .sort({ sortName: 1, _id: 1 })
      .lean<EmployeeLean[]>()
      .exec();
    return {
      items: await this.withNames(
        organizationId,
        docs.map((d) => this.view(d, true)),
      ),
    };
  }

  /** Sortie : date et catégorie ; l'accès à Lalanda n'est PAS retiré (décision ouverte n° 13). */
  async exit(
    organizationId: string,
    employeeId: string,
    body: ExitEmployeeBody,
    actor: HrActor,
  ): Promise<EmployeeExitResult> {
    const current = await this.requireOwn(organizationId, employeeId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    if (current.status === 'anonymized') anonymized();
    if (current.status === 'exited') {
      conflict('EMPLOYEE_ALREADY_EXITED', 'La sortie de ce collaborateur est déjà enregistrée.');
    }
    if (body.endDate < current.startDate) {
      invalidRequestOf([
        {
          path: 'endDate',
          code: 'DATE_BEFORE_START',
          message: 'La date de sortie précède la date d’entrée.',
        },
      ]);
    }
    await inHrTransaction(this.connection, async (session) => {
      const res = await this.employees
        .updateOne(
          { _id: current._id, organizationId, revision: current.revision },
          {
            $set: {
              status: 'exited',
              endDate: body.endDate,
              exitCategory: body.exitCategory,
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(current.revision + 1);
      await this.lifecycle.onExit({
        organizationId,
        employeeId,
        actorUserId: actor.userId,
        endDate: body.endDate,
        session,
      });
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'hr.employee.exited',
          targetType: 'employee',
          targetId: employeeId,
          metadata: { endDate: body.endDate, exitCategory: body.exitCategory },
        },
        { session },
      );
    });
    return {
      employee: await this.named(
        organizationId,
        this.view(await this.requireOwn(organizationId, employeeId), true),
      ),
      offboardingSuggested: true,
    };
  }

  /** Annule une sortie dont la date est future. */
  async reinstate(
    organizationId: string,
    employeeId: string,
    expectedRevision: number,
    actor: HrActor,
  ): Promise<EmployeeView> {
    const current = await this.requireOwn(organizationId, employeeId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    if (current.status !== 'exited') {
      conflict('EMPLOYEE_NOT_EXITED', 'Aucune sortie à annuler pour ce collaborateur.');
    }
    if (current.endDate !== null && current.endDate < hrToday()) {
      conflict('EMPLOYEE_EXIT_PAST', 'Cette sortie a déjà eu lieu : elle ne s’annule plus.');
    }
    if (current.userId) await this.checkUser(organizationId, employeeId, current.userId, false);
    const res = await this.employees
      .updateOne(
        { _id: current._id, organizationId, revision: current.revision },
        {
          $set: { status: 'active', endDate: null, exitCategory: null, updatedBy: actor.userId },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) {
      staleRevision((await this.requireOwn(organizationId, employeeId)).revision);
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.employee.reinstated',
      targetType: 'employee',
      targetId: employeeId,
    });
    return this.named(
      organizationId,
      this.view(await this.requireOwn(organizationId, employeeId), true),
    );
  }

  /**
   * Anonymisation irréversible d'un collaborateur sorti (sortie passée) : noms
   * remplacés, coordonnées et notes effacées, `userId` délié, dossier sensible
   * effacé ; demandes, grand livre et chiffres des rapports conservés.
   */
  async anonymize(
    organizationId: string,
    employeeId: string,
    expectedRevision: number,
    actor: HrActor,
  ): Promise<EmployeeView> {
    const current = await this.requireOwn(organizationId, employeeId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    if (current.status === 'anonymized') anonymized();
    if (employeeStatusOf(engineEmployeeOf(current), hrToday()) !== 'exited') {
      conflict(
        'EMPLOYEE_NOT_EXITED',
        'Seul un collaborateur dont la sortie a eu lieu peut être anonymisé.',
      );
    }
    const n =
      (await this.employees.countDocuments({ organizationId, status: 'anonymized' }).exec()) + 1;
    const anon = {
      firstName: 'Ancien collaborateur',
      lastName: `n° ${n}`,
      preferredName: `Ancien collaborateur n° ${n}`,
      employeeNumber: null,
      jobTitle: current.jobTitle,
      workEmail: null,
    };
    await inHrTransaction(this.connection, async (session) => {
      const res = await this.employees
        .updateOne(
          { _id: current._id, organizationId, revision: current.revision },
          {
            $set: {
              ...anon,
              ...keysOf(anon),
              userId: null,
              workPhone: null,
              workLocation: null,
              notes: null,
              leavePolicyOverrides: null,
              status: 'anonymized',
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(current.revision + 1);
      await this.privates.erase(organizationId, employeeId, session);
      await this.lifecycle.onAnonymize({
        organizationId,
        employeeId,
        actorUserId: actor.userId,
        session,
      });
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'hr.employee.anonymized',
          targetType: 'employee',
          targetId: employeeId,
        },
        { session },
      );
    });
    return this.named(
      organizationId,
      this.view(await this.requireOwn(organizationId, employeeId), true),
    );
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  private async insert(
    organizationId: string,
    fields: Omit<
      EmployeeLean,
      | '_id'
      | 'organizationId'
      | 'sortName'
      | 'searchKey'
      | 'employeeNumberKey'
      | 'endDate'
      | 'exitCategory'
      | 'status'
      | 'leavePolicyOverrides'
      | 'revision'
      | 'createdBy'
      | 'updatedBy'
      | '_schemaVersion'
      | 'createdAt'
      | 'updatedAt'
    >,
    actor: HrActor,
  ): Promise<string> {
    try {
      const created = await this.employees.create({
        organizationId,
        ...fields,
        ...keysOf(fields),
        endDate: null,
        exitCategory: null,
        status: 'active',
        leavePolicyOverrides: null,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
      return String(created._id);
    } catch (err) {
      this.duplicate(err);
      throw err;
    }
  }

  private duplicate(err: unknown): void {
    if (!isDuplicateKey(err)) return;
    const pattern = (err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};
    if ('userId' in pattern) userAlreadyLinked();
    employeeNumberExists();
  }

  /** Type de contrat connu et actif ; date de fin si le type l'exige ; dates ≥ entrée. */
  private checkShape(e: EmployeeShape, settings: HrSettingsView, previousType?: string): void {
    const type = settings.contractTypes.find((t) => t.key === e.contractType);
    const issues: { path: string; code: string; message: string }[] = [];
    if (!type || (!type.active && e.contractType !== previousType)) {
      issues.push({
        path: 'contractType',
        code: 'CONTRACT_TYPE_UNKNOWN',
        message: 'Type de contrat inconnu de l’organisation.',
      });
    } else if (type.hasEndDate && !e.contractEndDate) {
      issues.push({
        path: 'contractEndDate',
        code: 'CONTRACT_END_DATE_REQUIRED',
        message: `Une date de fin est attendue pour un contrat « ${type.label} ».`,
      });
    }
    for (const path of ['probationEndDate', 'contractEndDate'] as const) {
      const v = e[path];
      if (v && v < e.startDate) {
        issues.push({
          path,
          code: 'DATE_BEFORE_START',
          message: 'Cette date précède la date d’entrée.',
        });
      }
    }
    if (issues.length > 0) invalidRequestOf(issues);
  }

  /** `undefined` : champ inchangé, non vérifié. */
  private async checkRefs(
    organizationId: string,
    employeeId: string | null,
    refs: {
      userId?: string | null;
      departmentId?: string | null;
      managerEmployeeId?: string | null;
    },
  ): Promise<void> {
    if (refs.userId) await this.checkUser(organizationId, employeeId, refs.userId);
    if (refs.departmentId) await this.departments.requireActive(organizationId, refs.departmentId);
    if (refs.managerEmployeeId) {
      const manager = await this.requireOwn(organizationId, refs.managerEmployeeId);
      if (employeeId !== null) {
        const all = await this.employees
          .find({ organizationId }, { managerEmployeeId: 1 })
          .lean<{ _id: Types.ObjectId; managerEmployeeId: string | null }[]>()
          .exec();
        const verdict = reportingCycle(
          all.map((e) => ({ id: String(e._id), managerEmployeeId: e.managerEmployeeId ?? null })),
          employeeId,
          refs.managerEmployeeId,
        );
        if (verdict.cycle) managerCycle();
      }
      if (manager.status !== 'active') {
        conflict('EMPLOYEE_NOT_ACTIVE', 'Ce manager n’est plus un collaborateur actif.');
      }
    }
  }

  /** Compte membre de l'organisation (404 sinon) et relié à aucune autre fiche (409). */
  private async checkUser(
    organizationId: string,
    employeeId: string | null,
    userId: string,
    requireMember = true,
  ): Promise<void> {
    if (requireMember) {
      const member = await this.memberships.exists({ organizationId, userId }).exec();
      if (!member) userNotMember();
    }
    const other = await this.employees
      .findOne(
        {
          organizationId,
          userId,
          ...(employeeId ? { _id: { $ne: new Types.ObjectId(employeeId) } } : {}),
        },
        { _id: 1 },
      )
      .lean<{ _id: Types.ObjectId }>()
      .exec();
    if (other) userAlreadyLinked(String(other._id));
  }

  /** Prénom et nom tirés du nom du compte (dernier mot = nom). */
  private async accountNames(
    userIds: readonly string[],
  ): Promise<Map<string, { firstName: string; lastName: string }>> {
    const out = new Map<string, { firstName: string; lastName: string }>();
    const ids = userIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (ids.length === 0) return out;
    const docs = await this.connection
      .collection('user')
      .find({ _id: { $in: ids } }, { projection: { name: 1 } })
      .toArray();
    for (const d of docs) {
      const name = typeof d['name'] === 'string' ? d['name'].trim().replace(/\s+/g, ' ') : '';
      if (name === '') continue;
      const words = name.split(' ');
      const lastName = words.length > 1 ? words.pop()! : 'À compléter';
      out.set(String(d['_id']), {
        firstName: words.join(' ').slice(0, 100),
        lastName: lastName.slice(0, 100),
      });
    }
    return out;
  }
}

function anonymized(): never {
  conflict('EMPLOYEE_ANONYMIZED', 'Ce dossier a été anonymisé : il ne se modifie plus.');
}
