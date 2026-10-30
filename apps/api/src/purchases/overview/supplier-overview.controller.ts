// Fiche fournisseur 360° — ADR-0044 § 3.1.1. ADR-0044 — P6.
//
//   GET /purchases/suppliers/:supplierId/overview   purchase.read
//
// Sections décidées sur les droits EFFECTIFS (ADR-0041 § 9.4) : paiements et
// dépenses directes exigent `treasury.read` en plus, sinon `hidden` (rien n'est lu).
// Une fiche d'une autre organisation répond 404.

import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import type { SupplierOverviewView } from '@lalanda/shared/purchases';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { can } from '../../authz/permissions.js';
import { SupplierOverviewService } from './supplier-overview.service.js';

@Controller('purchases/suppliers')
@UseGuards(AuthGuard, PermissionsGuard)
export class SupplierOverviewController {
  constructor(
    @Inject(SupplierOverviewService) private readonly overviews: SupplierOverviewService,
  ) {}

  @Get(':supplierId/overview')
  @RequirePermission('purchase.read')
  async overview(
    @CurrentOrgId() orgId: string,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('supplierId') supplierId: string,
  ): Promise<SupplierOverviewView> {
    // Sans droits résolus (accès délégué) : moindre privilège, rien de plus.
    const treasury = perms ? can(perms.role, 'treasury.read', perms.context) : false;
    return this.overviews.overview(orgId, supplierId, { treasury });
  }
}
