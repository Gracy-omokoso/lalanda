// Résumé des achats — ADR-0044 § 3.6. ADR-0044 — P6.
//
//   GET /purchases/summary?from=&to=   purchase.read
//
// L'échéancier `GET /purchases/payables` est livré par le lot P5.

import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { PurchasesSummaryQuery, type PurchasesSummaryView } from '@lalanda/shared/purchases';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { PurchasesSummaryService } from './purchases-summary.service.js';

@Controller('purchases')
@UseGuards(AuthGuard, PermissionsGuard)
export class PurchasesSummaryController {
  constructor(
    @Inject(PurchasesSummaryService) private readonly summaries: PurchasesSummaryService,
  ) {}

  @Get('summary')
  @RequirePermission('purchase.read')
  async summary(
    @CurrentOrgId() orgId: string,
    @Query() query: unknown,
  ): Promise<PurchasesSummaryView> {
    const parsed = PurchasesSummaryQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres du résumé invalides.');
    return this.summaries.summary(orgId, parsed.data);
  }
}
