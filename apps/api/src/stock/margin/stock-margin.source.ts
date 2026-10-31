// Fournisseur réel du port `WORK_STOCK_SOURCE` de la marge — ADR-0046 § 6.4.
// ADR-0046 — S7.
//
// LECTURE SEULE, organisation de la session, par la connexion (aucune dépendance vers
// `StockModule`). Lit les articles qui ont au moins un mouvement imputé au projet, puis
// TOUS les mouvements de ces articles : le coût moyen pondéré se rejoue sur tout
// l'historique (moteur des stocks). Le moteur de la marge garde les seuls mouvements du
// projet et rend `materials`, informatif, jamais soustrait.

import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';

import type { WorkStockRead, WorkStockSource } from '../../work/margin/work-stock.port.js';
import { engineItem, engineMovement } from '../stock.common.js';
import type { StockItemLean, StockMovementLean } from '../stock.schemas.js';

/** Mouvements lus au plus pour une marge : au-delà, la lecture est refusée plutôt que fausse. */
export const MAX_MARGIN_MOVEMENTS = 50_000;

@Injectable()
export class StockMarginSource implements WorkStockSource {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async stockOf(organizationId: string, projectId: string): Promise<WorkStockRead | null> {
    const itemIds = (await this.connection
      .collection('stock_movements')
      .distinct('itemId', { organizationId, workProjectId: projectId })) as string[];
    if (itemIds.length === 0) return { items: [], movements: [] };
    const ids = itemIds.filter((id) => Types.ObjectId.isValid(id));
    const [items, movements] = await Promise.all([
      this.connection
        .collection('stock_items')
        .find({ organizationId, _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
        .toArray() as unknown as Promise<StockItemLean[]>,
      this.connection
        .collection('stock_movements')
        .find({ organizationId, itemId: { $in: ids } })
        .sort({ occurredOn: 1, createdAt: 1, _id: 1 })
        .limit(MAX_MARGIN_MOVEMENTS + 1)
        .toArray() as unknown as Promise<StockMovementLean[]>,
    ]);
    // Un historique tronqué fausserait le coût moyen : rien plutôt qu'un faux chiffre.
    if (movements.length > MAX_MARGIN_MOVEMENTS) return null;
    return { items: items.map(engineItem), movements: movements.map(engineMovement) };
  }
}
