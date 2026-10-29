// Rapports du CRM — ADR-0040 § 3.4. ADR-0040 — C3.
//
// `GET /crm/reports?from=&to=&ownerId=me|<id>` sous `crm.read` (comme le
// pipeline : tout détenteur de `crm.read` voit toute l'organisation, le filtre
// responsable n'est qu'un confort, décision ouverte n° 9). Organisation active
// seulement ; période par défaut 12 mois glissants, 24 au plus
// (`400 CRM_REPORT_PERIOD_TOO_LONG`).

import { CrmReportsQuery, type CrmReportsView } from '@lalanda/shared/crm';
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { CrmReportsService } from './crm-reports.service.js';

@Controller('crm/reports')
@UseGuards(AuthGuard, PermissionsGuard)
export class CrmReportsController {
  constructor(@Inject(CrmReportsService) private readonly reportsService: CrmReportsService) {}

  @Get()
  @RequirePermission('crm.read')
  async reports(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @Query() query: unknown,
  ): Promise<CrmReportsView> {
    const parsed = CrmReportsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de rapport invalides.');
    const { from, to, ownerId } = parsed.data;
    return this.reportsService.reports(orgId, {
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      ownerId: ownerId === 'me' ? user.id : (ownerId ?? null),
    });
  }
}
