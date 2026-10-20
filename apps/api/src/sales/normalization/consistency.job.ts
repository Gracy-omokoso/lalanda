// Contrôle quotidien de cohérence des factures — ADR-0024 § 4.3.
//
// Tâche `sales.normalization.consistency`, une fois par jour. Elle ne CORRIGE
// rien : elle signale (journal serveur, audit) ce qui ne devrait jamais
// exister, pour qu'une personne enquête :
//  - un document `normalized` sans ses éléments de sécurité (impossible par
//    construction — le verrou l'affiche « Pro forma ») ;
//  - une facture `issued` dont `issuedAt` suit la première activation de la
//    facture normalisée de l'organisation (fenêtre résiduelle d'ADR-0023) ;
//  - un numéro réservé depuis plus de 24 h.

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { SchedulerService } from '../../scheduler/scheduler.service.js';
import { NormalizationRecorder } from './normalization-recorder.js';

export const CONSISTENCY_JOB = 'sales.normalization.consistency';
export const CONSISTENCY_EVERY_MS = 24 * 3600_000;
const RESERVED_TOO_LONG_MS = 24 * 3600_000;
const LIMIT = 200;

export interface ConsistencyReport {
  normalizedWithoutSecurity: string[];
  issuedAfterActivation: string[];
  reservedTooLong: string[];
}

@Injectable()
export class NormalizationConsistencyJob implements OnModuleInit {
  private readonly logger = new Logger('Normalisation');

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(NormalizationRecorder) private readonly recorder: NormalizationRecorder,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(CONSISTENCY_JOB, CONSISTENCY_EVERY_MS, async (_payload, ctx) => {
      await this.run(ctx.now);
    });
  }

  async run(now: Date = new Date()): Promise<ConsistencyReport> {
    const report: ConsistencyReport = {
      normalizedWithoutSecurity: [],
      issuedAfterActivation: [],
      reservedTooLong: [],
    };
    for (const doc of await this.recorder.findNormalizedWithoutSecurity(LIMIT)) {
      report.normalizedWithoutSecurity.push(String(doc._id));
      await this.signal('normalized_without_security', doc.organizationId, String(doc._id));
    }
    const cutoff = new Date(now.getTime() - RESERVED_TOO_LONG_MS);
    for (const doc of await this.recorder.findReservedSince(cutoff, LIMIT)) {
      report.reservedTooLong.push(String(doc._id));
      await this.signal('number_reserved_too_long', doc.organizationId, String(doc._id));
    }
    const activated = await this.connection
      .collection<{ organizationId: string; firstActivatedAt: Date | null }>(
        'normalized_invoicing_settings',
      )
      .find(
        { firstActivatedAt: { $type: 'date' } },
        { projection: { organizationId: 1, firstActivatedAt: 1 } },
      )
      .toArray();
    for (const row of activated) {
      if (!row.firstActivatedAt) continue;
      for (const doc of await this.recorder.findIssuedAfter(
        row.organizationId,
        row.firstActivatedAt,
        LIMIT,
      )) {
        report.issuedAfterActivation.push(String(doc._id));
        await this.signal('issued_after_activation', doc.organizationId, String(doc._id));
      }
    }
    return report;
  }

  private async signal(code: string, organizationId: string, invoiceId: string): Promise<void> {
    this.logger.error(
      `ALERTE cohérence ${code} : document ${invoiceId} (organisation ${organizationId}).`,
    );
    await this.audit.record({
      organizationId,
      actorUserId: 'system:scheduler',
      actorRole: 'system',
      action: `sales_invoice.consistency.${code}`,
      targetType: 'sales_invoice',
      targetId: invoiceId,
    });
  }
}
