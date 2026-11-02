// Devis accepté → contrat — ADR-0050 § 3, § 4.1. ADR-0050 — V3.
//
//   POST /sales/quotes/:quoteId/to-contract    sales.contract
//
// Contrôleur à part : le module des devis n'est pas modifié. Le contrat reprend les
// lignes du devis à PRIX FIXÉS ; le devis est seulement LU. Un devis d'une autre
// organisation répond 404.

import { Body, Controller, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';

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
import { QuoteToContractSchema } from './sales-contracts.dto.js';
import {
  SalesContractsService,
  type SalesContractWithWarnings,
} from './sales-contracts.service.js';
import { RequireFeature } from '../../../billing/feature.guard.js';

@Controller('sales/quotes')
@RequireFeature('sales_contracts') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class QuoteToContractController {
  constructor(@Inject(SalesContractsService) private readonly contracts: SalesContractsService) {}

  @Post(':quoteId/to-contract')
  @HttpCode(201)
  @RequirePermission('sales.contract')
  async toContract(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('quoteId') quoteId: string,
    @Body() body: unknown,
  ): Promise<SalesContractWithWarnings> {
    const input = parseContractsBody(QuoteToContractSchema, body);
    return this.contracts.createFromQuote(orgId, quoteId, input, contractsActorOf(user, role));
  }
}
