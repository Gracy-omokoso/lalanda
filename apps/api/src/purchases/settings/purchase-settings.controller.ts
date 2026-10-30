// Réglages des achats — ADR-0044 § 3.7. ADR-0044 — P3.
//
//   GET /purchases/settings   purchase.read
//   PUT /purchases/settings   purchase.manage ET purchase.approve (changer les
//                             paliers, c'est changer qui approuve : il faut être
//                             soi-même approbateur)

import { UpdatePurchaseSettingsBody, type PurchaseSettingsView } from '@lalanda/shared/purchases';
import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { PurchaseSettingsService } from './purchase-settings.service.js';

@Controller('purchases/settings')
@UseGuards(AuthGuard, PermissionsGuard)
export class PurchaseSettingsController {
  constructor(
    @Inject(PurchaseSettingsService) private readonly settings: PurchaseSettingsService,
  ) {}

  @Get()
  @RequirePermission('purchase.read')
  async get(@CurrentOrgId() orgId: string): Promise<PurchaseSettingsView> {
    return this.settings.view(orgId);
  }

  @Put()
  @RequirePermission('purchase.manage', 'purchase.approve')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<PurchaseSettingsView> {
    const parsed = UpdatePurchaseSettingsBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Réglages des achats : saisie invalide.');
    return this.settings.update(orgId, parsed.data, { userId: user.id, role: role ?? 'unknown' });
  }
}
