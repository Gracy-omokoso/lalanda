// Tableaux de bord des écrans Achats — ADR-0071 § 2.
//
//   GET /purchases/invoices/stats   purchase.read   (même droit que la liste des factures)
//   GET /purchases/payables/stats   purchase.read   (même droit que l'échéancier)
//   GET /purchases/orders/stats     purchase.read   (même droit que la liste des commandes)
//
// Contrôleur à part, enregistré AVANT ceux des factures et des commandes : `stats`
// n'est jamais pris pour un identifiant (`invoices/:invoiceId`, `orders/:orderId`).

import {
  PurchaseStatsQuerySchema,
  type PayablesStats,
  type PurchaseOrderStats,
  type SupplierInvoiceStats,
} from '@lalanda/shared/purchases';
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { RequireFeature } from '../../billing/feature.guard.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { PurchasesStatsService } from './purchases-stats.service.js';

function monthsOf(query: unknown): number | undefined {
  const parsed = PurchaseStatsQuerySchema.safeParse(query);
  if (!parsed.success) invalidRequest(parsed.error, 'Paramètres du tableau de bord invalides.');
  return parsed.data.months;
}

@Controller('purchases')
@RequireFeature('purchases') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class PurchasesStatsController {
  constructor(@Inject(PurchasesStatsService) private readonly stats: PurchasesStatsService) {}

  @Get('invoices/stats')
  @RequirePermission('purchase.read')
  async invoices(
    @CurrentOrgId() orgId: string,
    @Query() query: unknown,
  ): Promise<SupplierInvoiceStats> {
    return this.stats.invoices(orgId, monthsOf(query));
  }

  @Get('payables/stats')
  @RequirePermission('purchase.read')
  async payables(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<PayablesStats> {
    return this.stats.payables(orgId, monthsOf(query));
  }

  @Get('orders/stats')
  @RequirePermission('purchase.read')
  async orders(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @Query() query: unknown,
  ): Promise<PurchaseOrderStats> {
    return this.stats.orders(orgId, user.id, monthsOf(query));
  }
}
