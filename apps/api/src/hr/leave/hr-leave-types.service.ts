// Types d'absence (ADR-0045 § 2.5, § 3.2). ADR-0045 — H3.
//
// À la première lecture, les quatre types de l'activation sont créés (idempotent :
// `upsert` par clé), AUCUN n'acquiert de jours (critère 21). Tout membre lit le nom,
// l'unité et la confidentialité ; la politique n'est servie qu'avec `hr.read`.
// Écriture : `hr.manage`, révision attendue, libellé unique parmi les actifs, audit.

import {
  HR_DEFAULT_LEAVE_TYPES,
  type CreateLeaveTypeBody,
  type LeaveTypeListView,
  type LeaveTypeView,
  type ListLeaveTypesQuery,
  type UpdateLeaveTypeBody,
} from '@lalanda/shared/hr';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { conflict, isDuplicateKey, staleRevision } from '../../sales/sales.errors.js';
import { isObjectIdHex, normalizeForSearch } from '../../sales/search.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import { LeaveType, type LeaveTypeDocument, type LeaveTypeLean } from './leave-type.schema.js';

export function leaveTypeNotFound(): never {
  throw new NotFoundException({
    code: 'LEAVE_TYPE_NOT_FOUND',
    message: 'Type d’absence introuvable.',
  });
}

function labelExists(): never {
  conflict('LEAVE_TYPE_LABEL_EXISTS', 'Un type d’absence actif porte déjà ce libellé.');
}

export function leaveTypeViewOf(t: LeaveTypeLean, withPolicy: boolean): LeaveTypeView {
  return {
    id: String(t._id),
    key: t.key ?? null,
    label: t.label,
    unit: t.unit,
    confidential: t.confidential,
    deductsFromBalance: t.deductsFromBalance,
    requiresDocument: t.requiresDocument,
    requiresHrApproval: t.requiresHrApproval,
    hrOnly: t.hrOnly,
    active: t.active,
    policy: withPolicy
      ? {
          accrual: t.accrual,
          proration: t.proration,
          carryOver: t.carryOver,
          allowNegative: t.allowNegative,
          countsAsAbsenteeism: t.countsAsAbsenteeism,
        }
      : null,
    revision: t.revision,
  };
}

@Injectable()
export class HrLeaveTypesService {
  constructor(
    @InjectModel(LeaveType.name) private readonly types: Model<LeaveTypeDocument>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Crée les types de l'activation s'ils manquent (idempotent, sûr en concurrence). */
  async ensureDefaults(organizationId: string): Promise<void> {
    const present = await this.types
      .countDocuments({ organizationId, key: { $in: HR_DEFAULT_LEAVE_TYPES.map((t) => t.key) } })
      .exec();
    if (present >= HR_DEFAULT_LEAVE_TYPES.length) return;
    for (const d of HR_DEFAULT_LEAVE_TYPES) {
      try {
        await this.types
          .updateOne(
            { organizationId, key: d.key },
            {
              $setOnInsert: {
                organizationId,
                key: d.key,
                label: d.label,
                labelKey: normalizeForSearch(d.label),
                unit: 'half_day',
                deductsFromBalance: d.deductsFromBalance,
                accrual: { kind: 'none' },
                proration: 'calendar_days',
                carryOver: { maxDays: null, expiresAfterMonths: null },
                allowNegative: false,
                requiresDocument: false,
                confidential: d.confidential,
                requiresHrApproval: false,
                countsAsAbsenteeism: d.countsAsAbsenteeism,
                hrOnly: d.hrOnly,
                active: true,
                revision: 1,
                createdBy: 'system',
                updatedBy: 'system',
                _schemaVersion: 1,
              },
            },
            { upsert: true },
          )
          .exec();
      } catch (err) {
        // Course entre deux premières lectures, ou libellé déjà pris par un type ajouté.
        if (!isDuplicateKey(err)) throw err;
      }
    }
  }

  async all(organizationId: string): Promise<LeaveTypeLean[]> {
    await this.ensureDefaults(organizationId);
    return this.types
      .find({ organizationId })
      .sort({ active: -1, labelKey: 1, _id: 1 })
      .lean<LeaveTypeLean[]>()
      .exec();
  }

  async list(
    organizationId: string,
    query: ListLeaveTypesQuery,
    withPolicy: boolean,
  ): Promise<LeaveTypeListView> {
    const all = await this.all(organizationId);
    const items = all.filter((t) =>
      query.active === 'all' ? true : t.active === (query.active === 'true'),
    );
    return { items: items.map((t) => leaveTypeViewOf(t, withPolicy)) };
  }

  async requireOwn(organizationId: string, typeId: string): Promise<LeaveTypeLean> {
    if (typeof typeId !== 'string' || !isObjectIdHex(typeId)) leaveTypeNotFound();
    const doc = await this.types
      .findOne({ _id: new Types.ObjectId(typeId), organizationId })
      .lean<LeaveTypeLean>()
      .exec();
    if (!doc) leaveTypeNotFound();
    return doc;
  }

  async create(
    organizationId: string,
    body: CreateLeaveTypeBody,
    actor: HrActor,
  ): Promise<LeaveTypeView> {
    await this.ensureDefaults(organizationId);
    let id: string;
    try {
      const created = await this.types.create({
        organizationId,
        key: null,
        ...body,
        labelKey: normalizeForSearch(body.label),
        active: true,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
      id = String(created._id);
    } catch (err) {
      if (isDuplicateKey(err)) labelExists();
      throw err;
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.leave_type.created',
      targetType: 'leave_type',
      targetId: id,
    });
    return leaveTypeViewOf(await this.requireOwn(organizationId, id), true);
  }

  async update(
    organizationId: string,
    typeId: string,
    body: UpdateLeaveTypeBody,
    actor: HrActor,
  ): Promise<LeaveTypeView> {
    const current = await this.requireOwn(organizationId, typeId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const { expectedRevision: _r, ...changes } = body;
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(changes)) if (v !== undefined) set[k] = v;
    if (typeof set['label'] === 'string') set['labelKey'] = normalizeForSearch(set['label']);
    try {
      const res = await this.types
        .updateOne(
          { _id: current._id, organizationId, revision: current.revision },
          { $set: { ...set, updatedBy: actor.userId }, $inc: { revision: 1 } },
        )
        .exec();
      if (res.matchedCount !== 1) {
        staleRevision((await this.requireOwn(organizationId, typeId)).revision);
      }
    } catch (err) {
      if (isDuplicateKey(err)) labelExists();
      throw err;
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.leave_type.updated',
      targetType: 'leave_type',
      targetId: typeId,
      metadata: { fields: Object.keys(changes).sort() },
    });
    return leaveTypeViewOf(await this.requireOwn(organizationId, typeId), true);
  }

  /** Archivage : un type n'est jamais effacé (des demandes peuvent l'utiliser). */
  async archive(
    organizationId: string,
    typeId: string,
    expectedRevision: number,
    actor: HrActor,
  ): Promise<LeaveTypeView> {
    const current = await this.requireOwn(organizationId, typeId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    if (current.active) {
      const res = await this.types
        .updateOne(
          { _id: current._id, organizationId, revision: current.revision },
          { $set: { active: false, updatedBy: actor.userId }, $inc: { revision: 1 } },
        )
        .exec();
      if (res.matchedCount !== 1) {
        staleRevision((await this.requireOwn(organizationId, typeId)).revision);
      }
      await this.audit.record({
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'hr.leave_type.archived',
        targetType: 'leave_type',
        targetId: typeId,
      });
    }
    return leaveTypeViewOf(await this.requireOwn(organizationId, typeId), true);
  }
}
