// Devis accepté → commande client — ADR-0050 § 3, § 4.1. ADR-0050 — V2.
//
//   POST /sales/quotes/:quoteId/to-order    sales.contract
//
// Contrôleur à part : le module des devis n'est pas modifié. La commande reprend les
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
import { QuoteToOrderSchema } from './sales-orders.dto.js';
import { SalesOrdersService, type SalesOrderFromQuoteResult } from './sales-orders.service.js';
import { RequireFeature } from '../../../billing/feature.guard.js';

@Controller('sales/quotes')
@RequireFeature('sales_contracts') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class QuoteToOrderController {
  constructor(@Inject(SalesOrdersService) private readonly orders: SalesOrdersService) {}

  @Post(':quoteId/to-order')
  @HttpCode(201)
  @RequirePermission('sales.contract')
  async toOrder(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('quoteId') quoteId: string,
    @Body() body: unknown,
  ): Promise<SalesOrderFromQuoteResult> {
    const input = parseContractsBody(QuoteToOrderSchema, body);
    return this.orders.createFromQuote(orgId, quoteId, input, contractsActorOf(user, role));
  }
}
