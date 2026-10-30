// Rapports RH et registre exporté — ADR-0045 § 3.3, § 7. ADR-0045 — H5.
//
//   GET /hr/reports?from=&to=&departmentId=      hr.read
//   GET /hr/reports/export.csv?departmentId=     hr.read + report.export (audit strict)
//
// Aucune donnée salariale, aucune donnée sensible, aucun type d'absence nommé.

import { HrRegisterExportQuery, HrReportsQuery, type HrReportsView } from '@lalanda/shared/hr';
import { Controller, Get, Inject, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { sendCsv } from '../../crm/crm-actor.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { HrReportsService } from './hr-reports.service.js';

@Controller('hr/reports')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrReportsController {
  constructor(@Inject(HrReportsService) private readonly reportsService: HrReportsService) {}

  @Get()
  @RequirePermission('hr.read')
  async reports(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<HrReportsView> {
    const parsed = HrReportsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres du rapport invalides.');
    return this.reportsService.reports(orgId, parsed.data);
  }

  @Get('export.csv')
  @RequirePermission('hr.read', 'report.export')
  async exportRegister(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Query() query: unknown,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const parsed = HrRegisterExportQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de l’export invalides.');
    sendCsv(
      res,
      await this.reportsService.exportRegister(orgId, parsed.data, {
        userId: user.id,
        role: role ?? 'unknown',
      }),
    );
  }
}
