// Fournisseur réel du port `STOCK_SOURCE` du brief du matin — ADR-0046 § 6.6.
// ADR-0046 — S7.
//
// LECTURE SEULE, dans l'organisation de la session seulement, par la connexion (motif de
// `HrBriefSource` : aucune dépendance vers `StockModule`). Lus : les articles (unité,
// suivi, actif, seuil — JAMAIS un coût, un nom ni un prix), les niveaux du cache et le
// NOMBRE de lignes « À traiter » ouvertes. Le moteur du brief compte lui-même ruptures
// et articles sous le seuil. Appelé seulement avec `stock.read` (service du brief).

import type { BriefStockInput } from '@lalanda/engine';
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import type { StockSource } from '../../morning-brief/morning-brief.ports.js';
import { engineItem, qty3 } from '../stock.common.js';
import type { StockItemLean } from '../stock.schemas.js';

/** Articles et niveaux lus au plus pour un brief : un tableau de bord n'est pas un export. */
export const MAX_BRIEF_STOCK_ROWS = 5000;

@Injectable()
export class StockBriefSource implements StockSource {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async stockOf(organizationId: string): Promise<BriefStockInput> {
    const [items, levels, pendingCount] = await Promise.all([
      this.connection
        .collection('stock_items')
        .find(
          { organizationId },
          {
            projection: {
              unit: 1,
              unitConversions: 1,
              costCurrency: 1,
              tracked: 1,
              active: 1,
              kind: 1,
              reorder: 1,
              discreteUnit: 1,
            },
          },
        )
        .limit(MAX_BRIEF_STOCK_ROWS + 1)
        .toArray(),
      this.connection
        .collection('stock_levels')
        .find({ organizationId }, { projection: { itemId: 1, locationId: 1, quantity: 1 } })
        .limit(MAX_BRIEF_STOCK_ROWS + 1)
        .toArray(),
      this.connection
        .collection('stock_pending_lines')
        .countDocuments({ organizationId, status: 'open' }),
    ]);
    return {
      status: 'known',
      items: items.slice(0, MAX_BRIEF_STOCK_ROWS).map((d) =>
        engineItem({
          ...(d as unknown as StockItemLean),
          unitConversions: (d['unitConversions'] ?? []) as StockItemLean['unitConversions'],
          reorder: (d['reorder'] ?? null) as StockItemLean['reorder'],
          preferredSupplierId: null,
          discreteUnit: d['discreteUnit'] === true,
        }),
      ),
      levels: levels.slice(0, MAX_BRIEF_STOCK_ROWS).map((l) => ({
        itemId: String(l['itemId']),
        locationId: String(l['locationId']),
        quantity: qty3(String(l['quantity'])),
      })),
      pendingCount,
      truncated: items.length > MAX_BRIEF_STOCK_ROWS || levels.length > MAX_BRIEF_STOCK_ROWS,
    };
  }
}
