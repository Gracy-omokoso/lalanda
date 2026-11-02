// ─────────────────────────────────────────────────────────────────────────────
// ROUTES DU JOURNAL PLATEFORME ET DE LA SÉCURITÉ (ADR-0053 § 6.5, § 7 — lot P5)
//
//   GET /admin/audit-events             platform.audit.read    filtres, page, curseur
//   GET /admin/audit-events/export.csv  platform.audit.export  motif, journalisé, 10/h
//   GET /admin/security-events          platform.audit.read    comptes par jour
//
// Portée PLATEFORME seulement : `PlatformAuditService` borne chaque lecture à la
// sentinelle `organizationId: 'platform'`. Le journal d'une organisation n'est servi
// que par `/audit-events`, à ses membres (décision ouverte n° 11) — rien ici ne le lit.
//
// L'export est une LECTURE (le § 7 ne le marque pas « ré-auth ») : il exige un motif de
// la liste du § 2.6, s'inscrit au journal (`platform.audit.exported`) AVANT d'être servi
// — une trace manquée fait échouer l'export, jamais l'inverse — et est limité en débit.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Types } from 'mongoose';

import {
  PLATFORM_AUDIT_EXPORTED_ACTION,
  PLATFORM_AUDIT_LIMITS,
  PlatformAuditExportQuerySchema,
  PlatformAuditQuerySchema,
  PlatformSecurityQuerySchema,
  type PlatformSecuritySummaryView,
} from '@lalanda/shared/platform';

import type { AuthenticatedRequest } from '../../auth/auth.guard.js';
import { PlatformConsoleRoute, RequirePlatformAction } from '../../authz/authz.decorators.js';
import { AuthzService } from '../../authz/authz.service.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { PlatformAuthGuard } from '../../authz/platform-auth.guard.js';
import {
  PlatformAuditService,
  type PlatformAuditFilter,
} from '../../integrations/platform-audit.service.js';
import { invalidBody } from '../admin.dto.js';
import { PlatformAuditExportThrottlerGuard } from './audit-export-throttler.guard.js';
import {
  decodeCursor,
  encodeCursor,
  platformAuditCsv,
  platformAuditCsvFilename,
  resolvePeriod,
  toAuditEventView,
  type PlatformAuditEventView,
} from './audit-view.js';
import { securityPeriod } from './security-events.js';
import { SecurityEventsService } from './security-events.service.js';

@Controller('admin')
@UseGuards(PlatformAuthGuard, PermissionsGuard)
@PlatformConsoleRoute()
@RequirePlatformAction('platform.audit.read')
export class AdminAuditController {
  constructor(
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
    @Inject(SecurityEventsService) private readonly security: SecurityEventsService,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  @Get('audit-events')
  @RequirePlatformAction('platform.audit.read')
  async auditEvents(
    @Query() query: Record<string, unknown>,
  ): Promise<{ events: PlatformAuditEventView[]; nextCursor: string | null }> {
    const parsed = PlatformAuditQuerySchema.safeParse(query ?? {});
    if (!parsed.success) throw invalidBody(parsed.error, 'Filtres du journal invalides.');
    const { before, limit, ...reste } = parsed.data;
    const filter = this.filterOf(reste);
    if (before) {
      const curseur = decodeCursor(before);
      if (!curseur) throw badFilter('Curseur invalide.');
      filter.before = { createdAt: curseur.createdAt, id: new Types.ObjectId(curseur.id) };
    }
    const { events, hasMore } = await this.audit.query(
      filter,
      limit ?? PLATFORM_AUDIT_LIMITS.pageDefault,
    );
    const views = events.map(toAuditEventView);
    const dernier = views[views.length - 1];
    return { events: views, nextCursor: hasMore && dernier ? encodeCursor(dernier) : null };
  }

  @Get('audit-events/export.csv')
  @RequirePlatformAction('platform.audit.export')
  @UseGuards(PlatformAuditExportThrottlerGuard)
  async exportCsv(
    @Req() req: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const parsed = PlatformAuditExportQuerySchema.safeParse(query ?? {});
    if (!parsed.success) {
      throw invalidBody(
        parsed.error,
        'Motif de l’export obligatoire (assistance, facturation, sécurité, abus, demande légale).',
      );
    }
    const { reason, ...reste } = parsed.data;
    const filter = this.filterOf(reste);
    const max = PLATFORM_AUDIT_LIMITS.exportMaxRows;
    const { events, hasMore } = await this.audit.query(filter, max);
    const views = events.map(toAuditEventView);

    const roles = await this.authz.platformRolesOf(req.user!.id);
    await this.audit.record({
      actorUserId: req.user!.id,
      actorRole: roles.join(',') || 'aucun',
      action: PLATFORM_AUDIT_EXPORTED_ACTION,
      targetType: 'platform_audit',
      targetId: 'platform',
      metadata: {
        reason,
        rowCount: views.length,
        truncated: hasMore,
        filterAction: reste.action ?? null,
        filterActorUserId: reste.actorUserId ?? null,
        filterTargetType: reste.targetType ?? null,
        filterTargetId: reste.targetId ?? null,
        filterFrom: reste.from ?? null,
        filterTo: reste.to ?? null,
      },
    });

    const body = Buffer.from(platformAuditCsv(views), 'utf8');
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader(
      'content-disposition',
      `attachment; filename="${platformAuditCsvFilename(new Date())}"`,
    );
    res.setHeader('content-length', String(body.byteLength));
    res.setHeader('cache-control', 'no-store');
    // Lu par l'écran : « export tronqué, resserrez les filtres ».
    res.setHeader('x-export-truncated', hasMore ? '1' : '0');
    res.end(body);
  }

  @Get('security-events')
  @RequirePlatformAction('platform.audit.read')
  async securityEvents(
    @Query() query: Record<string, unknown>,
  ): Promise<PlatformSecuritySummaryView> {
    const parsed = PlatformSecurityQuerySchema.safeParse(query ?? {});
    if (!parsed.success) throw invalidBody(parsed.error, 'Période invalide.');
    const periode = securityPeriod(parsed.data.from, parsed.data.to, new Date());
    if (!periode.ok) throw badFilter(periode.message);
    return this.security.summary(periode);
  }

  /** Filtres validés → filtre de requête ; période `from` après `to` refusée. */
  private filterOf(f: {
    action?: string;
    actorUserId?: string;
    targetType?: string;
    targetId?: string;
    from?: string;
    to?: string;
  }): PlatformAuditFilter {
    const periode = resolvePeriod(f.from, f.to);
    if (periode.from && periode.to && periode.from >= periode.to) {
      throw badFilter('Le début de la période doit précéder sa fin.');
    }
    const filter: PlatformAuditFilter = {};
    if (f.action) filter.action = f.action;
    if (f.actorUserId) filter.actorUserId = f.actorUserId;
    if (f.targetType) filter.targetType = f.targetType;
    if (f.targetId) filter.targetId = f.targetId;
    if (periode.from) filter.from = periode.from;
    if (periode.to) filter.to = periode.to;
    return filter;
  }
}

function badFilter(message: string): BadRequestException {
  return new BadRequestException({ code: 'VALIDATION_ERROR', message });
}
