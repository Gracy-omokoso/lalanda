// Bons de sortie, de retour, de transfert, d'ajustement et de retour fournisseur
// (ADR-0046 § 2.4, § 5.1, O4). ADR-0046 — S3.
//
// `draft` → `posted` : les mouvements s'écrivent dans UNE transaction, avec le passage du
// bon à `posted` (révision attendue) ; le grand livre refuse une sortie au-delà du
// disponible (`409 STOCK_INSUFFICIENT`) sauf `allowNegativeManualMoves`. `posted` →
// `cancelled` : contre-mouvements (`reversalOf`), jamais d'effacement. Un ajustement
// exige `stock.manage` (§ 5.1) et un motif de la liste réglable.

import {
  refineStockVoucherUpdate,
  stockSourceKey,
  type CancelStockVoucherBody,
  type CreateStockVoucherBody,
  type ListStockVouchersQuery,
  type StockVoucherKind,
  type StockVoucherPage,
  type StockVoucherView,
  type UpdateStockVoucherBody,
} from '@lalanda/shared/stock';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Types, type Connection, type Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { invalidRequest, staleRevision } from '../sales/sales.errors.js';
import {
  afterKeyCursor,
  assertNotFuture,
  badRequest,
  conflict,
  decodeKeyCursor,
  encodeKeyCursor,
  inTransaction,
  invalidCursor,
  isOid,
  negate,
  notFound,
  requireAction,
  seesValues,
  stockToday,
  type StockActor,
} from './stock.common.js';
import { StockItemsService } from './stock-items.service.js';
import { StockLocationsService } from './stock-locations.service.js';
import { StockMovementsService, type StockMovementDraft } from './stock-movements.service.js';
import { StockRefsService } from './stock-refs.service.js';
import {
  StockVoucher,
  type StockItemLean,
  type StockVoucherLean,
  type StockVoucherLineDoc,
} from './stock.schemas.js';
import { StockSettingsService } from './stock-settings.service.js';

type VoucherInput = Omit<CreateStockVoucherBody, 'kind'>;

const NUMBER_KIND = {
  issue: 'BS',
  issue_return: 'BS',
  supplier_return: 'BS',
  transfer: 'BT',
  adjustment: 'BJ',
} as const;

@Injectable()
export class StockVouchersService {
  constructor(
    @InjectModel(StockVoucher.name) private readonly vouchers: Model<StockVoucherLean>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(StockMovementsService) private readonly ledger: StockMovementsService,
    @Inject(StockItemsService) private readonly items: StockItemsService,
    @Inject(StockLocationsService) private readonly locations: StockLocationsService,
    @Inject(StockSettingsService) private readonly settings: StockSettingsService,
    @Inject(StockRefsService) private readonly refs: StockRefsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Lecture ──────────────────────────────────────────────────────────────

  async requireOwn(organizationId: string, voucherId: string): Promise<StockVoucherLean> {
    if (!isOid(voucherId)) voucherNotFound();
    const doc = await this.vouchers
      .findOne({ _id: new Types.ObjectId(voucherId), organizationId })
      .lean<StockVoucherLean>()
      .exec();
    if (!doc) voucherNotFound();
    return doc;
  }

  async list(
    organizationId: string,
    query: ListStockVouchersQuery,
    actor: StockActor,
  ): Promise<StockVoucherPage> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.kind) and.push({ kind: query.kind });
    if (query.status) and.push({ status: query.status });
    if (query.cursor !== undefined) {
      const cursor = decodeKeyCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(afterKeyCursor('number', cursor, -1));
    }
    const docs = await this.vouchers
      .find({ $and: and })
      .sort({ number: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<StockVoucherLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: await this.views(organizationId, page, actor),
      nextCursor:
        docs.length > query.limit && last ? encodeKeyCursor(last.number, String(last._id)) : null,
    };
  }

  async get(organizationId: string, voucherId: string, actor: StockActor) {
    return (
      await this.views(organizationId, [await this.requireOwn(organizationId, voucherId)], actor)
    )[0]!;
  }

  // ── Écriture ─────────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    body: CreateStockVoucherBody,
    actor: StockActor,
  ): Promise<StockVoucherView> {
    if (body.kind === 'adjustment') requireAction(actor, 'stock.manage');
    const { kind, ...input } = body;
    await this.check(organizationId, kind, input);
    const number = await this.settings.nextNumber(organizationId, NUMBER_KIND[kind], new Date());
    const [created] = await this.vouchers.create([
      {
        organizationId,
        number,
        kind,
        status: 'draft',
        ...fieldsOf(input),
        posting: null,
        cancellation: null,
        wentNegative: false,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      },
    ]);
    return this.get(organizationId, String(created!._id), actor);
  }

  async update(
    organizationId: string,
    voucherId: string,
    body: UpdateStockVoucherBody,
    actor: StockActor,
  ): Promise<StockVoucherView> {
    const current = await this.requireOwn(organizationId, voucherId);
    if (current.kind === 'adjustment') requireAction(actor, 'stock.manage');
    if (current.status !== 'draft') {
      conflict('STOCK_VOUCHER_NOT_DRAFT', 'Seul un brouillon se modifie.');
    }
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const shape = refineStockVoucherUpdate(current.kind, body);
    if (!shape.success) invalidRequest(shape.error);
    const { expectedRevision, ...input } = body;
    await this.check(organizationId, current.kind, input);
    const updated = await this.vouchers
      .findOneAndUpdate(
        { _id: current._id, organizationId, status: 'draft', revision: expectedRevision },
        { $set: { ...fieldsOf(input), updatedBy: actor.userId }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<StockVoucherLean>()
      .exec();
    if (!updated) staleRevision(current.revision);
    return (await this.views(organizationId, [updated], actor))[0]!;
  }

  /** Comptabilise un brouillon : mouvements, niveaux et statut dans une transaction. */
  async post(
    organizationId: string,
    voucherId: string,
    expectedRevision: number,
    actor: StockActor,
  ): Promise<StockVoucherView> {
    const current = await this.requireOwn(organizationId, voucherId);
    if (current.kind === 'adjustment') requireAction(actor, 'stock.manage');
    if (current.status !== 'draft') {
      conflict('STOCK_VOUCHER_NOT_DRAFT', 'Ce bon n’est plus un brouillon.');
    }
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    // Les références ont pu changer depuis le brouillon (article archivé…).
    await this.check(organizationId, current.kind, current);
    const settings = await this.settings.ensure(organizationId);
    const drafts = draftsOf(current);
    await this.ledger.ensureLevels(organizationId, drafts);
    const updated = await inTransaction(this.connection, async (session) => {
      const result = await this.ledger.record(organizationId, drafts, {
        mode: 'decided',
        allowNegative: settings.allowNegativeManualMoves,
        actorUserId: actor.userId,
        session,
      });
      const doc = await this.vouchers
        .findOneAndUpdate(
          { _id: current._id, organizationId, status: 'draft', revision: expectedRevision },
          {
            $set: {
              status: 'posted',
              posting: { at: new Date(), by: actor.userId },
              wentNegative: result.goesNegative,
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { new: true, session },
        )
        .lean<StockVoucherLean>()
        .exec();
      if (!doc) staleRevision(current.revision);
      await this.audit.record(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'stock.voucher_posted',
          targetType: 'stock_voucher',
          targetId: voucherId,
          metadata: {
            number: current.number,
            kind: current.kind,
            movements: result.written.length,
            wentNegative: result.goesNegative,
          },
        },
        { session },
      );
      return doc;
    });
    return (await this.views(organizationId, [updated], actor))[0]!;
  }

  /** Annule un brouillon (rien à défaire) ou un bon comptabilisé (contre-mouvements). */
  async cancel(
    organizationId: string,
    voucherId: string,
    body: CancelStockVoucherBody,
    actor: StockActor,
  ): Promise<StockVoucherView> {
    const current = await this.requireOwn(organizationId, voucherId);
    if (current.kind === 'adjustment') requireAction(actor, 'stock.manage');
    if (current.status === 'cancelled') {
      conflict('STOCK_VOUCHER_CANCELLED', 'Ce bon est déjà annulé.');
    }
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const settings = await this.settings.ensure(organizationId);
    const originals =
      current.status === 'posted' ? await this.ledger.ofVoucher(organizationId, voucherId) : [];
    const reversals: StockMovementDraft[] = originals
      .filter((m) => m.reversalOf === null || m.reversalOf === undefined)
      .map((m) => {
        const lineId = (m.source as { lineId: string }).lineId;
        const leg =
          current.kind === 'transfer'
            ? `${lineId}.${m.kind === 'transfer_in' ? 'in' : 'out'}`
            : lineId;
        return {
          itemId: m.itemId,
          locationId: m.locationId,
          kind: m.kind,
          quantity: negate(m.quantity),
          occurredOn: stockToday(),
          unitCost: null,
          costStatus: 'not_applicable',
          source: { kind: 'voucher', voucherId, lineId },
          sourceKey: stockSourceKey.voucher(voucherId, leg, 'reversal'),
          workProjectId: m.workProjectId,
          transferId: m.transferId,
          reason: m.reason,
          reversalOf: String(m._id),
        };
      });
    await this.ledger.ensureLevels(organizationId, reversals);
    const updated = await inTransaction(this.connection, async (session) => {
      const result = await this.ledger.record(organizationId, reversals, {
        mode: 'decided',
        allowNegative: settings.allowNegativeManualMoves,
        actorUserId: actor.userId,
        session,
      });
      const doc = await this.vouchers
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
          { new: true, session },
        )
        .lean<StockVoucherLean>()
        .exec();
      if (!doc) staleRevision(current.revision);
      await this.audit.record(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'stock.voucher_cancelled',
          targetType: 'stock_voucher',
          targetId: voucherId,
          metadata: {
            number: current.number,
            kind: current.kind,
            wasPosted: current.status === 'posted',
            reversals: result.written.length,
            reason: body.reason,
          },
        },
        { session },
      );
      return doc;
    });
    return (await this.views(organizationId, [updated], actor))[0]!;
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  /** Références de l'organisation, articles suivis et actifs, date, motif. */
  private async check(
    organizationId: string,
    kind: StockVoucherKind,
    input: {
      fromLocationId?: string | null;
      toLocationId?: string | null;
      postedOn: string;
      lines: { itemId: string }[];
      workProjectId?: string | null;
      employeeId?: string | null;
      supplierId?: string | null;
      receptionId?: string | null;
      reason?: { key: string } | null;
    },
  ): Promise<void> {
    assertNotFuture(input.postedOn, 'postedOn');
    if (input.fromLocationId)
      await this.locations.requireActive(organizationId, input.fromLocationId);
    if (input.toLocationId) await this.locations.requireActive(organizationId, input.toLocationId);
    const items = await this.items.requireMany(
      organizationId,
      input.lines.map((l) => l.itemId),
    );
    for (const item of items.values()) assertMovable(item);
    if (input.workProjectId) await this.refs.workProject(organizationId, input.workProjectId);
    if (input.employeeId) await this.refs.employee(organizationId, input.employeeId);
    if (input.supplierId) await this.refs.supplier(organizationId, input.supplierId);
    if (input.receptionId) await this.refs.reception(organizationId, input.receptionId);
    if (kind === 'adjustment' && input.reason) {
      const settings = await this.settings.ensure(organizationId);
      if (!settings.adjustmentReasons.some((r) => r.key === input.reason!.key)) {
        badRequest('UNKNOWN_ADJUSTMENT_REASON', 'Motif d’ajustement inconnu des réglages.', {
          key: input.reason.key,
        });
      }
    }
  }

  private async views(
    organizationId: string,
    docs: readonly StockVoucherLean[],
    actor: StockActor,
  ): Promise<StockVoucherView[]> {
    if (docs.length === 0) return [];
    const itemIds = [...new Set(docs.flatMap((d) => d.lines.map((l) => l.itemId)))];
    const items = await this.items.requireMany(organizationId, itemIds).catch(() => new Map());
    const visible = seesValues(actor);
    return docs.map((d) => ({
      id: String(d._id),
      number: d.number,
      kind: d.kind,
      status: d.status,
      fromLocationId: d.fromLocationId ?? null,
      toLocationId: d.toLocationId ?? null,
      postedOn: d.postedOn,
      lines: d.lines.map((l) => {
        const item = items.get(l.itemId) as StockItemLean | undefined;
        return {
          id: l.id,
          itemId: l.itemId,
          itemName: item?.name ?? null,
          unit: item?.unit ?? null,
          quantity: l.quantity,
          direction: l.direction ?? null,
          unitCost: visible ? (l.unitCost ?? null) : null,
          note: l.note ?? null,
        };
      }),
      workProjectId: d.workProjectId ?? null,
      recipient: d.recipient ?? null,
      employeeId: d.employeeId ?? null,
      supplierId: d.supplierId ?? null,
      receptionId: d.receptionId ?? null,
      reason: d.reason ?? null,
      note: d.note ?? null,
      posting: d.posting ? { at: new Date(d.posting.at).toISOString(), by: d.posting.by } : null,
      cancellation: d.cancellation
        ? {
            at: new Date(d.cancellation.at).toISOString(),
            by: d.cancellation.by,
            reason: d.cancellation.reason,
          }
        : null,
      wentNegative: d.wentNegative ?? false,
      valuesHidden: !visible,
      revision: d.revision,
      createdBy: d.createdBy,
      createdAt: new Date(d.createdAt).toISOString(),
      updatedAt: new Date(d.updatedAt).toISOString(),
    }));
  }
}

function voucherNotFound(): never {
  notFound('STOCK_VOUCHER_NOT_FOUND', 'Bon introuvable.');
}

/** Un article archivé ou non suivi ne se mouvemente pas. */
export function assertMovable(item: StockItemLean): void {
  if (!item.active) conflict('STOCK_ITEM_ARCHIVED', `L’article « ${item.name} » est archivé.`);
  if (!item.tracked) {
    conflict('STOCK_ITEM_NOT_TRACKED', `L’article « ${item.name} » n’est pas suivi en quantité.`);
  }
}

function fieldsOf(input: VoucherInput): Record<string, unknown> {
  return {
    fromLocationId: input.fromLocationId ?? null,
    toLocationId: input.toLocationId ?? null,
    postedOn: input.postedOn,
    lines: input.lines.map((l): StockVoucherLineDoc => ({
      id: l.id ?? randomUUID().slice(0, 8),
      itemId: l.itemId,
      quantity: l.quantity,
      direction: l.direction ?? null,
      unitCost: l.unitCost ?? null,
      note: l.note ?? null,
    })),
    workProjectId: input.workProjectId ?? null,
    recipient: input.recipient ?? null,
    employeeId: input.employeeId ?? null,
    supplierId: input.supplierId ?? null,
    receptionId: input.receptionId ?? null,
    reason: input.reason ? { key: input.reason.key, note: input.reason.note ?? null } : null,
    note: input.note ?? null,
  };
}

/** Mouvements d'un bon selon son type (§ 2.3, § 2.4). */
function draftsOf(v: StockVoucherLean): StockMovementDraft[] {
  const voucherId = String(v._id);
  const out: StockMovementDraft[] = [];
  const reason = v.reason ?? null;
  for (const line of v.lines) {
    const src = { kind: 'voucher' as const, voucherId, lineId: line.id };
    const base = {
      itemId: line.itemId,
      occurredOn: v.postedOn,
      source: src,
      workProjectId: v.workProjectId ?? null,
    };
    switch (v.kind) {
      case 'issue':
      case 'supplier_return':
        out.push({
          ...base,
          locationId: v.fromLocationId!,
          kind: v.kind,
          quantity: negate(line.quantity),
          unitCost: null,
          costStatus: 'not_applicable',
          sourceKey: stockSourceKey.voucher(voucherId, line.id, 'out'),
        });
        break;
      case 'issue_return':
        out.push({
          ...base,
          locationId: v.toLocationId!,
          kind: 'issue_return',
          quantity: line.quantity,
          unitCost: null,
          costStatus: 'not_applicable',
          sourceKey: stockSourceKey.voucher(voucherId, line.id, 'in'),
        });
        break;
      case 'transfer': {
        const transferId = `${voucherId}:${line.id}`;
        out.push({
          ...base,
          locationId: v.fromLocationId!,
          kind: 'transfer_out',
          quantity: negate(line.quantity),
          unitCost: null,
          costStatus: 'not_applicable',
          sourceKey: stockSourceKey.voucher(voucherId, line.id, 'out'),
          transferId,
        });
        out.push({
          ...base,
          locationId: v.toLocationId!,
          kind: 'transfer_in',
          quantity: line.quantity,
          unitCost: null,
          costStatus: 'not_applicable',
          sourceKey: stockSourceKey.voucher(voucherId, line.id, 'in'),
          transferId,
        });
        break;
      }
      case 'adjustment': {
        const entry = line.direction === 'in';
        const valued = entry && line.unitCost !== null && line.unitCost !== undefined;
        out.push({
          ...base,
          locationId: v.fromLocationId!,
          kind: 'adjustment',
          quantity: entry ? line.quantity : negate(line.quantity),
          unitCost: valued ? line.unitCost : null,
          costStatus: valued ? 'valued' : 'not_applicable',
          sourceKey: stockSourceKey.voucher(voucherId, line.id, entry ? 'in' : 'out'),
          reason,
        });
        break;
      }
    }
  }
  return out;
}
