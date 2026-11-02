// Maintenance et couvertures des équipements — ADR-0046 § 3.3, § 3.4, § 5.2. ADR-0046 — S5.
//
//   GET    /assets/:assetId/maintenance                        assets.read
//   POST   /assets/:assetId/maintenance                        assets.manage
//   PUT    /assets/:assetId/maintenance/:maintenanceId         assets.manage
//   POST   /assets/:assetId/maintenance/:maintenanceId/done    assets.manage
//   GET    /assets/:assetId/coverages                          assets.read
//   POST   /assets/:assetId/coverages                          assets.manage
//   PUT    /assets/:assetId/coverages/:coverageId              assets.manage
//   DELETE /assets/:assetId/coverages/:coverageId              assets.manage

import {
  CompleteMaintenanceBody,
  CreateCoverageBody,
  CreateMaintenanceBody,
  UpdateCoverageBody,
  UpdateMaintenanceBody,
  type AssetCoverageView,
  type AssetListOf,
  type AssetMaintenanceView,
} from '@lalanda/shared/assets';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../../authz/current-org-permissions.decorator.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { assetActorOf, assetReaderOf } from '../registry/assets.controller.js';
import { AssetMaintenanceService } from './asset-maintenance.service.js';
import { RequireFeature } from '../../billing/feature.guard.js';

@Controller('assets/:assetId')
@RequireFeature('assets') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class AssetMaintenanceController {
  constructor(@Inject(AssetMaintenanceService) private readonly service: AssetMaintenanceService) {}

  @Get('maintenance')
  @RequirePermission('assets.read')
  async listMaintenance(
    @CurrentOrgId() orgId: string,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('assetId') assetId: string,
  ): Promise<AssetListOf<AssetMaintenanceView>> {
    return this.service.listMaintenance(orgId, assetId, assetReaderOf(perms));
  }

  @Post('maintenance')
  @RequirePermission('assets.manage')
  async createMaintenance(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('assetId') assetId: string,
    @Body() body: unknown,
  ): Promise<AssetMaintenanceView> {
    const parsed = CreateMaintenanceBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.service.createMaintenance(
      orgId,
      assetId,
      parsed.data,
      assetActorOf(user, role),
      assetReaderOf(perms),
    );
  }

  @Put('maintenance/:maintenanceId')
  @RequirePermission('assets.manage')
  async updateMaintenance(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('assetId') assetId: string,
    @Param('maintenanceId') maintenanceId: string,
    @Body() body: unknown,
  ): Promise<AssetMaintenanceView> {
    const parsed = UpdateMaintenanceBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.service.updateMaintenance(
      orgId,
      assetId,
      maintenanceId,
      parsed.data,
      assetActorOf(user, role),
      assetReaderOf(perms),
    );
  }

  @Post('maintenance/:maintenanceId/done')
  @HttpCode(200)
  @RequirePermission('assets.manage')
  async completeMaintenance(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('assetId') assetId: string,
    @Param('maintenanceId') maintenanceId: string,
    @Body() body: unknown,
  ): Promise<AssetMaintenanceView> {
    const parsed = CompleteMaintenanceBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.service.completeMaintenance(
      orgId,
      assetId,
      maintenanceId,
      parsed.data,
      assetActorOf(user, role),
      assetReaderOf(perms),
    );
  }

  @Get('coverages')
  @RequirePermission('assets.read')
  async listCoverages(
    @CurrentOrgId() orgId: string,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('assetId') assetId: string,
  ): Promise<AssetListOf<AssetCoverageView>> {
    return this.service.listCoverages(orgId, assetId, assetReaderOf(perms));
  }

  @Post('coverages')
  @RequirePermission('assets.manage')
  async createCoverage(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('assetId') assetId: string,
    @Body() body: unknown,
  ): Promise<AssetCoverageView> {
    const parsed = CreateCoverageBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.service.createCoverage(
      orgId,
      assetId,
      parsed.data,
      assetActorOf(user, role),
      assetReaderOf(perms),
    );
  }

  @Put('coverages/:coverageId')
  @RequirePermission('assets.manage')
  async updateCoverage(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('assetId') assetId: string,
    @Param('coverageId') coverageId: string,
    @Body() body: unknown,
  ): Promise<AssetCoverageView> {
    const parsed = UpdateCoverageBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.service.updateCoverage(
      orgId,
      assetId,
      coverageId,
      parsed.data,
      assetActorOf(user, role),
      assetReaderOf(perms),
    );
  }

  @Delete('coverages/:coverageId')
  @RequirePermission('assets.manage')
  async removeCoverage(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('assetId') assetId: string,
    @Param('coverageId') coverageId: string,
  ): Promise<{ deleted: true }> {
    return this.service.removeCoverage(orgId, assetId, coverageId, assetActorOf(user, role));
  }
}
