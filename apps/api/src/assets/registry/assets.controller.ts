// Registre des équipements — ADR-0046 § 5.2. ADR-0046 — S5.
//
//   GET  /assets?status=&categoryId=&employeeId=&workProjectId=&supplierId=   assets.read
//   GET  /assets/deadlines?within=                                           assets.read
//   GET  /assets/reports?on=                                                 assets.read
//   GET  /assets/export.csv                            assets.read + report.export (audit strict)
//   GET  /assets/:assetId?on=                                                assets.read
//   POST /assets                                                             assets.manage
//   PUT  /assets/:assetId                                                    assets.manage
//   POST /assets/:assetId/dispose · /reinstate                               assets.manage
//   POST /assets/:assetId/assign · /return                                   assets.manage
//   GET  /assets/:assetId/assignments                                        assets.read
//
// Valeurs (coûts, estimation de gestion) servies seulement si l'appelant détient aussi
// `purchase.read` ou `treasury.read` en droits EFFECTIFS (`canSeeStockValues`).
// Un équipement d'une autre organisation : 404.

import {
  AssetDeadlinesQuery,
  AssetReportsQuery,
  AssignAssetBody,
  CreateAssetBody,
  DisposeAssetBody,
  GetAssetQuery,
  ListAssetsQuery,
  ReinstateAssetBody,
  ReturnAssetBody,
  UpdateAssetBody,
  type AssetAssignmentsView,
  type AssetDeadlinesView,
  type AssetDetailView,
  type AssetPageView,
  type AssetReportsView,
} from '@lalanda/shared/assets';
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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../../authz/current-org-permissions.decorator.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { canSeeStockValues, type OrgRole } from '../../authz/permissions.js';
import { sendCsv } from '../../crm/crm-actor.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import type { AssetActor } from '../settings/asset-settings.service.js';
import { AssetsService, type AssetReader } from './assets.service.js';
import { RequireFeature } from '../../billing/feature.guard.js';

export function assetReaderOf(perms: CurrentOrgPermissionsValue | undefined): AssetReader {
  return { visible: perms ? canSeeStockValues(perms.role, perms.context) : false };
}

export function assetActorOf(user: { id: string }, role: OrgRole | undefined): AssetActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

@Controller('assets')
@RequireFeature('assets') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class AssetsController {
  constructor(@Inject(AssetsService) private readonly assets: AssetsService) {}

  @Get()
  @RequirePermission('assets.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
  ): Promise<AssetPageView> {
    const parsed = ListAssetsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.assets.list(orgId, parsed.data, assetReaderOf(perms));
  }

  @Get('deadlines')
  @RequirePermission('assets.read')
  async deadlines(
    @CurrentOrgId() orgId: string,
    @Query() query: unknown,
  ): Promise<AssetDeadlinesView> {
    const parsed = AssetDeadlinesQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres des échéances invalides.');
    return this.assets.deadlines(orgId, parsed.data);
  }

  @Get('reports')
  @RequirePermission('assets.read')
  async reports(
    @CurrentOrgId() orgId: string,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
  ): Promise<AssetReportsView> {
    const parsed = AssetReportsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres du rapport invalides.');
    return this.assets.reports(orgId, parsed.data, assetReaderOf(perms));
  }

  @Get('export.csv')
  @RequirePermission('assets.read', 'report.export')
  async exportRegister(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    sendCsv(
      res,
      await this.assets.exportRegister(orgId, assetActorOf(user, role), assetReaderOf(perms)),
    );
  }

  @Get(':assetId')
  @RequirePermission('assets.read')
  async get(
    @CurrentOrgId() orgId: string,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('assetId') assetId: string,
    @Query() query: unknown,
  ): Promise<AssetDetailView> {
    const parsed = GetAssetQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    return this.assets.detail(orgId, assetId, assetReaderOf(perms), parsed.data.on);
  }

  @Post()
  @RequirePermission('assets.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Body() body: unknown,
  ): Promise<AssetDetailView> {
    const parsed = CreateAssetBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.assets.create(orgId, parsed.data, assetActorOf(user, role), assetReaderOf(perms));
  }

  @Put(':assetId')
  @RequirePermission('assets.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('assetId') assetId: string,
    @Body() body: unknown,
  ): Promise<AssetDetailView> {
    const parsed = UpdateAssetBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.assets.update(
      orgId,
      assetId,
      parsed.data,
      assetActorOf(user, role),
      assetReaderOf(perms),
    );
  }

  @Post(':assetId/dispose')
  @HttpCode(200)
  @RequirePermission('assets.manage')
  async dispose(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('assetId') assetId: string,
    @Body() body: unknown,
  ): Promise<AssetDetailView> {
    const parsed = DisposeAssetBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.assets.dispose(
      orgId,
      assetId,
      parsed.data,
      assetActorOf(user, role),
      assetReaderOf(perms),
    );
  }

  @Post(':assetId/reinstate')
  @HttpCode(200)
  @RequirePermission('assets.manage')
  async reinstate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('assetId') assetId: string,
    @Body() body: unknown,
  ): Promise<AssetDetailView> {
    const parsed = ReinstateAssetBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.assets.reinstate(
      orgId,
      assetId,
      parsed.data,
      assetActorOf(user, role),
      assetReaderOf(perms),
    );
  }

  @Post(':assetId/assign')
  @HttpCode(200)
  @RequirePermission('assets.manage')
  async assign(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('assetId') assetId: string,
    @Body() body: unknown,
  ): Promise<AssetDetailView> {
    const parsed = AssignAssetBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.assets.assign(
      orgId,
      assetId,
      parsed.data,
      assetActorOf(user, role),
      assetReaderOf(perms),
    );
  }

  @Post(':assetId/return')
  @HttpCode(200)
  @RequirePermission('assets.manage')
  async returnAsset(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('assetId') assetId: string,
    @Body() body: unknown,
  ): Promise<AssetDetailView> {
    const parsed = ReturnAssetBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.assets.return(
      orgId,
      assetId,
      parsed.data,
      assetActorOf(user, role),
      assetReaderOf(perms),
    );
  }

  @Get(':assetId/assignments')
  @RequirePermission('assets.read')
  async assignments(
    @CurrentOrgId() orgId: string,
    @Param('assetId') assetId: string,
  ): Promise<AssetAssignmentsView> {
    return this.assets.assignmentsOf(orgId, assetId);
  }
}
