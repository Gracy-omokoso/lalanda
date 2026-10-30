// Services de l'organisation (ADR-0045 § 2.3). ADR-0045 — H2.
//
// Isolation : chaque requête porte `organizationId` ; un service, un parent ou un
// responsable d'une autre organisation est introuvable (404). Cycles et profondeur :
// moteur `departmentCycle` (`409 DEPARTMENT_CYCLE`, `DEPARTMENT_TOO_DEEP`). Archivage
// refusé tant qu'un collaborateur actif ou un service actif y est rattaché.

import { departmentCycle } from '@lalanda/engine';
import type {
  CreateDepartmentBody,
  DepartmentListView,
  DepartmentView,
  ListDepartmentsQuery,
  UpdateDepartmentBody,
} from '@lalanda/shared/hr';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { conflict, isDuplicateKey, staleRevision } from '../../sales/sales.errors.js';
import { isObjectIdHex, normalizeForSearch } from '../../sales/search.js';
import {
  Employee,
  type EmployeeDocument,
  type EmployeeLean,
} from '../employees/employee.schema.js';
import { departmentNotFound, employeeNotFound } from '../scope/hr-errors.js';
import { Department, type DepartmentDocument, type DepartmentLean } from './department.schema.js';

export interface HrActor {
  userId: string;
  role: string;
}

function viewOf(d: DepartmentLean, activeEmployees: number): DepartmentView {
  return {
    id: String(d._id),
    name: d.name,
    parentId: d.parentId ?? null,
    headEmployeeId: d.headEmployeeId ?? null,
    active: d.active,
    activeEmployees,
    revision: d.revision,
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}

@Injectable()
export class HrDepartmentsService {
  constructor(
    @InjectModel(Department.name) private readonly departments: Model<DepartmentDocument>,
    @InjectModel(Employee.name) private readonly employees: Model<EmployeeDocument>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, query: ListDepartmentsQuery): Promise<DepartmentListView> {
    const filter: Record<string, unknown> = { organizationId };
    if (query.active !== 'all') filter['active'] = query.active === 'true';
    const docs = await this.departments
      .find(filter)
      .sort({ nameKey: 1, _id: 1 })
      .lean<DepartmentLean[]>()
      .exec();
    const counts = await this.activeCounts(organizationId);
    return { items: docs.map((d) => viewOf(d, counts.get(String(d._id)) ?? 0)) };
  }

  /** Tous les services de l'organisation (organigramme). */
  async all(organizationId: string): Promise<DepartmentLean[]> {
    return this.departments.find({ organizationId }).lean<DepartmentLean[]>().exec();
  }

  async get(organizationId: string, departmentId: string): Promise<DepartmentView> {
    const doc = await this.requireOwn(organizationId, departmentId);
    const counts = await this.activeCounts(organizationId);
    return viewOf(doc, counts.get(departmentId) ?? 0);
  }

  /** Service de l'organisation, ou 404. */
  async requireOwn(organizationId: string, departmentId: string): Promise<DepartmentLean> {
    if (typeof departmentId !== 'string' || !isObjectIdHex(departmentId)) departmentNotFound();
    const doc = await this.departments
      .findOne({ _id: new Types.ObjectId(departmentId), organizationId })
      .lean<DepartmentLean>()
      .exec();
    if (!doc) departmentNotFound();
    return doc;
  }

  /** Service ACTIF de l'organisation : 404 s'il n'existe pas, 409 s'il est archivé. */
  async requireActive(organizationId: string, departmentId: string): Promise<DepartmentLean> {
    const doc = await this.requireOwn(organizationId, departmentId);
    if (!doc.active) conflict('DEPARTMENT_ARCHIVED', 'Ce service est archivé.');
    return doc;
  }

  async create(
    organizationId: string,
    body: CreateDepartmentBody,
    actor: HrActor,
  ): Promise<DepartmentView> {
    const parentId = body.parentId ?? null;
    await this.checkTree(organizationId, null, parentId);
    const headEmployeeId = await this.checkHead(organizationId, body.headEmployeeId ?? null);
    let created: DepartmentDocument;
    try {
      created = await this.departments.create({
        organizationId,
        name: body.name,
        nameKey: normalizeForSearch(body.name),
        parentId,
        headEmployeeId,
        active: true,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
    } catch (err) {
      if (isDuplicateKey(err)) nameExists();
      throw err;
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.department.created',
      targetType: 'hr_department',
      targetId: String(created._id),
    });
    return this.get(organizationId, String(created._id));
  }

  async update(
    organizationId: string,
    departmentId: string,
    body: UpdateDepartmentBody,
    actor: HrActor,
  ): Promise<DepartmentView> {
    const current = await this.requireOwn(organizationId, departmentId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    if (!current.active) conflict('DEPARTMENT_ARCHIVED', 'Ce service est archivé.');
    const set: Record<string, unknown> = { updatedBy: actor.userId };
    if (body.name !== undefined) {
      set['name'] = body.name;
      set['nameKey'] = normalizeForSearch(body.name);
    }
    if (body.parentId !== undefined) {
      await this.checkTree(organizationId, departmentId, body.parentId);
      set['parentId'] = body.parentId;
    }
    if (body.headEmployeeId !== undefined) {
      set['headEmployeeId'] = await this.checkHead(organizationId, body.headEmployeeId);
    }
    try {
      const res = await this.departments
        .updateOne(
          { _id: current._id, organizationId, revision: current.revision },
          { $set: set, $inc: { revision: 1 } },
        )
        .exec();
      if (res.matchedCount !== 1) {
        staleRevision((await this.requireOwn(organizationId, departmentId)).revision);
      }
    } catch (err) {
      if (isDuplicateKey(err)) nameExists();
      throw err;
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.department.updated',
      targetType: 'hr_department',
      targetId: departmentId,
    });
    return this.get(organizationId, departmentId);
  }

  async archive(
    organizationId: string,
    departmentId: string,
    expectedRevision: number,
    actor: HrActor,
  ): Promise<DepartmentView> {
    const current = await this.requireOwn(organizationId, departmentId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    if (!current.active) return this.get(organizationId, departmentId);
    const [employees, children] = await Promise.all([
      this.employees.countDocuments({ organizationId, departmentId, status: 'active' }).exec(),
      this.departments.countDocuments({ organizationId, parentId: departmentId, active: true }),
    ]);
    if (employees > 0 || children > 0) {
      conflict(
        'DEPARTMENT_IN_USE',
        'Des collaborateurs actifs ou des services actifs sont rattachés à ce service : déplacez-les d’abord.',
        { activeEmployees: employees, activeChildren: children },
      );
    }
    const res = await this.departments
      .updateOne(
        { _id: current._id, organizationId, revision: current.revision },
        { $set: { active: false, updatedBy: actor.userId }, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1) {
      staleRevision((await this.requireOwn(organizationId, departmentId)).revision);
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.department.archived',
      targetType: 'hr_department',
      targetId: departmentId,
    });
    return this.get(organizationId, departmentId);
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  /** Parent actif de l'organisation, sans cycle ni profondeur excessive (moteur). */
  private async checkTree(
    organizationId: string,
    departmentId: string | null,
    parentId: string | null,
  ): Promise<void> {
    if (parentId !== null) await this.requireActive(organizationId, parentId);
    const all = await this.departments
      .find({ organizationId }, { parentId: 1 })
      .lean<{ _id: Types.ObjectId; parentId: string | null }[]>()
      .exec();
    const verdict = departmentCycle(
      all.map((d) => ({ id: String(d._id), parentId: d.parentId ?? null })),
      departmentId,
      parentId,
    );
    if (verdict.cycle) {
      conflict(
        'DEPARTMENT_CYCLE',
        'Ce service ne peut pas être rattaché à lui-même ni à l’un de ses sous-services.',
      );
    }
    if (verdict.tooDeep) {
      conflict('DEPARTMENT_TOO_DEEP', 'L’arbre des services ne dépasse pas huit niveaux.', {
        depth: verdict.depth,
      });
    }
  }

  /** Responsable affiché : collaborateur actif de l'organisation, ou `null`. */
  private async checkHead(
    organizationId: string,
    headEmployeeId: string | null,
  ): Promise<string | null> {
    if (headEmployeeId === null) return null;
    if (!isObjectIdHex(headEmployeeId)) employeeNotFound();
    const e = await this.employees
      .findOne({ _id: new Types.ObjectId(headEmployeeId), organizationId }, { status: 1 })
      .lean<Pick<EmployeeLean, '_id' | 'status'>>()
      .exec();
    if (!e) employeeNotFound();
    if (e.status !== 'active') {
      conflict('EMPLOYEE_NOT_ACTIVE', 'Ce collaborateur n’est plus actif.');
    }
    return headEmployeeId;
  }

  private async activeCounts(organizationId: string): Promise<Map<string, number>> {
    const rows = await this.employees
      .aggregate<{ _id: string; n: number }>([
        { $match: { organizationId, status: 'active', departmentId: { $type: 'string' } } },
        { $group: { _id: '$departmentId', n: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((r) => [r._id, r.n]));
  }
}

function nameExists(): never {
  conflict('DEPARTMENT_NAME_EXISTS', 'Un autre service actif porte déjà ce nom.');
}
