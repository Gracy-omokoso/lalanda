// File « À traiter » (ADR-0046 § 2.6, § 5.1). ADR-0046 — S3.
//
// ── Point d'extension du lot S4 ─────────────────────────────────────────────
// `open()` ouvre une ligne (idempotent par `sourceKey`) avec la PROPOSITION du mouvement
// à écrire ; `resolvedItemFor()` rend l'article retenu pour un `itemRef` d'une commande
// (rattachement mémorisé pour les réceptions suivantes). Le reste — liste, résolution,
// classement — appartient à S3.
//
// Résoudre exige `stock.move`, sauf les motifs de COÛT (`pending_cost`, `cost_differs`) :
// `stock.manage`. Le mouvement écrit reprend `movementSourceKey` de la proposition : un
// rattrapage rejoué par S4 trouve le mouvement et n'écrit rien de plus. Conversion
// d'unité et coût d'entrée : moteur (`toStockQuantity`, `entryUnitCost`) — aucun taux.

import { entryUnitCost, toStockQuantity } from '@lalanda/engine';
import {
  STOCK_PENDING_REASONS_REQUIRING_MANAGE,
  canonicalStockDecimal,
  type DismissStockPendingBody,
  type ListStockPendingQuery,
  type OpenStockPendingLineInput,
  type ResolveStockPendingBody,
  type StockPendingLineView,
  type StockPendingPage,
} from '@lalanda/shared/stock';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';

import { isDuplicateKey, staleRevision } from '../sales/sales.errors.js';
import {
  afterKeyCursor,
  badRequest,
  conflict,
  decodeKeyCursor,
  encodeKeyCursor,
  engineItem,
  inTransaction,
  invalidCursor,
  isOid,
  negate,
  notFound,
  requireAction,
  seesValues,
  type StockActor,
} from './stock.common.js';
import { StockItemsService } from './stock-items.service.js';
import { StockLocationsService } from './stock-locations.service.js';
import { StockMovementsService, type StockMovementDraft } from './stock-movements.service.js';
import {
  StockItem,
  StockPendingLine,
  type StockItemLean,
  type StockPendingLineLean,
} from './stock.schemas.js';
import { StockSettingsService } from './stock-settings.service.js';
import { assertMovable } from './stock-vouchers.service.js';

/** Motifs dont la résolution ÉCRIT un mouvement neuf. */
const WRITES_MOVEMENT = new Set([
  'unknown_item',
  'unknown_unit',
  'sale_return_proposed',
  // ADR-0046 — S4 : sortie de vente proposée (`salesIssueMode = proposed`).
  'sale_issue_proposed',
]);

@Injectable()
export class StockPendingService {
  constructor(
    @InjectModel(StockPendingLine.name) private readonly lines: Model<StockPendingLineLean>,
    @InjectModel(StockItem.name) private readonly itemModel: Model<StockItemLean>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(StockMovementsService) private readonly ledger: StockMovementsService,
    @Inject(StockItemsService) private readonly items: StockItemsService,
    @Inject(StockLocationsService) private readonly locations: StockLocationsService,
    @Inject(StockSettingsService) private readonly settings: StockSettingsService,
  ) {}

  // ── Port du lot S4 ───────────────────────────────────────────────────────

  /** Ouvre une ligne à traiter ; rejouer la même `sourceKey` ne crée rien (`created: false`). */
  async open(
    organizationId: string,
    input: OpenStockPendingLineInput,
    actorUserId = 'system',
    session?: ClientSession,
  ): Promise<{ id: string; created: boolean }> {
    try {
      const res = await this.lines.updateOne(
        { organizationId, sourceKey: input.sourceKey },
        {
          $setOnInsert: {
            organizationId,
            reason: input.reason,
            status: 'open',
            sourceKey: input.sourceKey,
            proposal: input.proposal,
            movementId: null,
            resolvedItemId: null,
            closure: null,
            revision: 1,
            createdBy: actorUserId,
            updatedBy: actorUserId,
            _schemaVersion: 1,
          },
        },
        { upsert: true, ...(session ? { session } : {}) },
      );
      const doc = await this.lines
        .findOne(
          { organizationId, sourceKey: input.sourceKey },
          { _id: 1 },
          session ? { session } : {},
        )
        .lean<{ _id: Types.ObjectId }>()
        .exec();
      return { id: String(doc!._id), created: res.upsertedCount === 1 };
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      const doc = await this.lines
        .findOne({ organizationId, sourceKey: input.sourceKey }, { _id: 1 })
        .lean<{ _id: Types.ObjectId }>()
        .exec();
      return { id: String(doc!._id), created: false };
    }
  }

  /** Article rattaché à un `itemRef` d'une commande par une résolution précédente. */
  async resolvedItemFor(
    organizationId: string,
    orderId: string,
    itemRef: string | null,
  ): Promise<string | null> {
    const doc = await this.lines
      .findOne(
        {
          organizationId,
          reason: 'unknown_item',
          status: 'resolved',
          'proposal.orderId': orderId,
          'proposal.itemRef': itemRef,
          resolvedItemId: { $type: 'string' },
        },
        { resolvedItemId: 1 },
      )
      .sort({ updatedAt: -1 })
      .lean<{ resolvedItemId: string }>()
      .exec();
    return doc?.resolvedItemId ?? null;
  }

  // ── Lecture ──────────────────────────────────────────────────────────────

  async list(
    organizationId: string,
    query: ListStockPendingQuery,
    actor: StockActor,
  ): Promise<StockPendingPage> {
    const and: Record<string, unknown>[] = [{ organizationId, status: query.status ?? 'open' }];
    if (query.reason) and.push({ reason: query.reason });
    if (query.cursor !== undefined) {
      const cursor = decodeKeyCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(afterKeyCursor('sourceKey', cursor, 1));
    }
    const docs = await this.lines
      .find({ $and: and })
      .sort({ sourceKey: 1, _id: 1 })
      .limit(query.limit + 1)
      .lean<StockPendingLineLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((d) => viewOf(d, seesValues(actor))),
      nextCursor:
        docs.length > query.limit && last
          ? encodeKeyCursor(last.sourceKey, String(last._id))
          : null,
    };
  }

  private async requireOwn(organizationId: string, id: string): Promise<StockPendingLineLean> {
    if (!isOid(id)) pendingNotFound();
    const doc = await this.lines
      .findOne({ _id: new Types.ObjectId(id), organizationId })
      .lean<StockPendingLineLean>()
      .exec();
    if (!doc) pendingNotFound();
    return doc;
  }

  // ── Résolution ───────────────────────────────────────────────────────────

  async resolve(
    organizationId: string,
    id: string,
    body: ResolveStockPendingBody,
    actor: StockActor,
  ): Promise<StockPendingLineView> {
    const line = await this.requireOwn(organizationId, id);
    requireAction(
      actor,
      STOCK_PENDING_REASONS_REQUIRING_MANAGE.includes(line.reason) ? 'stock.manage' : 'stock.move',
    );
    if (line.status !== 'open') conflict('STOCK_PENDING_CLOSED', 'Cette ligne est déjà traitée.');
    if (line.revision !== body.expectedRevision) staleRevision(line.revision);
    const p = line.proposal;

    if (!WRITES_MOVEMENT.has(line.reason)) {
      // `pending_cost`, `cost_differs` : correction du coût de l'entrée visée.
      if (body.unitCost === undefined) {
        badRequest('FIELD_REQUIRED', 'Coût unitaire obligatoire, dans la devise de l’article.', {
          field: 'unitCost',
        });
      }
      if (!p.movementId) conflict('STOCK_PENDING_NO_MOVEMENT', 'Aucun mouvement à corriger.');
      const movement = await this.ledger.findOwn(organizationId, p.movementId);
      const doc = await inTransaction(this.connection, async (session) => {
        await this.ledger.correctCost(
          organizationId,
          p.movementId!,
          {
            unitCost: body.unitCost!,
            reason: body.note ?? `Ligne à traiter ${line.reason}`,
            expectedRevision: movement.revision,
          },
          actor,
          session,
        );
        return this.lines
          .findOne({ _id: line._id }, null, { session })
          .lean<StockPendingLineLean>()
          .exec();
      });
      return viewOf(doc!, seesValues(actor));
    }

    // Article : proposé, ou choisi (`unknown_item`).
    const itemId = line.reason === 'unknown_item' ? body.itemId : (p.itemId ?? undefined);
    if (!itemId) badRequest('FIELD_REQUIRED', 'Article obligatoire.', { field: 'itemId' });
    let item = await this.items.requireOwn(organizationId, itemId);
    assertMovable(item);
    // ADR-0046 — S4 : une ligne d'origine sans unité est exprimée en unité de stock.
    const lineUnit = p.unit === '' ? item.unit : p.unit;

    // Unité : facteur ajouté à l'article, ou quantité saisie en unité de stock.
    let quantity: string;
    if (line.reason === 'sale_return_proposed') {
      if (body.quantity === undefined) {
        badRequest('FIELD_REQUIRED', 'Quantité revenue obligatoire.', { field: 'quantity' });
      }
      if (p.maxQuantity !== null && greater(body.quantity, p.maxQuantity)) {
        badRequest(
          'STOCK_RETURN_EXCEEDS_CREDIT',
          'La quantité revenue dépasse la quantité créditée.',
          {
            maxQuantity: p.maxQuantity,
          },
        );
      }
      quantity = body.quantity;
    } else if (body.quantity !== undefined) {
      quantity = body.quantity;
    } else {
      if (body.factor !== undefined)
        item = await this.addConversion(organizationId, item, lineUnit, body.factor, actor);
      const converted = toStockQuantity(p.quantity, lineUnit, engineItem(item));
      if (!converted.ok) {
        conflict(
          'STOCK_UNIT_UNKNOWN',
          'Unité inconnue de l’article : saisissez un facteur ou la quantité.',
          {
            unit: lineUnit,
          },
        );
      }
      quantity = converted.quantity;
    }

    const settings = await this.settings.ensure(organizationId);
    const locationId =
      body.locationId ?? p.locationId ?? item.defaultLocationId ?? settings.defaultLocationId;
    await this.locations.requireActive(organizationId, locationId);

    // Coût : entrée d'achat au prix de la ligne (moteur), sinon au coût moyen courant.
    let unitCost: string | null = null;
    let costStatus: 'valued' | 'pending_cost' | 'not_applicable' = 'not_applicable';
    const entry = p.movementKind !== 'sale_issue';
    if (entry && p.unitPrice !== null && p.currency !== null) {
      const cost = entryUnitCost(
        {
          unitPrice: p.unitPrice,
          discountPercent: p.discountPercent,
          unit: lineUnit,
          currency: p.currency,
        },
        engineItem(item),
      );
      if (cost.status === 'valued' && body.quantity === undefined) {
        unitCost = cost.unitCost;
        costStatus = 'valued';
      } else if (cost.status === 'pending_cost' || body.quantity !== undefined) {
        costStatus = 'pending_cost';
      }
    }
    const draft: StockMovementDraft = {
      itemId: String(item._id),
      locationId,
      kind: p.movementKind,
      quantity: entry ? quantity : negate(quantity),
      occurredOn: p.occurredOn,
      unitCost,
      costStatus,
      source: { kind: 'pending', pendingLineId: id },
      sourceKey: p.movementSourceKey,
      workProjectId: p.workProjectId,
    };
    await this.ledger.ensureLevels(organizationId, [draft]);
    const doc = await inTransaction(this.connection, async (session) => {
      const result = await this.ledger.record(organizationId, [draft], {
        mode: 'observed',
        actorUserId: actor.userId,
        session,
      });
      const movementId = result.written[0] ? String(result.written[0]._id) : null;
      const updated = await this.lines
        .findOneAndUpdate(
          { _id: line._id, organizationId, status: 'open', revision: body.expectedRevision },
          {
            $set: {
              status: 'resolved',
              movementId,
              resolvedItemId: String(item._id),
              closure: { at: new Date(), by: actor.userId, note: body.note ?? null },
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { new: true, session },
        )
        .lean<StockPendingLineLean>()
        .exec();
      if (!updated) staleRevision(line.revision);
      if (movementId !== null && costStatus === 'pending_cost') {
        await this.open(
          organizationId,
          {
            reason: 'pending_cost',
            sourceKey: `pending_cost:${movementId}`,
            proposal: { ...p, itemId: String(item._id), movementId, locationId },
          },
          actor.userId,
          session,
        );
      }
      return updated;
    });
    return viewOf(doc, seesValues(actor));
  }

  async dismiss(
    organizationId: string,
    id: string,
    body: DismissStockPendingBody,
    actor: StockActor,
  ): Promise<StockPendingLineView> {
    const line = await this.requireOwn(organizationId, id);
    requireAction(
      actor,
      STOCK_PENDING_REASONS_REQUIRING_MANAGE.includes(line.reason) ? 'stock.manage' : 'stock.move',
    );
    if (line.status !== 'open') conflict('STOCK_PENDING_CLOSED', 'Cette ligne est déjà traitée.');
    if (line.revision !== body.expectedRevision) staleRevision(line.revision);
    const updated = await this.lines
      .findOneAndUpdate(
        { _id: line._id, organizationId, status: 'open', revision: body.expectedRevision },
        {
          $set: {
            status: 'dismissed',
            closure: { at: new Date(), by: actor.userId, note: body.reason },
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<StockPendingLineLean>()
      .exec();
    if (!updated) staleRevision(line.revision);
    return viewOf(updated, seesValues(actor));
  }

  private async addConversion(
    organizationId: string,
    item: StockItemLean,
    unit: string,
    factor: string,
    actor: StockActor,
  ): Promise<StockItemLean> {
    if (item.unitConversions.length >= 5) {
      conflict('UNIT_CONVERSIONS_FULL', 'Cet article porte déjà cinq conversions.');
    }
    const updated = await this.itemModel
      .findOneAndUpdate(
        { _id: item._id, organizationId, revision: item.revision },
        {
          $push: { unitConversions: { unit, factor } },
          $set: { updatedBy: actor.userId },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<StockItemLean>()
      .exec();
    if (!updated) staleRevision(item.revision);
    return updated;
  }
}

function pendingNotFound(): never {
  notFound('STOCK_PENDING_NOT_FOUND', 'Ligne à traiter introuvable.');
}

/** a > b pour deux quantités décimales (comparaison de forme, sans arithmétique). */
function greater(a: string, b: string): boolean {
  const [x, y] = [canonicalStockDecimal(a, 3), canonicalStockDecimal(b, 3)];
  if (x === null || y === null) return false;
  const [xi, yi] = [x.replace('.', ''), y.replace('.', '')];
  return xi.length !== yi.length ? xi.length > yi.length : xi > yi;
}

function viewOf(d: StockPendingLineLean, visible: boolean): StockPendingLineView {
  const p = d.proposal;
  return {
    id: String(d._id),
    reason: d.reason,
    status: d.status,
    sourceKey: d.sourceKey,
    proposal: {
      ...p,
      unitPrice: visible ? p.unitPrice : null,
      discountPercent: visible ? p.discountPercent : null,
      invoicedUnitCost: visible ? p.invoicedUnitCost : null,
    },
    movementId: d.movementId ?? null,
    closure: d.closure
      ? { at: new Date(d.closure.at).toISOString(), by: d.closure.by, note: d.closure.note ?? null }
      : null,
    valuesHidden: !visible,
    revision: d.revision,
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}
