// Briques communes des branchements achats et ventes (ADR-0046 § 6.1, § 6.2).
// ADR-0046 — S4.
//
// - `ReadOnlyCollection` : accès en LECTURE SEULE à une collection d'un autre module
//   (`purchase_receptions`, `purchase_orders`, `sales_invoices`). Il n'expose que
//   `find` et `findOne` : le module des stocks ne peut, par construction, rien y écrire
//   (ADR-0046 § 6.2 « jamais d'écriture dans les ventes ni dans le circuit DGI »).
// - `resolveStockItem` : article désigné par une référence de ligne d'achat
//   (`stk:<id>`, sinon code de l'article, sinon rattachement mémorisé, § 2.6, § 6.1).
// - `recordObserved` : écriture idempotente de mouvements CONSTATÉS (mode `observed`)
//   dans une transaction, après `ensureLevels()`, et ouverture des lignes « À traiter »
//   de coût pour les entrées sans coût (§ 2.3.1).

import { stockCodeKey, type OpenStockPendingLineInput } from '@lalanda/shared/stock';
import type { Collection, Document, Filter, FindOptions } from 'mongodb';
import { Types, type Connection, type Model } from 'mongoose';

import { isDuplicateKey } from '../../sales/sales.errors.js';
import { inTransaction, isOid } from '../stock.common.js';
import type { StockMovementDraft, StockMovementsService } from '../stock-movements.service.js';
import type { StockPendingService } from '../stock-pending.service.js';
import type { StockItemLean, StockMovementLean } from '../stock.schemas.js';

/** Lecture seule d'une collection d'un autre module : ni insertion, ni mise à jour. */
export class ReadOnlyCollection<T extends Document> {
  private readonly collection: Collection<T>;

  constructor(connection: Connection, name: string) {
    this.collection = connection.collection<T>(name) as unknown as Collection<T>;
  }

  find(filter: Filter<T>, options?: FindOptions): Promise<T[]> {
    return this.collection.find(filter, options).toArray() as Promise<T[]>;
  }

  findOne(filter: Filter<T>, options?: FindOptions): Promise<T | null> {
    return this.collection.findOne(filter, options) as Promise<T | null>;
  }
}

/** Préfixe d'une référence d'article de stock portée par `itemRef` (§ 6.1). */
export const STOCK_ITEM_REF_PREFIX = 'stk:';

/**
 * Article de stock désigné par `itemRef` dans l'organisation : `stk:<id>`, sinon code
 * de l'article (`codeKey`), sinon rattachement mémorisé par une résolution précédente
 * pour la même commande ; `null` si rien ne correspond (ligne « À traiter »).
 */
export async function resolveStockItem(
  deps: { items: Model<StockItemLean>; pending: StockPendingService },
  organizationId: string,
  orderId: string,
  itemRef: string | null,
): Promise<StockItemLean | null> {
  const ref = itemRef?.trim() ?? '';
  if (ref.toLowerCase().startsWith(STOCK_ITEM_REF_PREFIX)) {
    const id = ref.slice(STOCK_ITEM_REF_PREFIX.length);
    if (isOid(id)) {
      const doc = await deps.items
        .findOne({ _id: new Types.ObjectId(id), organizationId })
        .lean<StockItemLean>()
        .exec();
      if (doc) return doc;
    }
  } else if (ref !== '') {
    const codeKey = stockCodeKey(ref);
    if (codeKey !== null) {
      const doc = await deps.items
        .findOne({ organizationId, codeKey })
        .lean<StockItemLean>()
        .exec();
      if (doc) return doc;
    }
  }
  const remembered = await deps.pending.resolvedItemFor(organizationId, orderId, itemRef);
  if (remembered === null || !isOid(remembered)) return null;
  return deps.items
    .findOne({ _id: new Types.ObjectId(remembered), organizationId })
    .lean<StockItemLean>()
    .exec();
}

export interface ObservedWrite {
  written: StockMovementLean[];
  /** Lignes « À traiter » de coût ouvertes pour les entrées `pending_cost` écrites. */
  pendingCost: number;
}

/**
 * Écrit des mouvements constatés (jamais refusés, O4) : niveaux créés hors transaction,
 * puis `record()` dans une transaction. Rejouer ne réécrit rien (`sourceKey`) ; deux
 * écrivains concurrents (accroche R3 et rattrapage) : le perdant bute sur l'index unique
 * et rejoue une fois, il trouve alors les clés déjà écrites.
 */
export async function recordObserved(
  deps: { connection: Connection; ledger: StockMovementsService; pending: StockPendingService },
  organizationId: string,
  drafts: readonly StockMovementDraft[],
  costProposal: (m: StockMovementLean) => OpenStockPendingLineInput | null,
): Promise<ObservedWrite> {
  if (drafts.length === 0) return { written: [], pendingCost: 0 };
  await deps.ledger.ensureLevels(organizationId, drafts);
  const attempt = () =>
    inTransaction(deps.connection, async (session) => {
      const result = await deps.ledger.record(organizationId, drafts, {
        mode: 'observed',
        actorUserId: 'system',
        session,
      });
      let pendingCost = 0;
      for (const m of result.written) {
        if (m.costStatus !== 'pending_cost') continue;
        const input = costProposal(m);
        if (input === null) continue;
        const opened = await deps.pending.open(organizationId, input, 'system', session);
        if (opened.created) pendingCost += 1;
      }
      return { written: result.written, pendingCost };
    });
  try {
    return await attempt();
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    return attempt();
  }
}
