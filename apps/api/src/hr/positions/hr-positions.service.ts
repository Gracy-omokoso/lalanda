// Référentiel des postes (ADR-0068 § 3).
//
// Isolation : chaque requête porte `organizationId` ; un poste d'une autre
// organisation est introuvable (404). Le numéro est tiré HORS transaction (trous
// admis, jamais de doublon). Pourvoir exige un poste VACANT (`409 POSITION_NOT_OPEN`,
// condition dans la mise à jour : deux remplacements simultanés ne pourvoient pas deux
// fois le même poste). La sortie libère le poste dans la transaction de la sortie.

import {
  employeeNumberKey,
  type CreatePositionBody,
  type ListPositionsQuery,
  type PositionDetailView,
  type PositionListView,
  type PositionView,
  type UpdatePositionBody,
} from '@lalanda/shared/hr';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { conflict, staleRevision } from '../../sales/sales.errors.js';
import { isObjectIdHex } from '../../sales/search.js';
import { HrDepartmentsService, type HrActor } from '../departments/hr-departments.service.js';
import {
  Employee,
  type EmployeeDocument,
  type EmployeeLean,
} from '../employees/employee.schema.js';
import { HrNumberingService } from '../numbering/hr-numbering.service.js';
import { Position, type PositionDocument, type PositionLean } from './position.schema.js';

export function positionNotFound(): never {
  throw new NotFoundException({ code: 'POSITION_NOT_FOUND', message: 'Poste introuvable.' });
}

function positionNotOpen(): never {
  conflict(
    'POSITION_NOT_OPEN',
    'Ce poste n’est pas vacant : choisissez un poste vacant ou créez un nouveau poste.',
  );
}

function nameOf(e: Pick<EmployeeLean, 'preferredName' | 'firstName' | 'lastName'>): string {
  return e.preferredName ?? `${e.firstName} ${e.lastName}`;
}

@Injectable()
export class HrPositionsService {
  constructor(
    @InjectModel(Position.name) private readonly positions: Model<PositionDocument>,
    @InjectModel(Employee.name) private readonly employees: Model<EmployeeDocument>,
    @Inject(HrDepartmentsService) private readonly departments: HrDepartmentsService,
    @Inject(HrNumberingService) private readonly numbering: HrNumberingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Lecture ──────────────────────────────────────────────────────────────

  async requireOwn(organizationId: string, positionId: string): Promise<PositionLean> {
    if (typeof positionId !== 'string' || !isObjectIdHex(positionId)) positionNotFound();
    const doc = await this.positions
      .findOne({ _id: new Types.ObjectId(positionId), organizationId })
      .lean<PositionLean>()
      .exec();
    if (!doc) positionNotFound();
    return doc;
  }

  /** Poste vacant de l'organisation (404 sinon ; 409 s'il n'est pas vacant). */
  async requireOpen(organizationId: string, positionId: string): Promise<PositionLean> {
    const doc = await this.requireOwn(organizationId, positionId);
    if (doc.status !== 'open') positionNotOpen();
    return doc;
  }

  async list(organizationId: string, query: ListPositionsQuery): Promise<PositionListView> {
    const filter: Record<string, unknown> = { organizationId };
    if (query.status === 'current') filter['status'] = { $in: ['open', 'filled'] };
    else if (query.status !== 'all') filter['status'] = query.status;
    const docs = await this.positions
      .find(filter)
      .sort({ positionNumberKey: 1, _id: 1 })
      .limit(5_000)
      .lean<PositionLean[]>()
      .exec();
    return { items: await this.views(organizationId, docs) };
  }

  async get(organizationId: string, positionId: string): Promise<PositionDetailView> {
    const doc = await this.requireOwn(organizationId, positionId);
    const [view] = await this.views(organizationId, [doc]);
    const ids = [...new Set(doc.holders.map((h) => h.employeeId))].filter(isObjectIdHex);
    const people = new Map(
      (
        await this.employees
          .find(
            { organizationId, _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
            { firstName: 1, lastName: 1, preferredName: 1, employeeNumber: 1 },
          )
          .lean<EmployeeLean[]>()
          .exec()
      ).map((e) => [String(e._id), e]),
    );
    return {
      ...view!,
      holders: doc.holders.map((h) => {
        const e = people.get(h.employeeId);
        return {
          employeeId: h.employeeId,
          displayName: e ? nameOf(e) : 'Collaborateur',
          employeeNumber: e?.employeeNumber ?? null,
          from: h.from,
          to: h.to ?? null,
        };
      }),
    };
  }

  /** Numéros des postes par identifiant (copie d'affichage des fiches). */
  async numbersOf(organizationId: string, ids: readonly string[]): Promise<Map<string, string>> {
    const valid = [...new Set(ids)].filter(isObjectIdHex);
    if (valid.length === 0) return new Map();
    const docs = await this.positions
      .find(
        { organizationId, _id: { $in: valid.map((id) => new Types.ObjectId(id)) } },
        { positionNumber: 1 },
      )
      .lean<PositionLean[]>()
      .exec();
    return new Map(docs.map((d) => [String(d._id), d.positionNumber]));
  }

  private async views(organizationId: string, docs: PositionLean[]): Promise<PositionView[]> {
    if (docs.length === 0) return [];
    const holderIds = docs
      .map((d) => d.holderEmployeeId)
      .filter((v): v is string => !!v && isObjectIdHex(v));
    const [departments, holders] = await Promise.all([
      this.departments.all(organizationId),
      holderIds.length === 0
        ? Promise.resolve([] as EmployeeLean[])
        : this.employees
            .find(
              { organizationId, _id: { $in: holderIds.map((id) => new Types.ObjectId(id)) } },
              { firstName: 1, lastName: 1, preferredName: 1 },
            )
            .lean<EmployeeLean[]>()
            .exec(),
    ]);
    const dept = new Map(departments.map((d) => [String(d._id), d.name]));
    const names = new Map(holders.map((e) => [String(e._id), nameOf(e)]));
    return docs.map((d) => ({
      id: String(d._id),
      positionNumber: d.positionNumber,
      title: d.title,
      departmentId: d.departmentId ?? null,
      departmentName: d.departmentId ? (dept.get(d.departmentId) ?? null) : null,
      status: d.status,
      holderEmployeeId: d.holderEmployeeId ?? null,
      holderName: d.holderEmployeeId ? (names.get(d.holderEmployeeId) ?? null) : null,
      revision: d.revision,
      createdAt: new Date(d.createdAt).toISOString(),
      updatedAt: new Date(d.updatedAt).toISOString(),
    }));
  }

  // ── Écriture ─────────────────────────────────────────────────────────────

  /**
   * Nouveau poste. Le numéro est tiré AVANT (hors transaction) ; la création accepte la
   * session de l'appelant (création d'un collaborateur sur « Nouveau poste »).
   */
  async insert(
    organizationId: string,
    fields: { title: string; departmentId: string | null },
    actor: HrActor,
    session?: ClientSession,
  ): Promise<string> {
    if (fields.departmentId)
      await this.departments.requireActive(organizationId, fields.departmentId);
    const positionNumber = await this.numbering.nextPositionNumber(organizationId, async (key) =>
      Boolean(await this.positions.exists({ organizationId, positionNumberKey: key }).exec()),
    );
    const [created] = await this.positions.create(
      [
        {
          organizationId,
          positionNumber,
          positionNumberKey: employeeNumberKey(positionNumber),
          title: fields.title,
          departmentId: fields.departmentId,
          status: 'open',
          holderEmployeeId: null,
          holders: [],
          revision: 1,
          createdBy: actor.userId,
          updatedBy: actor.userId,
          _schemaVersion: 1,
        },
      ],
      session ? { session } : {},
    );
    const id = String(created!._id);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.position.created',
      targetType: 'position',
      targetId: id,
      metadata: { positionNumber },
    });
    return id;
  }

  async create(
    organizationId: string,
    body: CreatePositionBody,
    actor: HrActor,
  ): Promise<PositionDetailView> {
    const id = await this.insert(
      organizationId,
      { title: body.title, departmentId: body.departmentId ?? null },
      actor,
    );
    return this.get(organizationId, id);
  }

  async update(
    organizationId: string,
    positionId: string,
    body: UpdatePositionBody,
    actor: HrActor,
  ): Promise<PositionDetailView> {
    const current = await this.requireOwn(organizationId, positionId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    if (current.status === 'deleted') {
      conflict('POSITION_DELETED', 'Ce poste est supprimé : il ne se modifie plus.');
    }
    const set: Record<string, unknown> = {};
    if (body.title !== undefined) set['title'] = body.title;
    if (body.departmentId !== undefined) {
      if (body.departmentId)
        await this.departments.requireActive(organizationId, body.departmentId);
      set['departmentId'] = body.departmentId;
    }
    const res = await this.positions
      .updateOne(
        { _id: current._id, organizationId, revision: current.revision },
        { $set: { ...set, updatedBy: actor.userId }, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1)
      staleRevision((await this.requireOwn(organizationId, positionId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.position.updated',
      targetType: 'position',
      targetId: positionId,
      metadata: { fields: Object.keys(set) },
    });
    return this.get(organizationId, positionId);
  }

  /** Suppression : seulement un poste vacant ; le numéro reste réservé. */
  async remove(
    organizationId: string,
    positionId: string,
    expectedRevision: number,
    actor: HrActor,
  ): Promise<PositionDetailView> {
    const current = await this.requireOwn(organizationId, positionId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    if (current.status === 'deleted') return this.get(organizationId, positionId);
    if (current.status !== 'open') {
      conflict(
        'POSITION_FILLED',
        'Un poste pourvu ne se supprime pas : la sortie du titulaire le libère.',
      );
    }
    const res = await this.positions
      .updateOne(
        { _id: current._id, organizationId, revision: current.revision, status: 'open' },
        { $set: { status: 'deleted', updatedBy: actor.userId }, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1)
      staleRevision((await this.requireOwn(organizationId, positionId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.position.deleted',
      targetType: 'position',
      targetId: positionId,
      metadata: { positionNumber: current.positionNumber },
    });
    return this.get(organizationId, positionId);
  }

  /** Pourvoit un poste VACANT (condition dans la mise à jour). */
  async fill(
    organizationId: string,
    positionId: string,
    employeeId: string,
    from: string,
    actorUserId: string,
    session?: ClientSession,
  ): Promise<void> {
    const res = await this.positions
      .updateOne(
        { _id: new Types.ObjectId(positionId), organizationId, status: 'open' },
        {
          $set: { status: 'filled', holderEmployeeId: employeeId, updatedBy: actorUserId },
          $push: { holders: { employeeId, from, to: null } },
          $inc: { revision: 1 },
        },
        session ? { session } : {},
      )
      .exec();
    if (res.matchedCount !== 1) positionNotOpen();
  }

  /** Reprend le poste s'il est encore vacant ; `false` sinon (aucune erreur). */
  async retake(
    organizationId: string,
    positionId: string,
    employeeId: string,
    from: string,
    actorUserId: string,
  ): Promise<boolean> {
    try {
      await this.fill(organizationId, positionId, employeeId, from, actorUserId);
      return true;
    } catch {
      return false;
    }
  }

  /** Sortie du titulaire : le poste redevient vacant, l'historique est clos. */
  async release(
    organizationId: string,
    employeeId: string,
    to: string,
    actorUserId: string,
    session?: ClientSession,
  ): Promise<void> {
    await this.positions
      .updateOne(
        { organizationId, holderEmployeeId: employeeId, status: 'filled' },
        {
          $set: {
            status: 'open',
            holderEmployeeId: null,
            updatedBy: actorUserId,
            'holders.$[h].to': to,
          },
          $inc: { revision: 1 },
        },
        {
          arrayFilters: [{ 'h.employeeId': employeeId, 'h.to': null }],
          ...(session ? { session } : {}),
        },
      )
      .exec();
  }
}
