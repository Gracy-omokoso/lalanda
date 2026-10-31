// Articles stockés (ADR-0046 § 2.1, § 5.1). ADR-0046 — S3.
//
// Quantité totale, coût moyen et valeur : moteur `weightedAverageValuation` (rejeu du
// grand livre) ; constats : moteur `stockFindings` ; quantités par emplacement : cache
// `stock_levels`. Les valeurs ne sont servies qu'avec `canSeeStockValues`.

import { stockFindings, weightedAverageValuation } from '@lalanda/engine';
import {
  STOCKABLE_CATALOG_ITEM_TYPE,
  stockCodeKey,
  type CreateStockItemBody,
  type ListStockItemsQuery,
  type ListStockMovementsQuery,
  type StockItemPage,
  type StockItemView,
  type StockMovementPage,
  type StockMovementView,
  type UpdateStockItemBody,
} from '@lalanda/shared/stock';
import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { isDuplicateKey, staleRevision } from '../sales/sales.errors.js';
import {
  afterKeyCursor,
  badRequest,
  conflict,
  decodeKeyCursor,
  encodeKeyCursor,
  engineItem,
  engineMovement,
  escapeRegex,
  invalidCursor,
  isOid,
  itemNotFound,
  locationNotFound,
  normalizeKey,
  qty3,
  seesValues,
  stockToday,
  type StockActor,
} from './stock.common.js';
import { StockMovementsService } from './stock-movements.service.js';
import { StockRefsService } from './stock-refs.service.js';
import {
  StockItem,
  StockLevel,
  StockLocation,
  StockMovement,
  type StockItemLean,
  type StockLevelLean,
  type StockLocationLean,
  type StockMovementLean,
} from './stock.schemas.js';
import { StockSettingsService } from './stock-settings.service.js';

@Injectable()
export class StockItemsService {
  constructor(
    @InjectModel(StockItem.name) private readonly items: Model<StockItemLean>,
    @InjectModel(StockLocation.name) private readonly locations: Model<StockLocationLean>,
    @InjectModel(StockLevel.name) private readonly levels: Model<StockLevelLean>,
    @InjectModel(StockMovement.name) private readonly movementModel: Model<StockMovementLean>,
    @Inject(StockMovementsService) private readonly ledger: StockMovementsService,
    @Inject(StockSettingsService) private readonly settings: StockSettingsService,
    @Inject(StockRefsService) private readonly refs: StockRefsService,
  ) {}

  // ── Lecture ──────────────────────────────────────────────────────────────

  async requireOwn(organizationId: string, itemId: string): Promise<StockItemLean> {
    if (!isOid(itemId)) itemNotFound();
    const doc = await this.items
      .findOne({ _id: new Types.ObjectId(itemId), organizationId })
      .lean<StockItemLean>()
      .exec();
    if (!doc) itemNotFound();
    return doc;
  }

  /** Articles de l'organisation par identifiant ; un identifiant étranger → 404. */
  async requireMany(
    organizationId: string,
    itemIds: readonly string[],
  ): Promise<Map<string, StockItemLean>> {
    const unique = [...new Set(itemIds)];
    if (unique.some((id) => !isOid(id))) itemNotFound();
    const docs = await this.items
      .find({ organizationId, _id: { $in: unique.map((id) => new Types.ObjectId(id)) } })
      .lean<StockItemLean[]>()
      .exec();
    if (docs.length !== unique.length) itemNotFound();
    return new Map(docs.map((d) => [String(d._id), d]));
  }

  async list(
    organizationId: string,
    query: ListStockItemsQuery,
    actor: StockActor,
  ): Promise<StockItemPage> {
    await this.settings.ensure(organizationId, actor.userId);
    const and: Record<string, unknown>[] = [{ organizationId }];
    and.push({ active: query.active ?? true });
    if (query.kind) and.push({ kind: query.kind });
    const term = normalizeKey(query.q ?? '');
    if (term !== '') and.push({ searchKey: { $regex: escapeRegex(term) } });
    if (query.cursor !== undefined) {
      const cursor = decodeKeyCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(afterKeyCursor('sortName', cursor, 1));
    }
    const docs = await this.items
      .find({ $and: and })
      .sort({ sortName: 1, _id: 1 })
      .limit(query.limit + 1)
      .lean<StockItemLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    const views = await this.views(organizationId, page, actor, false);
    return {
      items: views,
      nextCursor:
        docs.length > query.limit && last ? encodeKeyCursor(last.sortName, String(last._id)) : null,
      valuesHidden: !seesValues(actor),
    };
  }

  async get(organizationId: string, itemId: string, actor: StockActor): Promise<StockItemView> {
    const doc = await this.requireOwn(organizationId, itemId);
    return (await this.views(organizationId, [doc], actor, true))[0]!;
  }

  async movements(
    organizationId: string,
    itemId: string,
    query: ListStockMovementsQuery,
    actor: StockActor,
  ): Promise<StockMovementPage> {
    const item = await this.requireOwn(organizationId, itemId);
    const and: Record<string, unknown>[] = [{ organizationId, itemId }];
    if (query.locationId) and.push({ locationId: query.locationId });
    if (query.from) and.push({ occurredOn: { $gte: query.from } });
    if (query.to) and.push({ occurredOn: { $lte: query.to } });
    if (query.cursor !== undefined) {
      const cursor = decodeKeyCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(afterKeyCursor('occurredOn', cursor, -1));
    }
    const docs = await this.movementModel
      .find({ $and: and })
      .sort({ occurredOn: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<StockMovementLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    const visible = seesValues(actor);
    const values = new Map<string, string | null>();
    if (visible && page.length > 0) {
      const all = await this.ledger.ofItems(organizationId, [itemId]);
      const valuation = weightedAverageValuation(all.map(engineMovement), engineItem(item));
      for (const s of valuation.steps) values.set(s.movementId, s.entryValue ?? s.exitCost);
    }
    return {
      items: page.map((m) => movementView(m, visible, values.get(String(m._id)) ?? null)),
      nextCursor:
        docs.length > query.limit && last
          ? encodeKeyCursor(last.occurredOn, String(last._id))
          : null,
      valuesHidden: !visible,
    };
  }

  // ── Écriture ─────────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    body: CreateStockItemBody,
    actor: StockActor,
  ): Promise<StockItemView> {
    const settings = await this.settings.ensure(organizationId, actor.userId);
    await this.checkRefs(organizationId, body, null);
    const code = body.code ?? null;
    try {
      const [created] = await this.items.create([
        {
          organizationId,
          code,
          codeKey: stockCodeKey(code),
          name: body.name,
          sortName: normalizeKey(body.name),
          searchKey: normalizeKey(`${code ?? ''} ${body.name}`),
          description: body.description ?? null,
          kind: body.kind,
          catalogItemId: body.catalogItemId ?? null,
          unit: body.unit,
          unitConversions: body.unitConversions,
          costCurrency: body.costCurrency ?? settings.defaultCostCurrency,
          tracked: body.tracked,
          discreteUnit: body.discreteUnit,
          defaultLocationId: body.defaultLocationId ?? null,
          reorder: reorderDoc(body.reorder),
          preferredSupplierId: body.preferredSupplierId ?? null,
          active: true,
          revision: 1,
          createdBy: actor.userId,
          updatedBy: actor.userId,
          _schemaVersion: 1,
        },
      ]);
      return this.get(organizationId, String(created!._id), actor);
    } catch (err) {
      throw uniqueConflict(err);
    }
  }

  async update(
    organizationId: string,
    itemId: string,
    body: UpdateStockItemBody,
    actor: StockActor,
  ): Promise<StockItemView> {
    const current = await this.requireOwn(organizationId, itemId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    await this.checkRefs(organizationId, body, current);
    if (body.unit !== undefined && body.unit !== current.unit) {
      if (await this.ledger.hasMovements(organizationId, itemId)) {
        conflict('STOCK_ITEM_UNIT_LOCKED', 'L’unité ne change plus après le premier mouvement.');
      }
    }
    if (body.costCurrency !== undefined && body.costCurrency !== current.costCurrency) {
      if (await this.ledger.hasMovements(organizationId, itemId, { costStatus: 'valued' })) {
        conflict(
          'STOCK_ITEM_CURRENCY_LOCKED',
          'La devise de coût ne change plus après le premier mouvement valorisé.',
        );
      }
    }
    const set: Record<string, unknown> = { updatedBy: actor.userId };
    const name = body.name ?? current.name;
    const code = body.code !== undefined ? body.code : current.code;
    if (body.code !== undefined) {
      set['code'] = body.code;
      set['codeKey'] = stockCodeKey(body.code);
    }
    if (body.name !== undefined) {
      set['name'] = body.name;
      set['sortName'] = normalizeKey(body.name);
    }
    set['searchKey'] = normalizeKey(`${code ?? ''} ${name}`);
    for (const key of [
      'description',
      'kind',
      'catalogItemId',
      'unit',
      'unitConversions',
      'costCurrency',
      'tracked',
      'discreteUnit',
      'defaultLocationId',
      'preferredSupplierId',
    ] as const) {
      if (body[key] !== undefined) set[key] = body[key];
    }
    if (body.reorder !== undefined) set['reorder'] = reorderDoc(body.reorder);
    try {
      const updated = await this.items
        .findOneAndUpdate(
          { _id: current._id, organizationId, revision: body.expectedRevision },
          { $set: set, $inc: { revision: 1 } },
          { new: true },
        )
        .lean<StockItemLean>()
        .exec();
      if (!updated) staleRevision(current.revision);
      return (await this.views(organizationId, [updated], actor, true))[0]!;
    } catch (err) {
      throw uniqueConflict(err);
    }
  }

  async setActive(
    organizationId: string,
    itemId: string,
    active: boolean,
    expectedRevision: number,
    actor: StockActor,
  ): Promise<StockItemView> {
    const current = await this.requireOwn(organizationId, itemId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    if (!active) {
      const nonEmpty = await this.levels
        .exists({ organizationId, itemId, quantity: { $ne: Types.Decimal128.fromString('0') } })
        .exec();
      if (nonEmpty) {
        conflict(
          'STOCK_ITEM_NOT_EMPTY',
          'Un article dont la quantité n’est pas nulle reste actif.',
        );
      }
    }
    const updated = await this.items
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: expectedRevision },
        { $set: { active, updatedBy: actor.userId }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<StockItemLean>()
      .exec();
    if (!updated) staleRevision(current.revision);
    return (await this.views(organizationId, [updated], actor, true))[0]!;
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  private async checkRefs(
    organizationId: string,
    body: Partial<CreateStockItemBody>,
    current: StockItemLean | null,
  ): Promise<void> {
    const unit = body.unit ?? current?.unit;
    if (
      body.unitConversions?.some((c) => normalizeKey(c.unit) === normalizeKey(unit ?? '')) === true
    ) {
      badRequest(
        'UNIT_CONVERSION_IS_STOCK_UNIT',
        'L’unité de stock ne figure pas dans les conversions.',
      );
    }
    if (body.catalogItemId) {
      const catalog = await this.refs.catalogItem(organizationId, body.catalogItemId);
      if (catalog.itemType !== STOCKABLE_CATALOG_ITEM_TYPE) {
        throw unprocessable(
          'CATALOG_ITEM_NOT_STOCKABLE',
          'Seul un article de type bien (BIE) se lie à un article stocké.',
        );
      }
    }
    if (body.preferredSupplierId) {
      await this.refs.supplier(organizationId, body.preferredSupplierId);
    }
    const locationIds = [body.defaultLocationId, body.reorder?.locationId].filter(
      (id): id is string => typeof id === 'string',
    );
    for (const id of locationIds) {
      const found = await this.locations.exists({ _id: new Types.ObjectId(id), organizationId });
      if (!found) locationNotFound();
    }
  }

  /** Vues d'articles : niveaux du cache, quantité et valeurs du moteur. */
  async views(
    organizationId: string,
    docs: readonly StockItemLean[],
    actor: StockActor,
    withFindings: boolean,
  ): Promise<StockItemView[]> {
    if (docs.length === 0) return [];
    const ids = docs.map((d) => String(d._id));
    const [levels, movements, locations, settings] = await Promise.all([
      this.levels
        .find({ organizationId, itemId: { $in: ids } })
        .lean<StockLevelLean[]>()
        .exec(),
      this.ledger.ofItems(organizationId, ids),
      this.locations.find({ organizationId }, { name: 1 }).lean<StockLocationLean[]>().exec(),
      withFindings ? this.settings.ensure(organizationId) : Promise.resolve(null),
    ]);
    const names = new Map(locations.map((l) => [String(l._id), l.name]));
    const engineMovements = movements.map(engineMovement);
    const visible = seesValues(actor);
    return docs.map((d) => {
      const id = String(d._id);
      const item = engineItem(d);
      const own = engineMovements.filter((m) => m.itemId === id);
      const valuation = weightedAverageValuation(own, item);
      const findings =
        withFindings && settings
          ? stockFindings({
              items: [item],
              movements: own,
              today: stockToday(),
              dormantDays: settings.dormantDays ?? null,
            }).findings
          : [];
      return {
        id,
        code: d.code ?? null,
        name: d.name,
        description: d.description ?? null,
        kind: d.kind,
        catalogItemId: d.catalogItemId ?? null,
        unit: d.unit,
        unitConversions: d.unitConversions.map((c) => ({ unit: c.unit, factor: c.factor })),
        costCurrency: d.costCurrency,
        tracked: d.tracked,
        discreteUnit: d.discreteUnit ?? false,
        defaultLocationId: d.defaultLocationId ?? null,
        reorder: d.reorder
          ? {
              minQuantity: d.reorder.minQuantity,
              targetQuantity: d.reorder.targetQuantity ?? null,
              locationId: d.reorder.locationId ?? null,
            }
          : null,
        preferredSupplierId: d.preferredSupplierId ?? null,
        active: d.active,
        hasMovements: own.length > 0,
        quantity: valuation.quantity,
        levels: levels
          .filter((l) => l.itemId === id)
          .map((l) => ({
            locationId: l.locationId,
            locationName: names.get(l.locationId) ?? null,
            quantity: qty3(l.quantity.toString()),
          })),
        averageUnitCost: visible ? valuation.averageUnitCost : null,
        value: visible ? valuation.value : null,
        valuationComplete: visible ? valuation.complete : null,
        findings: findings.map((f) => ({
          code: f.code,
          locationId: f.locationId,
          movementId: f.movementId,
          details: visible ? f.details : hideValueDetails(f.details),
        })),
        valuesHidden: !visible,
        revision: d.revision,
        createdBy: d.createdBy,
        createdAt: new Date(d.createdAt).toISOString(),
        updatedAt: new Date(d.updatedAt).toISOString(),
      };
    });
  }
}

/** Détails d'un constat sans coût (motif des valeurs masquées, § 5). */
function hideValueDetails(details: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(details)) if (!/cost|value/i.test(k)) out[k] = v;
  return out;
}

function reorderDoc(
  r: CreateStockItemBody['reorder'],
): { minQuantity: string; targetQuantity: string | null; locationId: string | null } | null {
  if (r === undefined || r === null) return null;
  return {
    minQuantity: r.minQuantity,
    targetQuantity: r.targetQuantity ?? null,
    locationId: r.locationId,
  };
}

function uniqueConflict(err: unknown): unknown {
  if (!isDuplicateKey(err)) return err;
  const pattern = (err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};
  try {
    if ('catalogItemId' in pattern) {
      conflict('CATALOG_ITEM_ALREADY_STOCKED', 'Cet article du catalogue est déjà stocké.');
    }
    conflict('STOCK_ITEM_CODE_EXISTS', 'Un article porte déjà ce code.');
  } catch (e) {
    return e;
  }
}

function unprocessable(code: string, message: string): Error {
  // 422, au format des erreurs métier.
  return new UnprocessableEntityException({ code, message });
}

export function movementView(
  m: StockMovementLean,
  visible: boolean,
  value: string | null,
): StockMovementView {
  return {
    id: String(m._id),
    itemId: m.itemId,
    locationId: m.locationId,
    kind: m.kind,
    quantity: m.quantity,
    occurredOn: m.occurredOn,
    costStatus: m.costStatus,
    unitCost: visible ? m.unitCost : null,
    value: visible ? value : null,
    source: m.source,
    sourceKey: m.sourceKey,
    workProjectId: m.workProjectId ?? null,
    transferId: m.transferId ?? null,
    reason: m.reason ?? null,
    reversalOf: m.reversalOf ?? null,
    recordedAt: new Date(m.createdAt).toISOString(),
    createdBy: m.createdBy,
    revision: m.revision,
  };
}
