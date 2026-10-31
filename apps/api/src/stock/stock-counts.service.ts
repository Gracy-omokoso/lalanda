// Inventaires (ADR-0046 § 2.7, § 5.1). ADR-0046 — S3.
//
// `draft` → `counting` (lignes figées) → `submitted` → `validated` | `cancelled`.
// Aucun gel du magasin : l'écart est calculé par le moteur (`countVariances`) à
// l'instant du comptage de CHAQUE ligne (mouvements écrits jusque-là). Comptage à
// l'aveugle (défaut) : la quantité théorique n'est servie qu'aux détenteurs de
// `stock.manage`, une fois l'inventaire soumis. Validation : `stockCountDecision`
// (fonction pure de `permissions.ts`, aucun `if (role === …)`) avec le nombre de
// détenteurs EFFECTIFS de `stock.manage` ; un `count_adjustment` par écart non nul,
// daté du jour de validation, `sourceKey` = `count:<id>:<ligne>`. Un écart positif d'un
// article jamais valorisé, sans coût saisi, entre `pending_cost` et passe « À traiter ».

import { countVariances, type CountVariances } from '@lalanda/engine';
import {
  stockSourceKey,
  type CancelStockCountBody,
  type CountStockLineBody,
  type CreateStockCountBody,
  type ListStockCountsQuery,
  type StockCountPage,
  type StockCountView,
  type ValidateStockCountBody,
} from '@lalanda/shared/stock';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Types, type Connection, type Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { AuthzService } from '../authz/authz.service.js';
import { stockCountDecision } from '../authz/permissions.js';
import { staleRevision } from '../sales/sales.errors.js';
import {
  afterKeyCursor,
  conflict,
  decodeKeyCursor,
  encodeKeyCursor,
  engineItem,
  engineMovement,
  holds,
  inTransaction,
  invalidCursor,
  isOid,
  notFound,
  requireAction,
  seesValues,
  stockToday,
  type StockActor,
} from './stock.common.js';
import { StockItemsService } from './stock-items.service.js';
import { StockLocationsService } from './stock-locations.service.js';
import { StockMovementsService, type StockMovementDraft } from './stock-movements.service.js';
import { StockPendingService } from './stock-pending.service.js';
import { StockRefsService } from './stock-refs.service.js';
import {
  StockCount,
  StockItem,
  StockLevel,
  type StockCountLean,
  type StockCountLineDoc,
  type StockItemLean,
  type StockLevelLean,
} from './stock.schemas.js';
import { StockSettingsService } from './stock-settings.service.js';

@Injectable()
export class StockCountsService {
  constructor(
    @InjectModel(StockCount.name) private readonly counts: Model<StockCountLean>,
    @InjectModel(StockItem.name) private readonly itemModel: Model<StockItemLean>,
    @InjectModel(StockLevel.name) private readonly levels: Model<StockLevelLean>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(StockMovementsService) private readonly ledger: StockMovementsService,
    @Inject(StockItemsService) private readonly items: StockItemsService,
    @Inject(StockLocationsService) private readonly locations: StockLocationsService,
    @Inject(StockPendingService) private readonly pending: StockPendingService,
    @Inject(StockSettingsService) private readonly settings: StockSettingsService,
    @Inject(StockRefsService) private readonly refs: StockRefsService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Lecture ──────────────────────────────────────────────────────────────

  async requireOwn(organizationId: string, countId: string): Promise<StockCountLean> {
    if (!isOid(countId)) countNotFound();
    const doc = await this.counts
      .findOne({ _id: new Types.ObjectId(countId), organizationId })
      .lean<StockCountLean>()
      .exec();
    if (!doc) countNotFound();
    return doc;
  }

  async list(
    organizationId: string,
    query: ListStockCountsQuery,
    actor: StockActor,
  ): Promise<StockCountPage> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.status) and.push({ status: query.status });
    if (query.locationId) and.push({ locationId: query.locationId });
    if (query.cursor !== undefined) {
      const cursor = decodeKeyCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(afterKeyCursor('number', cursor, -1));
    }
    const docs = await this.counts
      .find({ $and: and })
      .sort({ number: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<StockCountLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    const views: StockCountView[] = [];
    const approvers = this.approversOnce(organizationId);
    for (const d of page) views.push(await this.view(organizationId, d, actor, false, approvers));
    return {
      items: views,
      nextCursor:
        docs.length > query.limit && last ? encodeKeyCursor(last.number, String(last._id)) : null,
    };
  }

  async get(organizationId: string, countId: string, actor: StockActor): Promise<StockCountView> {
    return this.view(
      organizationId,
      await this.requireOwn(organizationId, countId),
      actor,
      true,
      this.approversOnce(organizationId),
    );
  }

  /** ADR-0046 — S4 : détenteurs effectifs de `stock.manage`, lus une fois par requête. */
  private approversOnce(organizationId: string): () => Promise<number> {
    let count: Promise<number> | null = null;
    return () => (count ??= this.authz.countApprovers(organizationId, 'stock.manage'));
  }

  /**
   * ADR-0046 — S4 (complément des écrans S8) : l'appelant peut-il valider ? Même règle
   * que `validate()` — `stock.manage` effectif, inventaire soumis, `stockCountDecision`
   * (approbateur unique compris) — pour que l'écran ne propose jamais un geste refusé
   * ni ne bloque l'approbateur unique.
   */
  private async validationOf(
    d: StockCountLean,
    actor: StockActor,
    approvers: () => Promise<number>,
  ): Promise<
    Pick<StockCountView, 'canValidate' | 'validationAsSoleApprover' | 'validationBlockedBy'>
  > {
    if (d.status !== 'submitted' || !holds(actor, 'stock.manage')) {
      return { canValidate: false, validationAsSoleApprover: false, validationBlockedBy: null };
    }
    const decision = stockCountDecision({
      validatorUserId: actor.userId,
      counterUserIds: counterUserIdsOf(d),
      approverCountInOrg: await approvers(),
    });
    return decision.ok
      ? {
          canValidate: true,
          validationAsSoleApprover: decision.soleApprover,
          validationBlockedBy: null,
        }
      : { canValidate: false, validationAsSoleApprover: false, validationBlockedBy: decision.code };
  }

  // ── Cycle ────────────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    body: CreateStockCountBody,
    actor: StockActor,
  ): Promise<StockCountView> {
    await this.settings.ensure(organizationId, actor.userId);
    await this.locations.requireActive(organizationId, body.locationId);
    if (body.scope === 'items') {
      const items = await this.items.requireMany(organizationId, body.itemIds ?? []);
      for (const item of items.values()) {
        if (!item.tracked) {
          conflict('STOCK_ITEM_NOT_TRACKED', `L’article « ${item.name} » n’est pas suivi.`);
        }
      }
    }
    for (const userId of new Set(body.assignees)) await this.refs.member(organizationId, userId);
    const number = await this.settings.nextNumber(organizationId, 'IV', new Date());
    const [created] = await this.counts.create([
      {
        organizationId,
        number,
        locationId: body.locationId,
        scope: body.scope,
        itemIds: body.scope === 'items' ? [...new Set(body.itemIds)] : [],
        status: 'draft',
        blind: body.blind,
        assignees: [...new Set(body.assignees)],
        note: body.note ?? null,
        lines: [],
        submission: null,
        validation: null,
        cancellation: null,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      },
    ]);
    return this.get(organizationId, String(created!._id), actor);
  }

  /** Fige les lignes et ouvre le comptage. */
  async start(
    organizationId: string,
    countId: string,
    expectedRevision: number,
    actor: StockActor,
  ): Promise<StockCountView> {
    const current = await this.requireOwn(organizationId, countId);
    if (current.status !== 'draft') conflict('STOCK_COUNT_NOT_DRAFT', 'Inventaire déjà ouvert.');
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    let itemIds: string[];
    if (current.scope === 'items') {
      itemIds = current.itemIds;
    } else {
      // Articles suivis présents à l'emplacement, ou seuillés à cet emplacement.
      const present = await this.levels
        .distinct('itemId', { organizationId, locationId: current.locationId })
        .exec();
      const docs = await this.itemModel
        .find({
          organizationId,
          active: true,
          tracked: true,
          $or: [
            { _id: { $in: present.filter(isOid).map((id) => new Types.ObjectId(id)) } },
            { 'reorder.locationId': current.locationId },
          ],
        })
        .sort({ sortName: 1, _id: 1 })
        .lean<StockItemLean[]>()
        .exec();
      itemIds = docs.map((d) => String(d._id));
    }
    if (itemIds.length === 0) {
      conflict('STOCK_COUNT_EMPTY', 'Aucun article à compter à cet emplacement.');
    }
    const lines: StockCountLineDoc[] = itemIds.map((itemId) => ({
      id: randomUUID().slice(0, 12),
      itemId,
      countedQuantity: null,
      countedAt: null,
      countedBy: null,
      note: null,
      unitCost: null,
      recounts: [],
    }));
    const updated = await this.counts
      .findOneAndUpdate(
        { _id: current._id, organizationId, status: 'draft', revision: expectedRevision },
        { $set: { status: 'counting', lines, updatedBy: actor.userId }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<StockCountLean>()
      .exec();
    if (!updated) staleRevision(current.revision);
    return this.view(organizationId, updated, actor, true, this.approversOnce(organizationId));
  }

  /**
   * Saisie (ou recomptage) d'une ligne. Mise à jour ATOMIQUE de la seule ligne, gardée
   * par son instant de comptage précédent : deux compteurs sur deux lignes ne se gênent
   * pas ; deux saisies concurrentes de la même ligne : la seconde reçoit 409.
   */
  async countLine(
    organizationId: string,
    countId: string,
    lineId: string,
    body: CountStockLineBody,
    actor: StockActor,
  ): Promise<StockCountView> {
    const current = await this.requireOwn(organizationId, countId);
    if (current.status !== 'counting') {
      conflict('STOCK_COUNT_NOT_COUNTING', 'Cet inventaire n’est pas ouvert au comptage.');
    }
    const line = current.lines.find((l) => l.id === lineId);
    if (!line) notFound('STOCK_COUNT_LINE_NOT_FOUND', 'Ligne d’inventaire introuvable.');
    const setsCost = body.unitCost !== undefined && body.unitCost !== null;
    if (setsCost) requireAction(actor, 'stock.manage');
    const now = new Date();
    const set: Record<string, unknown> = {
      'lines.$.countedQuantity': body.countedQuantity,
      'lines.$.countedAt': now,
      'lines.$.countedBy': actor.userId,
      updatedBy: actor.userId,
    };
    if (body.note !== undefined) set['lines.$.note'] = body.note;
    if (body.unitCost !== undefined) set['lines.$.unitCost'] = body.unitCost;
    const update: Record<string, unknown> = { $set: set, $inc: { revision: 1 } };
    if (line.countedQuantity !== null && line.countedAt !== null) {
      update['$push'] = {
        'lines.$.recounts': {
          countedQuantity: line.countedQuantity,
          countedAt: line.countedAt,
          countedBy: line.countedBy,
        },
      };
    }
    const updated = await this.counts
      .findOneAndUpdate(
        {
          _id: current._id,
          organizationId,
          status: 'counting',
          lines: { $elemMatch: { id: lineId, countedAt: line.countedAt } },
        },
        update,
        { new: true },
      )
      .lean<StockCountLean>()
      .exec();
    if (!updated) staleRevision(current.revision);
    return this.view(organizationId, updated, actor, true, this.approversOnce(organizationId));
  }

  async submit(
    organizationId: string,
    countId: string,
    expectedRevision: number,
    actor: StockActor,
  ): Promise<StockCountView> {
    const current = await this.requireOwn(organizationId, countId);
    if (current.status !== 'counting') {
      conflict('STOCK_COUNT_NOT_COUNTING', 'Cet inventaire n’est pas ouvert au comptage.');
    }
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    const missing = current.lines.filter((l) => l.countedQuantity === null).length;
    if (missing > 0) {
      conflict('STOCK_COUNT_INCOMPLETE', 'Des lignes ne sont pas encore comptées.', { missing });
    }
    const updated = await this.counts
      .findOneAndUpdate(
        { _id: current._id, organizationId, status: 'counting', revision: expectedRevision },
        {
          $set: {
            status: 'submitted',
            submission: { at: new Date(), by: actor.userId },
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<StockCountLean>()
      .exec();
    if (!updated) staleRevision(current.revision);
    return this.view(organizationId, updated, actor, true, this.approversOnce(organizationId));
  }

  async validate(
    organizationId: string,
    countId: string,
    body: ValidateStockCountBody,
    actor: StockActor,
  ): Promise<StockCountView> {
    const current = await this.requireOwn(organizationId, countId);
    if (current.status !== 'submitted') {
      conflict('STOCK_COUNT_NOT_SUBMITTED', 'Seul un inventaire soumis se valide.');
    }
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);

    // Séparation des tâches : les PERSONNES qui ont compté, recomptages compris.
    const decision = stockCountDecision({
      validatorUserId: actor.userId,
      counterUserIds: counterUserIdsOf(current),
      approverCountInOrg: await this.authz.countApprovers(organizationId, 'stock.manage'),
    });
    if (!decision.ok) {
      conflict(
        'COUNT_SELF_VALIDATION',
        'Vous avez compté une ligne de cet inventaire : un autre gestionnaire du stock le valide.',
      );
    }

    const today = stockToday();
    const countedItems = current.lines.map((l) => l.itemId);
    const docs = await this.items.requireMany(organizationId, countedItems);
    const movements = await this.ledger.ofItems(organizationId, countedItems);
    const variances = this.variancesOf(current, docs, movements.map(engineMovement));
    const drafts: StockMovementDraft[] = [];
    for (const v of variances.lines) {
      if (v.status !== 'counted' || v.variance === null || /^-?[0.]+$/.test(v.variance)) continue;
      drafts.push({
        itemId: v.itemId,
        locationId: current.locationId,
        kind: 'count_adjustment',
        quantity: v.variance,
        occurredOn: today,
        unitCost: v.adjustmentUnitCost,
        costStatus:
          v.adjustmentUnitCost !== null
            ? 'valued'
            : v.needsUnitCost
              ? 'pending_cost'
              : 'not_applicable',
        source: { kind: 'count', countId, lineId: v.lineId },
        sourceKey: stockSourceKey.count(countId, v.lineId),
      });
    }
    await this.ledger.ensureLevels(organizationId, drafts);
    const updated = await inTransaction(this.connection, async (session) => {
      const result = await this.ledger.record(organizationId, drafts, {
        mode: 'observed',
        actorUserId: actor.userId,
        session,
      });
      const doc = await this.counts
        .findOneAndUpdate(
          {
            _id: current._id,
            organizationId,
            status: 'submitted',
            revision: body.expectedRevision,
          },
          {
            $set: {
              status: 'validated',
              validation: {
                at: new Date(),
                by: actor.userId,
                comment: body.comment ?? null,
                soleApprover: decision.soleApprover,
              },
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { new: true, session },
        )
        .lean<StockCountLean>()
        .exec();
      if (!doc) staleRevision(current.revision);
      for (const m of result.written.filter((w) => w.costStatus === 'pending_cost')) {
        await this.pending.open(
          organizationId,
          {
            reason: 'pending_cost',
            sourceKey: `pending_cost:${String(m._id)}`,
            proposal: {
              movementKind: 'count_adjustment',
              movementSourceKey: m.sourceKey,
              source: m.source,
              itemId: m.itemId,
              itemRef: null,
              label: docs.get(m.itemId)?.name ?? null,
              quantity: m.quantity,
              unit: docs.get(m.itemId)?.unit ?? '',
              occurredOn: m.occurredOn,
              locationId: m.locationId,
              unitPrice: null,
              discountPercent: null,
              currency: docs.get(m.itemId)?.costCurrency ?? null,
              workProjectId: null,
              orderId: null,
              movementId: String(m._id),
              maxQuantity: null,
              invoicedUnitCost: null,
            },
          },
          actor.userId,
          session,
        );
      }
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'stock.count_validated',
          targetType: 'stock_count',
          targetId: countId,
          metadata: {
            number: current.number,
            soleApprover: decision.soleApprover,
            adjustments: result.written.length,
            counters: counterUserIdsOf(current).length,
          },
        },
        { session },
      );
      return doc;
    });
    return this.view(organizationId, updated, actor, true, this.approversOnce(organizationId));
  }

  async cancel(
    organizationId: string,
    countId: string,
    body: CancelStockCountBody,
    actor: StockActor,
  ): Promise<StockCountView> {
    const current = await this.requireOwn(organizationId, countId);
    if (current.status === 'validated' || current.status === 'cancelled') {
      conflict('STOCK_COUNT_CLOSED', 'Cet inventaire est clos.');
    }
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const updated = await this.counts
      .findOneAndUpdate(
        {
          _id: current._id,
          organizationId,
          status: current.status,
          revision: body.expectedRevision,
        },
        {
          $set: {
            status: 'cancelled',
            cancellation: { at: new Date(), by: actor.userId, reason: body.reason },
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<StockCountLean>()
      .exec();
    if (!updated) staleRevision(current.revision);
    return this.view(organizationId, updated, actor, true, this.approversOnce(organizationId));
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  private variancesOf(
    count: StockCountLean,
    items: Map<string, StockItemLean>,
    movements: ReturnType<typeof engineMovement>[],
  ): CountVariances {
    return countVariances({
      locationId: count.locationId,
      lines: count.lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        countedQuantity: l.countedQuantity,
        countedAt: l.countedAt ? new Date(l.countedAt).toISOString() : null,
        unitCost: l.unitCost,
      })),
      movements,
      items: [...items.values()].map(engineItem),
    });
  }

  private async view(
    organizationId: string,
    d: StockCountLean,
    actor: StockActor,
    detailed: boolean,
    approvers: () => Promise<number>,
  ): Promise<StockCountView> {
    const visible = seesValues(actor);
    const theoreticalVisible =
      !d.blind ||
      (holds(actor, 'stock.manage') && (d.status === 'submitted' || d.status === 'validated'));
    const itemIds = d.lines.map((l) => l.itemId);
    const items =
      itemIds.length > 0
        ? await this.items.requireMany(organizationId, itemIds).catch(() => new Map())
        : new Map<string, StockItemLean>();
    let variances: CountVariances | null = null;
    if (detailed && theoreticalVisible && d.lines.length > 0) {
      const movements = await this.ledger.ofItems(organizationId, itemIds);
      variances = this.variancesOf(d, items, movements.map(engineMovement));
    }
    const byLine = new Map(variances?.lines.map((v) => [v.lineId, v]) ?? []);
    const names = await this.locations.names(organizationId);
    return {
      id: String(d._id),
      number: d.number,
      locationId: d.locationId,
      locationName: names.get(d.locationId) ?? null,
      scope: d.scope,
      status: d.status,
      blind: d.blind,
      assignees: d.assignees,
      note: d.note ?? null,
      lines: d.lines.map((l) => {
        const item = items.get(l.itemId) as StockItemLean | undefined;
        const v = byLine.get(l.id);
        return {
          id: l.id,
          itemId: l.itemId,
          itemCode: item?.code ?? null,
          itemName: item?.name ?? null,
          unit: item?.unit ?? null,
          countedQuantity: l.countedQuantity,
          countedAt: l.countedAt ? new Date(l.countedAt).toISOString() : null,
          countedBy: l.countedBy,
          note: l.note ?? null,
          unitCost: visible ? l.unitCost : null,
          recounts: l.recounts.map((r) => ({
            countedQuantity: r.countedQuantity,
            countedAt: new Date(r.countedAt).toISOString(),
            countedBy: r.countedBy,
          })),
          theoretical: v?.theoretical ?? null,
          variance: v?.variance ?? null,
          valuedVariance: visible ? (v?.valuedVariance ?? null) : null,
          currency: v?.currency ?? item?.costCurrency ?? null,
          needsUnitCost: v?.needsUnitCost ?? false,
        };
      }),
      variances: variances
        ? {
            byCurrency: variances.byCurrency.map((c) => ({
              currency: c.currency,
              gains: visible ? c.gains : null,
              losses: visible ? c.losses : null,
              net: visible ? c.net : null,
              unvaluedLineCount: c.unvaluedLineCount,
            })),
            countedLineCount: variances.countedLineCount,
            varianceLineCount: variances.varianceLineCount,
          }
        : null,
      theoreticalHidden: !theoreticalVisible,
      valuesHidden: !visible,
      submission: d.submission
        ? { at: new Date(d.submission.at).toISOString(), by: d.submission.by }
        : null,
      validation: d.validation
        ? {
            at: new Date(d.validation.at).toISOString(),
            by: d.validation.by,
            comment: d.validation.comment ?? null,
            soleApprover: d.validation.soleApprover,
          }
        : null,
      cancellation: d.cancellation
        ? {
            at: new Date(d.cancellation.at).toISOString(),
            by: d.cancellation.by,
            reason: d.cancellation.reason,
          }
        : null,
      ...(await this.validationOf(d, actor, approvers)),
      revision: d.revision,
      createdBy: d.createdBy,
      createdAt: new Date(d.createdAt).toISOString(),
      updatedAt: new Date(d.updatedAt).toISOString(),
    };
  }
}

/** Personnes qui ont saisi une quantité comptée, recomptages compris (§ 2.7). */
function counterUserIdsOf(d: StockCountLean): string[] {
  return [
    ...new Set(
      d.lines.flatMap((l) => [
        ...(l.countedBy ? [l.countedBy] : []),
        ...l.recounts.map((r) => r.countedBy),
      ]),
    ),
  ];
}

function countNotFound(): never {
  notFound('STOCK_COUNT_NOT_FOUND', 'Inventaire introuvable.');
}
