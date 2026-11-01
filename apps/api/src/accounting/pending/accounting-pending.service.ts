// « À comptabiliser » (ADR-0049 § 2.7, § 11). ADR-0049 — K5.
//
// La synchronisation inscrit ici chaque pièce qu'elle n'a pas pu passer proprement, avec
// son motif, et referme d'elle-même une ligne dont le motif a disparu (taux saisi,
// compte de trésorerie rattaché…). `SOURCE_CHANGED_IN_CLOSED_PERIOD` ne se referme jamais
// seul : la contre-passation au premier jour ouvert appelle une revue humaine (§ 4).

import {
  ACCOUNTING_PENDING_REASONS,
  type AccountingPendingReason,
  type AccountingPendingView,
} from '@lalanda/shared/accounting';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { conflict, isDuplicateKey, notFound, toIso, type AccountingActor } from '../accounting.common.js';
import { AccountingPending, type AccountingPendingLean } from './accounting-pending.schema.js';

export interface PendingSource {
  kind: string;
  id: string;
  number: string | null;
  date: string;
}

/** Motif du moteur → motif d'« À comptabiliser » ; un motif inconnu devient `UNSUPPORTED_SOURCE`. */
export function pendingReasonOf(reason: string): AccountingPendingReason {
  return (ACCOUNTING_PENDING_REASONS as readonly string[]).includes(reason)
    ? (reason as AccountingPendingReason)
    : 'UNSUPPORTED_SOURCE';
}

/** Motifs refermés par la seule disparition de leur cause. */
const SELF_CLOSING: readonly AccountingPendingReason[] = [
  'NO_TREASURY_ACCOUNT',
  'RATE_MISSING',
  'PERIOD_CLOSED',
  'UNSUPPORTED_SOURCE',
];

export function pendingView(d: AccountingPendingLean): AccountingPendingView {
  return {
    id: String(d._id),
    reason: d.reason,
    status: d.status,
    source: {
      kind: d.source.kind as AccountingPendingView['source']['kind'],
      id: d.source.id,
      number: d.source.number,
      date: d.source.date,
    },
    entryId: d.entryId,
    createdAt: new Date(d.createdAt).toISOString(),
    lastSeenAt: new Date(d.lastSeenAt).toISOString(),
    resolvedAt: toIso(d.resolvedAt),
    resolvedBy: d.resolvedBy,
    resolution: d.resolution,
  };
}

@Injectable()
export class AccountingPendingService {
  constructor(
    @InjectModel(AccountingPending.name) private readonly pending: Model<AccountingPendingLean>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * État « À comptabiliser » d'une pièce après sa synchronisation : ouvre les motifs
   * présents, referme ceux qui ont disparu (sauf ceux qui exigent une revue humaine).
   */
  async reconcile(
    organizationId: string,
    source: PendingSource,
    reasons: readonly { reason: AccountingPendingReason; entryId?: string | null }[],
    now: Date,
  ): Promise<number> {
    const present = new Set(reasons.map((r) => r.reason));
    for (const r of reasons) {
      try {
        await this.pending
          .updateOne(
            {
              organizationId,
              'source.kind': source.kind,
              'source.id': source.id,
              reason: r.reason,
              status: 'open',
            },
            {
              $set: { lastSeenAt: now, source, ...(r.entryId ? { entryId: r.entryId } : {}) },
              $setOnInsert: {
                organizationId,
                reason: r.reason,
                status: 'open',
                resolvedAt: null,
                resolvedBy: null,
                resolution: null,
                revision: 1,
                _schemaVersion: 1,
                ...(r.entryId ? {} : { entryId: null }),
              },
            },
            { upsert: true },
          )
          .exec();
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
      }
    }
    const stale = SELF_CLOSING.filter((r) => !present.has(r));
    if (stale.length > 0) {
      await this.pending
        .updateMany(
          {
            organizationId,
            'source.kind': source.kind,
            'source.id': source.id,
            status: 'open',
            reason: { $in: stale },
          },
          {
            $set: { status: 'resolved', resolvedAt: now, resolvedBy: 'system', resolution: 'Motif disparu à la synchronisation.' },
            $inc: { revision: 1 },
          },
        )
        .exec();
    }
    return reasons.length;
  }

  /** Pièces dont une ligne ouverte se referme seule : relues à chaque synchronisation. */
  async openSources(organizationId: string): Promise<PendingSource[]> {
    const docs = await this.pending
      .find({ organizationId, status: 'open', reason: { $in: SELF_CLOSING } })
      .lean<AccountingPendingLean[]>()
      .exec();
    return docs.map((d) => d.source);
  }

  async list(organizationId: string, limit = 200): Promise<{ items: AccountingPendingView[]; nextCursor: null }> {
    const docs = await this.pending
      .find({ organizationId, status: 'open' })
      .sort({ 'source.date': -1, _id: -1 })
      .limit(limit)
      .lean<AccountingPendingLean[]>()
      .exec();
    return { items: docs.map(pendingView), nextCursor: null };
  }

  async countOpen(organizationId: string): Promise<number> {
    return this.pending.countDocuments({ organizationId, status: 'open' }).exec();
  }

  /** Revue humaine motivée (`accounting.post`). */
  async resolve(
    organizationId: string,
    id: string,
    note: string,
    actor: AccountingActor,
  ): Promise<AccountingPendingView> {
    if (!/^[0-9a-f]{24}$/i.test(id)) notFound('PENDING_NOT_FOUND', 'Pièce à comptabiliser introuvable.');
    const current = await this.pending.findOne({ _id: id, organizationId }).lean<AccountingPendingLean>().exec();
    if (!current) notFound('PENDING_NOT_FOUND', 'Pièce à comptabiliser introuvable.');
    if (current.status !== 'open') conflict('PENDING_ALREADY_RESOLVED', 'Cette pièce a déjà été revue.');
    const updated = await this.pending
      .findOneAndUpdate(
        { _id: id, organizationId, status: 'open' },
        {
          $set: { status: 'resolved', resolvedAt: new Date(), resolvedBy: actor.userId, resolution: note },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<AccountingPendingLean>()
      .exec();
    if (!updated) conflict('PENDING_ALREADY_RESOLVED', 'Cette pièce a déjà été revue.');
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.pending_resolved',
      targetType: 'accounting_pending',
      targetId: id,
      metadata: { reason: current.reason, sourceKind: current.source.kind },
    });
    return pendingView(updated);
  }
}
