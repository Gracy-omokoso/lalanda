// Acomptes des contrats — ADR-0050 § 3, § 5.1, § 5.2. ADR-0050 — V4.
//
//   GET  /sales/contracts/:id/deposits                      sales.read
//   POST /sales/contracts/:id/prepare-deposit               sales.read + sales.manage
//   POST /sales/contracts/:id/deposits/:invoiceId/resolved  sales.read + sales.manage
//
// La préparation crée un BROUILLON `FT`/`ET` ; l'émission reste sous `sales.invoice`
// (routes existantes). « Traité » est un geste déclaratif, motif libre, journalisé.
// Un contrat d'une autre organisation répond 404.

import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';

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
import { PrepareDepositBodySchema, ResolveDepositBodySchema } from './sales-deposits.dto.js';
import {
  SalesDepositsService,
  type PreparedSalesDeposit,
  type SalesDepositsView,
} from './sales-deposits.service.js';
import { RequireFeature } from '../../../billing/feature.guard.js';

@Controller('sales/contracts')
@RequireFeature('sales_contracts') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class SalesContractDepositsController {
  constructor(@Inject(SalesDepositsService) private readonly deposits: SalesDepositsService) {}

  @Get(':contractId/deposits')
  @RequirePermission('sales.read')
  async list(
    @CurrentOrgId() orgId: string,
    @Param('contractId') contractId: string,
  ): Promise<SalesDepositsView> {
    return this.deposits.view(orgId, 'contract', contractId);
  }

  @Post(':contractId/prepare-deposit')
  @HttpCode(200)
  @RequirePermission('sales.read', 'sales.manage')
  async prepare(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Body() body: unknown,
  ): Promise<PreparedSalesDeposit> {
    const input = parseContractsBody(PrepareDepositBodySchema, body);
    return this.deposits.prepare(
      orgId,
      'contract',
      contractId,
      input,
      contractsActorOf(user, role),
    );
  }

  @Post(':contractId/deposits/:invoiceId/resolved')
  @HttpCode(200)
  @RequirePermission('sales.read', 'sales.manage')
  async resolve(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown,
  ): Promise<SalesDepositsView> {
    const input = parseContractsBody(ResolveDepositBodySchema, body);
    return this.deposits.resolve(
      orgId,
      'contract',
      contractId,
      invoiceId,
      input,
      contractsActorOf(user, role),
    );
  }
}
