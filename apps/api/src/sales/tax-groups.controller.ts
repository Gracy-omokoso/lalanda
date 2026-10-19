// Groupes de taxation proposés au catalogue — ADR-0022 § S25c.4, § S25c.5.

import { Controller, Get, Inject, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { TaxGroupsService, type TaxGroupList } from './tax-groups.service.js';

@Controller('sales/tax-groups')
@UseGuards(AuthGuard, PermissionsGuard)
export class TaxGroupsController {
  constructor(@Inject(TaxGroupsService) private readonly taxGroups: TaxGroupsService) {}

  @Get()
  @RequirePermission('sales.read')
  async list(@CurrentOrgId() orgId: string): Promise<TaxGroupList> {
    return this.taxGroups.list(orgId);
  }
}
