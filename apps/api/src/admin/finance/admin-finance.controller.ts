// Finances du site (ADR-0053 § 6.8, § 7 — lot P7).
//
// GET /admin/finance?from=AAAA-MM&to=AAAA-MM   platform.finance.read
// GET /admin/finance/export.csv?from=&to=      platform.finance.export (journalisé)
//
// Garde de CONSOLE : `PlatformAuthGuard` puis `PermissionsGuard` (super-administrateur et
// finance seuls, § 5.2). Lecture et export sans ré-authentification : le § 7 n'en
// demande pas, et l'export est inscrit au journal plateforme (`platform.finance.exported`)
// avec l'acteur réel et ses rôles RELUS.
//
// Vocabulaire (décision ouverte n° 14, défaut) : « encaissements constatés », « revenu
// récurrent déclaré » ; jamais « chiffre d'affaires », « facturé » ni « TVA ».

import { Controller, Get, Inject, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { platformRevenueCsv, type PlatformRevenueReport } from '@lalanda/engine';

import type { AuthenticatedRequest } from '../../auth/auth.guard.js';
import { PlatformConsoleRoute, RequirePlatformAction } from '../../authz/authz.decorators.js';
import { AuthzService } from '../../authz/authz.service.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { PlatformAuthGuard } from '../../authz/platform-auth.guard.js';
import { PlatformAuditService } from '../../integrations/platform-audit.service.js';
import { AdminFinanceService } from './admin-finance.service.js';

@Controller('admin/finance')
@UseGuards(PlatformAuthGuard, PermissionsGuard)
@PlatformConsoleRoute()
@RequirePlatformAction('platform.finance.read')
export class AdminFinanceController {
  constructor(
    @Inject(AdminFinanceService) private readonly finance: AdminFinanceService,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  @Get()
  @RequirePlatformAction('platform.finance.read')
  async report(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<PlatformRevenueReport> {
    return this.finance.report({ from, to });
  }

  @Get('export.csv')
  @RequirePlatformAction('platform.finance.export')
  async export(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: false }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<void> {
    const report = await this.finance.report({ from, to });
    const csv = platformRevenueCsv(report);
    const roles = await this.authz.platformRolesOf(req.user!.id);
    // Journal AVANT l'envoi : un export non tracé ne part pas (écriture stricte).
    await this.audit.record({
      actorUserId: req.user!.id,
      actorRole: roles.join(',') || 'aucun',
      action: 'platform.finance.exported',
      targetType: 'platform_finance',
      targetId: `${report.period.from}..${report.period.to}`,
      metadata: {
        from: report.period.from,
        to: report.period.to,
        rows: csv.split('\r\n').length - 2,
        engineVersion: report.version,
      },
    });
    const body = Buffer.from(`\uFEFF${csv}`, 'utf8');
    const fileName = `encaissements-constates-${report.period.from}-${report.period.to}.csv`;
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${fileName}"`);
    res.setHeader('content-length', String(body.byteLength));
    res.setHeader('cache-control', 'no-store');
    res.end(body);
  }
}
