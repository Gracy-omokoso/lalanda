// Fournisseur du port `STOCK_OPEN_ORDERS_SOURCE` : quantités commandées non reçues
// (ADR-0046 § 6.1, § 7.1). ADR-0046 — S4.
//
// Lit, en LECTURE SEULE, les commandes vivantes (`approved`, `sent`,
// `partially_received`) et leurs réceptions ; le reste à recevoir de chaque ligne vient
// du moteur des achats (`orderReceptionStatus`), sa conversion en unité de stock du
// moteur des stocks (`toStockQuantity`). Seules les lignes dont `itemRef` désigne un
// article suivi comptent ; une unité inconnue n'est pas devinée (ligne ignorée).
// Aucune écriture, ni dans les achats ni dans les stocks.

import {
  orderReceptionStatus,
  toStockQuantity,
  type OpenOrderQuantityInput,
} from '@lalanda/engine';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { resolveStockItem } from '../links/stock-links.common.js';
import { engineItem } from '../stock.common.js';
import { StockPendingService } from '../stock-pending.service.js';
import type { StockOpenOrdersSource } from '../stock-reports.service.js';

// Le jeton du port, réexporté pour le branchement dans `StockModule`.
export { STOCK_OPEN_ORDERS_SOURCE } from '../stock-reports.service.js';
import { StockItem, type StockItemLean } from '../stock.schemas.js';
import { PurchaseFactsReader } from './purchase-facts.reader.js';

const dec = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '0';

@Injectable()
export class StockOpenOrdersReader implements StockOpenOrdersSource {
  private readonly logger = new Logger('StockOpenOrders');
  private readonly reader: PurchaseFactsReader;

  constructor(
    @InjectConnection() connection: Connection,
    @InjectModel(StockItem.name) private readonly items: Model<StockItemLean>,
    @Inject(StockPendingService) private readonly pending: StockPendingService,
  ) {
    this.reader = new PurchaseFactsReader(connection);
  }

  async openOrders(organizationId: string): Promise<OpenOrderQuantityInput[]> {
    const orders = await this.reader.openOrders(organizationId);
    if (orders.length === 0) return [];
    const receptions = await this.reader.receptionsOf(
      organizationId,
      orders.map((o) => String(o._id)),
    );
    const out: OpenOrderQuantityInput[] = [];
    for (const order of orders) {
      const orderId = String(order._id);
      let status;
      try {
        status = orderReceptionStatus(
          {
            status: order.status as Parameters<typeof orderReceptionStatus>[0]['status'],
            sent: order.sentAt instanceof Date,
            lines: order.lines.map((l) => ({
              id: String(l.id),
              quantity: dec(l.quantity),
              receivable: l.receivable !== false && l.kind !== 'service',
            })),
          },
          receptions
            .filter((r) => r.orderId === orderId)
            .map((r) => ({
              status: r.status,
              lines: r.lines.map((x) => ({
                orderLineId: x.orderLineId,
                quantity: dec(x.quantity),
              })),
            })),
        );
      } catch (err) {
        this.logger.warn(`Commande ${orderId} illisible : ${(err as Error).message}`);
        continue;
      }
      for (const rest of status.lines) {
        if (!rest.receivable || /^[0.]+$/.test(rest.remaining)) continue;
        const line = order.lines.find((l) => String(l.id) === rest.orderLineId);
        if (!line?.itemRef) continue;
        const item = await resolveStockItem(
          { items: this.items, pending: this.pending },
          organizationId,
          orderId,
          line.itemRef,
        );
        if (!item || !item.tracked || !item.active) continue;
        const converted = toStockQuantity(rest.remaining, line.unit ?? item.unit, engineItem(item));
        if (converted.ok) out.push({ itemId: String(item._id), quantity: converted.quantity });
      }
    }
    return out;
  }
}
