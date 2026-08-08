import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditEvent, type AuditEventDocument } from './audit-event.schema.js';

export interface AuditRecordInput {
  organizationId: string;
  actorUserId: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Écriture et lecture du journal d'audit (S20a).
 *
 * `record()` NE FAIT PAS ÉCHOUER l'action journalisée : un export réussi dont la
 * trace n'a pas pu être écrite reste un export réussi, mais l'incident est visible
 * dans les logs serveur. Le compromis inverse (refuser l'export) serait un déni de
 * service sur une panne de journal — docs/17 § Journalisation ne l'exige pas.
 */
@Injectable()
export class AuditService {
  constructor(@InjectModel(AuditEvent.name) private readonly events: Model<AuditEventDocument>) {}

  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.events.create({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata ?? {},
        _schemaVersion: 1,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[audit] écriture impossible', {
        action: input.action,
        organizationId: input.organizationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Derniers événements d'une organisation — jamais inter-organisations. */
  async listForOrg(organizationId: string, limit = 100): Promise<AuditEventDocument[]> {
    return this.events
      .find({ organizationId })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 500))
      .exec();
  }
}
