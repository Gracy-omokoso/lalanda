// Collection `stock_sync_checkpoints` — points des rattrapages (ADR-0046 § 1, § 6.1,
// § 6.2). ADR-0046 — S4.
//
// Un point par organisation et par source (`purchases`, `sales`) : instant à partir
// duquel le passage suivant relit (moins un recouvrement). Point initial : l'activation
// des stocks (`stock_settings.createdAt`) — rien d'antérieur n'est rejoué.

import { Schema as MongooseSchema, type Types } from 'mongoose';

export const STOCK_SYNC_SOURCES = ['purchases', 'sales'] as const;
export type StockSyncSource = (typeof STOCK_SYNC_SOURCES)[number];

export type StockSyncCheckpointLean = {
  _id: Types.ObjectId;
  organizationId: string;
  source: StockSyncSource;
  since: Date;
  lastRunAt: Date | null;
  _schemaVersion: number;
};

export class StockSyncCheckpoint {}
export const StockSyncCheckpointSchema = new MongooseSchema(
  {
    organizationId: { type: String, required: true },
    source: { type: String, required: true, enum: STOCK_SYNC_SOURCES },
    since: { type: Date, required: true },
    lastRunAt: { type: Date, default: null },
    _schemaVersion: { type: Number, required: true, default: 1 },
  },
  { collection: 'stock_sync_checkpoints', strict: true, minimize: false },
);
StockSyncCheckpointSchema.index({ organizationId: 1, source: 1 }, { unique: true });
