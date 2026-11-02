// Rapprochement avec le réalisé (ADR-0049 § 7, § 11). ADR-0049 — K6.
//
//   GET /accounting/reconciliation/actuals?month=AAAA-MM   accounting.read + project.read
//
// Affiché, jamais corrigé : la route lit et compare ; elle n'écrit rien, ni dans le
// réalisé, ni dans les livres.

import {
  AccountingReconciliationQuery,
  type AccountingReconciliationView,
} from '@lalanda/shared/accounting';
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { parseWith } from '../accounting.common.js';
import { AccountingReconciliationService } from './accounting-reconciliation.service.js';
import { RequireFeature } from '../../billing/feature.guard.js';

@Controller('accounting/reconciliation')
@RequireFeature('accounting') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class LedgerReconciliationController {
  constructor(
    @Inject(AccountingReconciliationService)
    private readonly reconciliation: AccountingReconciliationService,
  ) {}

  @Get('actuals')
  @RequirePermission('accounting.read', 'project.read')
  async actuals(
    @CurrentOrgId() orgId: string,
    @Query() query: unknown,
  ): Promise<AccountingReconciliationView> {
    const { month } = parseWith(AccountingReconciliationQuery, query);
    return this.reconciliation.actuals(orgId, month);
  }
}
