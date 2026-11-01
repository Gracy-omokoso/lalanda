// « À comptabiliser » (`accounting_pending`, ADR-0049 § 2.7). ADR-0049 — K5.
//
// Une pièce que la synchronisation n'a pas pu passer proprement, avec son motif
// (`NO_TREASURY_ACCOUNT`, `RATE_MISSING`, `PERIOD_CLOSED`,
// `SOURCE_CHANGED_IN_CLOSED_PERIOD`, `UNSUPPORTED_SOURCE`). Une ligne `open` par pièce et
// par motif ; elle se referme d'elle-même quand le motif disparaît, ou par une revue
// humaine motivée (`POST /accounting/pending/:id/resolve`).

import type { AccountingPendingReason } from '@lalanda/shared/accounting';
import { Schema as MongooseSchema, type Types } from 'mongoose';

export type AccountingPendingLean = {
  _id: Types.ObjectId;
  organizationId: string;
  source: { kind: string; id: string; number: string | null; date: string };
  reason: AccountingPendingReason;
  status: 'open' | 'resolved';
  entryId: string | null;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolution: string | null;
  revision: number;
  _schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export class AccountingPending {}
export const AccountingPendingSchema = new MongooseSchema(
  {
    organizationId: { type: String, required: true },
    source: { type: Object, required: true },
    reason: { type: String, required: true },
    status: { type: String, required: true, enum: ['open', 'resolved'] },
    entryId: { type: String, default: null },
    lastSeenAt: { type: Date, required: true },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: null },
    resolution: { type: String, default: null },
    revision: { type: Number, required: true, default: 1 },
    _schemaVersion: { type: Number, required: true, default: 1 },
  },
  { collection: 'accounting_pending', timestamps: true, strict: true, minimize: false },
);
AccountingPendingSchema.index(
  { organizationId: 1, 'source.kind': 1, 'source.id': 1, reason: 1 },
  { unique: true, partialFilterExpression: { status: 'open' }, name: 'open_pending_unique' },
);
AccountingPendingSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
