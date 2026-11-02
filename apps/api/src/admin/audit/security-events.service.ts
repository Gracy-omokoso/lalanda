// Événements de sécurité agrégés (ADR-0053 § 6.5 — lot P5).
//
// Deux sources, jamais un événement individuel servi :
//   - les compteurs `platform_security_counters`, incrémentés par
//     `SecurityEventsMiddleware` à partir des réponses de l'API ;
//   - le journal plateforme, compté par jour (blocages, rôles, exports).
// Plus un instantané : le nombre de comptes bloqués à l'instant de la lecture.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import type { PlatformSecuritySummaryView } from '@lalanda/shared/platform';

import { PlatformAuditService } from '../../integrations/platform-audit.service.js';
import {
  PlatformSecurityCounter,
  type PlatformSecurityCounterDocument,
} from './security-counter.schema.js';
import {
  SECURITY_AUDIT_ACTIONS,
  buildSecuritySummary,
  utcDay,
  type SecurityCounterKind,
} from './security-events.js';

@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger('SecurityEvents');

  constructor(
    @InjectModel(PlatformSecurityCounter.name)
    private readonly counters: Model<PlatformSecurityCounterDocument>,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Incrément atomique, sans attente de l'appelant : un compteur perdu (base
   * indisponible) ne doit jamais faire échouer la requête observée. L'échec est consigné.
   */
  increment(kind: SecurityCounterKind, now: Date = new Date()): Promise<void> {
    return this.counters
      .updateOne(
        { day: utcDay(now), kind },
        { $inc: { count: 1 }, $setOnInsert: { _schemaVersion: 1 } },
        { upsert: true },
      )
      .exec()
      .then(
        () => undefined,
        (err: unknown) => {
          this.logger.warn(`Compteur de sécurité perdu (${kind}) : ${String(err)}`);
        },
      );
  }

  async summary(period: {
    from: string;
    to: string;
    start: Date;
    end: Date;
  }): Promise<PlatformSecuritySummaryView> {
    const [counters, audit, blockedAccountsNow] = await Promise.all([
      this.counters
        .find({ day: { $gte: period.from, $lte: period.to } })
        .select({ day: 1, kind: 1, count: 1 })
        .lean()
        .exec(),
      this.audit.countByDay([...SECURITY_AUDIT_ACTIONS.keys()], period.start, period.end),
      // Champ hors schéma better-auth, lu par le driver natif (comme `PlatformAuthGuard`).
      this.connection.db!.collection('user').countDocuments({ disabledAt: { $ne: null } }),
    ]);
    return buildSecuritySummary({
      from: period.from,
      to: period.to,
      counters: counters.map((c) => ({ day: c.day, kind: c.kind, count: c.count })),
      audit,
      blockedAccountsNow,
    });
  }
}
