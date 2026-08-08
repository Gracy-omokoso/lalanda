import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId } from '../auth/current-user.decorator.js';
import { AuditService } from './audit.service.js';
import { RequirePermission } from './authz.decorators.js';
import { PermissionsGuard } from './permissions.guard.js';

export interface AuditEventView {
  id: string;
  action: string;
  actorUserId: string;
  actorRole: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

/**
 * Lecture du journal d'audit de l'organisation active (S20a).
 * Réservé à `audit.read` — les rôles de saisie n'ont pas accès au journal qui
 * les surveille (docs/12 § Actions granulaires).
 */
@Controller('audit-events')
@UseGuards(AuthGuard, PermissionsGuard)
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit.read')
  async list(
    @CurrentOrgId() orgId: string,
    @Query('limit') limitRaw?: string,
  ): Promise<{ events: AuditEventView[] }> {
    const limit = Number.parseInt(limitRaw ?? '', 10);
    const docs = await this.audit.listForOrg(orgId, Number.isFinite(limit) ? limit : 100);
    return {
      events: docs.map((d) => ({
        id: String(d._id),
        action: d.action,
        actorUserId: d.actorUserId,
        actorRole: d.actorRole,
        targetType: d.targetType,
        targetId: d.targetId,
        metadata: d.metadata ?? {},
        createdAt: (d as unknown as { createdAt: Date }).createdAt.toISOString(),
      })),
    };
  }
}
