// Réglages des contrats — ADR-0050 § 2.1, § 3. ADR-0050 — V3.
//
//   GET /sales/contract-settings     sales.read
//   PUT /sales/contract-settings     sales.contract.approve (corps COMPLET)

import { SalesContractSettingsSchema } from '@lalanda/shared/sales-contracts';
import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../../auth/current-user.decorator.js';
import { RequirePermission } from '../../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../../authz/permissions.guard.js';
import type { OrgRole } from '../../../authz/permissions.js';
import {
  contractsActorOf,
  parseContractsBody,
  type ContractsUser,
} from '../common/contracts.common.js';
import {
  SalesContractSettingsService,
  type SalesContractSettingsView,
} from './sales-contract-settings.service.js';
import { RequireFeature } from '../../../billing/feature.guard.js';

@Controller('sales/contract-settings')
@RequireFeature('sales_contracts') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class SalesContractSettingsController {
  constructor(
    @Inject(SalesContractSettingsService) private readonly settings: SalesContractSettingsService,
  ) {}

  @Get()
  @RequirePermission('sales.read')
  async get(@CurrentOrgId() orgId: string): Promise<SalesContractSettingsView> {
    return this.settings.view(orgId);
  }

  @Put()
  @RequirePermission('sales.contract.approve')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<SalesContractSettingsView> {
    const input = parseContractsBody(SalesContractSettingsSchema, body);
    return this.settings.put(orgId, input, contractsActorOf(user, role));
  }
}
