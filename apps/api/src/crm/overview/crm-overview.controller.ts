// Fiche 360° et fil chronologique d'un compte — ADR-0040 § 3.1.2 et § 3.1.3.
// ADR-0040 — C8.
//
// `crm.read` pour la route ; chaque section ou source exige en plus son droit
// (`sales.read`, `work.read`) et, sans lui, est rendue `hidden` (signalée, jamais
// remplie de zéros). Un compte d'une autre organisation répond 404.

import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { NO_OVERRIDES, type OrgRole } from '../../authz/permissions.js';
import { overviewAccessOf, timelineSourcesOf, type OverviewAccess } from './crm-overview.model.js';
import { CrmOverviewService } from './crm-overview.service.js';
import type { CrmOverview, TimelinePage } from './crm-overview.types.js';

const NO_ACCESS: OverviewAccess = { sales: false, work: false };

function accessOf(role: OrgRole | undefined): OverviewAccess {
  // ADR-0041 A3 : passer aux droits effectifs du membre
  return role ? overviewAccessOf(role, NO_OVERRIDES) : NO_ACCESS;
}

@Controller('crm/accounts')
@UseGuards(AuthGuard, PermissionsGuard)
export class CrmOverviewController {
  constructor(@Inject(CrmOverviewService) private readonly overviews: CrmOverviewService) {}

  @Get(':accountId/overview')
  @RequirePermission('crm.read')
  async overview(
    @CurrentOrgId() orgId: string,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('accountId') accountId: string,
  ): Promise<CrmOverview> {
    return this.overviews.overview(orgId, accountId, accessOf(role));
  }

  @Get(':accountId/timeline')
  @RequirePermission('crm.read')
  async timeline(
    @CurrentOrgId() orgId: string,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('accountId') accountId: string,
    @Query('cursor') cursor: unknown,
    @Query('types') types: unknown,
  ): Promise<TimelinePage> {
    const sources = timelineSourcesOf(types, accessOf(role));
    if (!sources) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message:
          'Paramètre `types` invalide : activity, opportunity, account, quote, invoice, receipt, project.',
      });
    }
    if (cursor !== undefined && typeof cursor !== 'string') {
      throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'Curseur illisible.' });
    }
    return this.overviews.timeline(orgId, accountId, sources, cursor || undefined);
  }
}
