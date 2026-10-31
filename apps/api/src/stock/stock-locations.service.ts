// Emplacements (ADR-0046 § 2.2, § 5.1). ADR-0046 — S3.
//
// À plat (décision ouverte n° 8), nom unique par organisation (clé normalisée), un seul
// emplacement par défaut (créé à l'activation, jamais archivé). Archivage refusé tant
// qu'une quantité non nulle y reste.

import type {
  CreateStockLocationBody,
  StockLocationList,
  StockLocationView,
  UpdateStockLocationBody,
} from '@lalanda/shared/stock';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { isDuplicateKey, staleRevision } from '../sales/sales.errors.js';
import {
  conflict,
  isOid,
  locationNotFound,
  normalizeKey,
  type StockActor,
} from './stock.common.js';
import { StockRefsService } from './stock-refs.service.js';
import {
  StockLevel,
  StockLocation,
  type StockLevelLean,
  type StockLocationLean,
} from './stock.schemas.js';
import { StockSettingsService } from './stock-settings.service.js';

@Injectable()
export class StockLocationsService {
  constructor(
    @InjectModel(StockLocation.name) private readonly locations: Model<StockLocationLean>,
    @InjectModel(StockLevel.name) private readonly levels: Model<StockLevelLean>,
    @Inject(StockSettingsService) private readonly settings: StockSettingsService,
    @Inject(StockRefsService) private readonly refs: StockRefsService,
  ) {}

  async requireOwn(organizationId: string, locationId: string): Promise<StockLocationLean> {
    if (!isOid(locationId)) locationNotFound();
    const doc = await this.locations
      .findOne({ _id: new Types.ObjectId(locationId), organizationId })
      .lean<StockLocationLean>()
      .exec();
    if (!doc) locationNotFound();
    return doc;
  }

  /** Emplacement ACTIF de l'organisation (mouvement, inventaire). */
  async requireActive(organizationId: string, locationId: string): Promise<StockLocationLean> {
    const doc = await this.requireOwn(organizationId, locationId);
    if (!doc.active) {
      conflict('STOCK_LOCATION_ARCHIVED', 'Cet emplacement est archivé.');
    }
    return doc;
  }

  async names(organizationId: string): Promise<Map<string, string>> {
    const docs = await this.locations
      .find({ organizationId }, { name: 1 })
      .lean<StockLocationLean[]>()
      .exec();
    return new Map(docs.map((d) => [String(d._id), d.name]));
  }

  async list(
    organizationId: string,
    active: boolean | undefined,
    actor: StockActor,
  ): Promise<StockLocationList> {
    await this.settings.ensure(organizationId, actor.userId);
    const filter: Record<string, unknown> = { organizationId };
    if (active !== undefined) filter['active'] = active;
    const docs = await this.locations
      .find(filter)
      .sort({ isDefault: -1, nameKey: 1, _id: 1 })
      .lean<StockLocationLean[]>()
      .exec();
    return { items: docs.map(viewOf) };
  }

  async create(
    organizationId: string,
    body: CreateStockLocationBody,
    actor: StockActor,
  ): Promise<StockLocationView> {
    await this.settings.ensure(organizationId, actor.userId);
    await this.checkRefs(organizationId, body);
    try {
      const [created] = await this.locations.create([
        {
          organizationId,
          name: body.name,
          nameKey: normalizeKey(body.name),
          kind: body.kind,
          workProjectId: body.workProjectId ?? null,
          address: body.address ?? null,
          responsibleUserId: body.responsibleUserId ?? null,
          isDefault: false,
          pointOfSaleIds: body.pointOfSaleIds,
          active: true,
          revision: 1,
          createdBy: actor.userId,
          updatedBy: actor.userId,
          _schemaVersion: 1,
        },
      ]);
      return viewOf(created!.toObject() as StockLocationLean);
    } catch (err) {
      throw nameConflict(err);
    }
  }

  async update(
    organizationId: string,
    locationId: string,
    body: UpdateStockLocationBody,
    actor: StockActor,
  ): Promise<StockLocationView> {
    const current = await this.requireOwn(organizationId, locationId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    await this.checkRefs(organizationId, body);
    const set: Record<string, unknown> = { updatedBy: actor.userId };
    if (body.name !== undefined) {
      set['name'] = body.name;
      set['nameKey'] = normalizeKey(body.name);
    }
    for (const key of [
      'kind',
      'workProjectId',
      'address',
      'responsibleUserId',
      'pointOfSaleIds',
    ] as const) {
      if (body[key] !== undefined) set[key] = body[key];
    }
    try {
      const updated = await this.locations
        .findOneAndUpdate(
          { _id: current._id, organizationId, revision: body.expectedRevision },
          { $set: set, $inc: { revision: 1 } },
          { new: true },
        )
        .lean<StockLocationLean>()
        .exec();
      if (!updated) staleRevision(current.revision);
      return viewOf(updated);
    } catch (err) {
      throw nameConflict(err);
    }
  }

  async archive(
    organizationId: string,
    locationId: string,
    expectedRevision: number,
    actor: StockActor,
  ): Promise<StockLocationView> {
    const current = await this.requireOwn(organizationId, locationId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    if (current.isDefault) {
      conflict('STOCK_LOCATION_IS_DEFAULT', 'L’emplacement par défaut ne s’archive pas.');
    }
    const nonEmpty = await this.levels
      .exists({ organizationId, locationId, quantity: { $ne: Types.Decimal128.fromString('0') } })
      .exec();
    if (nonEmpty) {
      conflict('STOCK_LOCATION_NOT_EMPTY', 'Une quantité non nulle reste à cet emplacement.');
    }
    const updated = await this.locations
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: expectedRevision },
        { $set: { active: false, updatedBy: actor.userId }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<StockLocationLean>()
      .exec();
    if (!updated) staleRevision(current.revision);
    return viewOf(updated);
  }

  private async checkRefs(
    organizationId: string,
    body: { workProjectId?: string | null; responsibleUserId?: string | null },
  ): Promise<void> {
    if (body.workProjectId) await this.refs.workProject(organizationId, body.workProjectId);
    if (body.responsibleUserId) await this.refs.member(organizationId, body.responsibleUserId);
  }
}

function nameConflict(err: unknown): unknown {
  if (!isDuplicateKey(err)) return err;
  try {
    conflict('STOCK_LOCATION_NAME_EXISTS', 'Un emplacement porte déjà ce nom.');
  } catch (e) {
    return e;
  }
}

export function viewOf(d: StockLocationLean): StockLocationView {
  return {
    id: String(d._id),
    name: d.name,
    kind: d.kind,
    workProjectId: d.workProjectId ?? null,
    address: d.address ?? null,
    responsibleUserId: d.responsibleUserId ?? null,
    isDefault: d.isDefault,
    pointOfSaleIds: d.pointOfSaleIds ?? [],
    active: d.active,
    revision: d.revision,
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}
