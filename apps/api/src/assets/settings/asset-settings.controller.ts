// Catégories et réglages des équipements — ADR-0046 § 3.5, § 5.2. ADR-0046 — S5.
//
//   GET  /assets/categories                    assets.read
//   POST /assets/categories                    assets.manage
//   PUT  /assets/categories/:categoryId        assets.manage
//   GET  /assets/settings                      assets.read
//   PUT  /assets/settings                      assets.manage

import {
  CreateAssetCategoryBody,
  UpdateAssetCategoryBody,
  UpdateAssetSettingsBody,
  type AssetCategoryView,
  type AssetSettingsView,
} from '@lalanda/shared/assets';
import { Body, Controller, Get, Inject, Param, Post, Put, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { AssetSettingsService } from './asset-settings.service.js';
import { RequireFeature } from '../../billing/feature.guard.js';

@Controller('assets')
@RequireFeature('assets') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class AssetSettingsController {
  constructor(@Inject(AssetSettingsService) private readonly service: AssetSettingsService) {}

  @Get('categories')
  @RequirePermission('assets.read')
  async listCategories(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
  ): Promise<{ items: AssetCategoryView[] }> {
    return { items: await this.service.listCategories(orgId, user.id) };
  }

  @Post('categories')
  @RequirePermission('assets.manage')
  async createCategory(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<AssetCategoryView> {
    const parsed = CreateAssetCategoryBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.service.createCategory(orgId, parsed.data, {
      userId: user.id,
      role: role ?? 'unknown',
    });
  }

  @Put('categories/:categoryId')
  @RequirePermission('assets.manage')
  async updateCategory(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('categoryId') categoryId: string,
    @Body() body: unknown,
  ): Promise<AssetCategoryView> {
    const parsed = UpdateAssetCategoryBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.service.updateCategory(orgId, categoryId, parsed.data, {
      userId: user.id,
      role: role ?? 'unknown',
    });
  }

  @Get('settings')
  @RequirePermission('assets.read')
  async getSettings(@CurrentOrgId() orgId: string): Promise<AssetSettingsView> {
    return this.service.view(orgId);
  }

  @Put('settings')
  @RequirePermission('assets.manage')
  async updateSettings(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<AssetSettingsView> {
    const parsed = UpdateAssetSettingsBody.safeParse(body);
    if (!parsed.success)
      invalidRequest(parsed.error, 'Réglages des équipements : saisie invalide.');
    return this.service.update(orgId, parsed.data, { userId: user.id, role: role ?? 'unknown' });
  }
}
