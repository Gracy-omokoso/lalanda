// Référentiel des postes — ADR-0068 § 3.
//
//   GET  /hr/positions?status=            hr.read
//   GET  /hr/positions/:positionId        hr.read   (historique des titulaires)
//   POST /hr/positions                    hr.manage (poste vacant, `POS-001`)
//   PUT  /hr/positions/:positionId        hr.manage
//   POST /hr/positions/:positionId/delete hr.manage (vacant seulement ; numéro réservé)

import {
  CreatePositionBody,
  ListPositionsQuery,
  PositionRevisionBody,
  UpdatePositionBody,
  type PositionDetailView,
  type PositionListView,
} from '@lalanda/shared/hr';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { RequireFeature } from '../../billing/feature.guard.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import { HrPositionsService } from './hr-positions.service.js';

const actorOf = (user: { id: string }, role: OrgRole | undefined): HrActor => ({
  userId: user.id,
  role: role ?? 'unknown',
});

@Controller('hr/positions')
@RequireFeature('hr')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrPositionsController {
  constructor(@Inject(HrPositionsService) private readonly positions: HrPositionsService) {}

  @Get()
  @RequirePermission('hr.read')
  async list(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<PositionListView> {
    const parsed = ListPositionsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.positions.list(orgId, parsed.data);
  }

  @Get(':positionId')
  @RequirePermission('hr.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('positionId') positionId: string,
  ): Promise<PositionDetailView> {
    return this.positions.get(orgId, positionId);
  }

  @Post()
  @RequirePermission('hr.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<PositionDetailView> {
    const parsed = CreatePositionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Poste invalide.');
    return this.positions.create(orgId, parsed.data, actorOf(user, role));
  }

  @Put(':positionId')
  @RequirePermission('hr.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('positionId') positionId: string,
    @Body() body: unknown,
  ): Promise<PositionDetailView> {
    const parsed = UpdatePositionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Poste invalide.');
    return this.positions.update(orgId, positionId, parsed.data, actorOf(user, role));
  }

  @Post(':positionId/delete')
  @HttpCode(200)
  @RequirePermission('hr.manage')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('positionId') positionId: string,
    @Body() body: unknown,
  ): Promise<PositionDetailView> {
    const parsed = PositionRevisionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.positions.remove(
      orgId,
      positionId,
      parsed.data.expectedRevision,
      actorOf(user, role),
    );
  }
}
