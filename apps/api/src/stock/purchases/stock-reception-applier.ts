// Entrées de stock par réception d'achat (ADR-0046 § 2.3.1, § 2.6, § 6.1). ADR-0046 — S4.
//
// `applyReception(organizationId, receptionId)` est IDEMPOTENT : il relit la réception
// et la commande (lecture seule), puis :
//   - réception `recorded` : pour chaque ligne `receivable`, article résolu (`stk:<id>`,
//     code, rattachement mémorisé) et unité convertie (moteur `toStockQuantity`) →
//     `purchase_receipt` (`reception:<id>:<ligne>:in`) à l'emplacement par défaut de
//     l'article, daté `receivedOn`, au coût d'entrée du moteur (`entryUnitCost` : prix HT
//     après remise ÷ facteur) ; devise différente : `pending_cost` et ligne « À traiter »,
//     AUCUN taux ; article inconnu ou unité inconnue : ligne « À traiter », aucun
//     mouvement ;
//   - réception `cancelled` : un `purchase_receipt_reversal` par entrée existante
//     (constaté, O4 : écrit même si le stock devient négatif) ; les lignes « À traiter »
//     encore ouvertes de cette réception sont classées.
// Une réception enregistrée AVANT l'activation des stocks n'est pas rejouée (décision
// ouverte n° 7) ; une organisation sans stocks activés n'est pas touchée.

import { entryUnitCost, toStockQuantity } from '@lalanda/engine';
import {
  stockSourceKey,
  type OpenStockPendingLineInput,
  type StockPendingProposal,
} from '@lalanda/shared/stock';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import type { Connection, Model } from 'mongoose';

import { engineItem, escapeRegex, isOid, negate, stockToday } from '../stock.common.js';
import { StockMovementsService, type StockMovementDraft } from '../stock-movements.service.js';
import { StockPendingService } from '../stock-pending.service.js';
import {
  StockItem,
  StockMovement,
  StockPendingLine,
  StockSettings,
  type StockItemLean,
  type StockMovementLean,
  type StockPendingLineLean,
  type StockSettingsLean,
} from '../stock.schemas.js';
import { recordObserved, resolveStockItem } from '../links/stock-links.common.js';
import {
  PurchaseFactsReader,
  type OrderLineRead,
  type OrderRead,
} from './purchase-facts.reader.js';

export interface ApplyReport {
  written: number;
  pending: number;
}

const NOTHING: ApplyReport = { written: 0, pending: 0 };

/** Décimal tel qu'enregistré (chaîne, ou nombre d'un document ancien). */
const dec = (v: unknown): string | null =>
  typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null;

@Injectable()
export class StockReceptionApplier {
  private readonly logger = new Logger('StockReceptions');
  private readonly reader: PurchaseFactsReader;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(StockItem.name) private readonly items: Model<StockItemLean>,
    @InjectModel(StockSettings.name) private readonly settings: Model<StockSettingsLean>,
    @InjectModel(StockMovement.name) private readonly movements: Model<StockMovementLean>,
    @InjectModel(StockPendingLine.name) private readonly pendingLines: Model<StockPendingLineLean>,
    @Inject(StockMovementsService) private readonly ledger: StockMovementsService,
    @Inject(StockPendingService) private readonly pending: StockPendingService,
  ) {
    this.reader = new PurchaseFactsReader(connection);
  }

  async applyReception(organizationId: string, receptionId: string): Promise<ApplyReport> {
    if (!isOid(receptionId)) return NOTHING;
    const settings = await this.settings
      .findOne({ organizationId })
      .lean<StockSettingsLean>()
      .exec();
    if (!settings) return NOTHING; // stocks non activés
    const reception = await this.reader.reception(organizationId, new ObjectId(receptionId));
    if (!reception) return NOTHING;
    if (new Date(reception.createdAt) < new Date(settings.createdAt)) return NOTHING;
    if (reception.status === 'cancelled') return this.reverse(organizationId, receptionId);
    if (!isOid(reception.orderId)) return NOTHING;
    const order = await this.reader.order(organizationId, new ObjectId(reception.orderId));
    if (!order) return NOTHING;

    const drafts: StockMovementDraft[] = [];
    let pending = 0;
    for (const rl of reception.lines) {
      const line = order.lines.find((l) => String(l.id) === rl.orderLineId);
      if (
        !line ||
        line.receivable === false ||
        (line.receivable !== true && line.kind === 'service')
      )
        continue; // une ligne de service n'entre jamais en stock
      const quantity = dec(rl.quantity);
      if (quantity === null) continue;
      const movementSourceKey = stockSourceKey.receptionIn(receptionId, rl.orderLineId);
      const proposal = proposalOf(
        order,
        line,
        receptionId,
        rl.orderLineId,
        quantity,
        reception.receivedOn,
      );
      const item = await resolveStockItem(
        { items: this.items, pending: this.pending },
        organizationId,
        String(order._id),
        line.itemRef ?? null,
      );
      if (item === null || !item.active) {
        pending += await this.openPending(organizationId, {
          reason: 'unknown_item',
          sourceKey: `pending:${movementSourceKey}`,
          proposal: { ...proposal, movementSourceKey },
        });
        continue;
      }
      if (!item.tracked) continue; // article référencé sans suivi : rien n'entre
      const unit = line.unit ?? item.unit;
      const converted = toStockQuantity(quantity, unit, engineItem(item));
      if (!converted.ok) {
        pending += await this.openPending(organizationId, {
          reason: 'unknown_unit',
          sourceKey: `pending:${movementSourceKey}`,
          proposal: { ...proposal, movementSourceKey, itemId: String(item._id), unit },
        });
        continue;
      }
      const cost = entryUnitCost(
        {
          unitPrice: dec(line.unitPrice) ?? '0.00',
          discountPercent: dec(line.discountPercent),
          unit,
          currency: order.currency,
        },
        engineItem(item),
      );
      drafts.push({
        itemId: String(item._id),
        locationId: item.defaultLocationId ?? settings.defaultLocationId,
        kind: 'purchase_receipt',
        quantity: converted.quantity,
        occurredOn: reception.receivedOn,
        unitCost: cost.status === 'valued' ? cost.unitCost : null,
        costStatus: cost.status === 'valued' ? 'valued' : 'pending_cost',
        source: { kind: 'reception', receptionId, orderLineId: rl.orderLineId },
        sourceKey: movementSourceKey,
        workProjectId: line.workProjectId ?? null,
      });
    }
    const result = await recordObserved(
      { connection: this.connection, ledger: this.ledger, pending: this.pending },
      organizationId,
      drafts,
      (m) => {
        const orderLineId = m.source.kind === 'reception' ? m.source.orderLineId : '';
        const line = order.lines.find((l) => String(l.id) === orderLineId);
        if (!line) return null;
        return {
          reason: 'pending_cost',
          sourceKey: `pending_cost:${String(m._id)}`,
          proposal: {
            ...proposalOf(order, line, receptionId, orderLineId, m.quantity, m.occurredOn),
            movementSourceKey: m.sourceKey,
            itemId: m.itemId,
            locationId: m.locationId,
            movementId: String(m._id),
          },
        };
      },
    );
    return { written: result.written.length, pending: pending + result.pendingCost };
  }

  /** Contre-passation constatée de chaque entrée existante de la réception annulée. */
  private async reverse(organizationId: string, receptionId: string): Promise<ApplyReport> {
    const prefix = `^${escapeRegex(`reception:${receptionId}:`)}`;
    const entries = await this.movements
      .find({ organizationId, sourceKey: { $regex: `${prefix}.*:in$` } })
      .lean<StockMovementLean[]>()
      .exec();
    const reception = await this.reader.reception(organizationId, new ObjectId(receptionId));
    const on = stockToday(
      reception?.cancellation?.at ? new Date(reception.cancellation.at) : new Date(),
    );
    const drafts: StockMovementDraft[] = entries.map((m) => {
      const orderLineId = m.sourceKey.slice(`reception:${receptionId}:`.length, -':in'.length);
      return {
        itemId: m.itemId,
        locationId: m.locationId,
        kind: 'purchase_receipt_reversal',
        quantity: negate(m.quantity),
        occurredOn: on < m.occurredOn ? m.occurredOn : on,
        unitCost: null,
        costStatus: 'not_applicable',
        source: { kind: 'reception', receptionId, orderLineId },
        sourceKey: stockSourceKey.receptionReversal(receptionId, orderLineId),
        workProjectId: m.workProjectId ?? null,
        // Pas de `reversalOf` : le type `purchase_receipt_reversal` porte déjà le sens
        // (le moteur inverse le sens d'un mouvement qui porte `reversalOf`). L'entrée
        // contre-passée se retrouve par la clé `reception:<id>:<ligne>:reversal`.
      };
    });
    const result = await recordObserved(
      { connection: this.connection, ledger: this.ledger, pending: this.pending },
      organizationId,
      drafts,
      () => null,
    );
    // Les lignes « À traiter » encore ouvertes de cette réception n'ont plus d'objet.
    await this.pendingLines.updateMany(
      { organizationId, status: 'open', sourceKey: { $regex: `^pending:${prefix.slice(1)}` } },
      {
        $set: {
          status: 'dismissed',
          closure: { at: new Date(), by: 'system', note: 'Réception annulée.' },
          updatedBy: 'system',
        },
        $inc: { revision: 1 },
      },
    );
    if (result.written.length > 0) {
      this.logger.log(
        `Réception ${receptionId} annulée : ${result.written.length} contre-passation(s).`,
      );
    }
    return { written: result.written.length, pending: 0 };
  }

  private async openPending(
    organizationId: string,
    input: OpenStockPendingLineInput,
  ): Promise<number> {
    return (await this.pending.open(organizationId, input)).created ? 1 : 0;
  }
}

function proposalOf(
  order: OrderRead,
  line: OrderLineRead,
  receptionId: string,
  orderLineId: string,
  quantity: string,
  occurredOn: string,
): StockPendingProposal {
  return {
    movementKind: 'purchase_receipt',
    movementSourceKey: stockSourceKey.receptionIn(receptionId, orderLineId),
    source: { kind: 'reception', receptionId, orderLineId },
    itemId: null,
    itemRef: line.itemRef ?? null,
    label: line.label ?? null,
    quantity,
    unit: line.unit ?? '',
    occurredOn,
    locationId: null,
    unitPrice: dec(line.unitPrice),
    discountPercent: dec(line.discountPercent),
    currency: order.currency,
    workProjectId: line.workProjectId ?? null,
    orderId: String(order._id),
    movementId: null,
    maxQuantity: null,
    invoicedUnitCost: null,
  };
}
