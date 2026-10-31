// Fournisseur du port `PURCHASE_RECEPTION_SINK` (ADR-0044 § 6.6, ADR-0046 § 6.1).
// ADR-0046 — S4.
//
// R3 appelle `onReceptionChanged` APRÈS la transaction d'une réception enregistrée ou
// annulée, et AVALE toute erreur (journalisée). L'appel ne porte ni prix, ni devise, ni
// date : le fournisseur relit la réception et la commande (`StockReceptionApplier`,
// idempotent). Un appel perdu est rattrapé par `stock.purchase-sync`.

import { Inject, Injectable } from '@nestjs/common';

import type {
  PurchaseReceptionChange,
  PurchaseReceptionSink,
} from '../../purchases/stock-sink.port.js';
import { StockReceptionApplier } from './stock-reception-applier.js';

@Injectable()
export class StockReceptionSink implements PurchaseReceptionSink {
  constructor(@Inject(StockReceptionApplier) private readonly applier: StockReceptionApplier) {}

  async onReceptionChanged(change: PurchaseReceptionChange): Promise<void> {
    await this.applier.applyReception(change.organizationId, change.receptionId);
  }
}
