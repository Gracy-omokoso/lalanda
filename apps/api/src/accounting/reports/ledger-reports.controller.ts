// Grand livre et balances (ADR-0049 § 6.11, § 11). ADR-0049 — K6.
//
//   POST /accounting/ledger              accounting.read
//   POST /accounting/trial-balance       accounting.read
//   POST /accounting/auxiliary-balance   accounting.read
//
// Critères en CORPS (§ 11). Contrôleur nommé `Ledger…` : les blocs K4 et K5 de
// `routes-coverage` énumèrent strictement les `Accounting…` et `Bookkeeping…`.

import {
  AccountingPeriodCriteriaBody,
  type AccountingAuxiliaryBalanceView,
  type AccountingLedgerView,
  type AccountingTrialBalanceView,
} from '@lalanda/shared/accounting';
import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { parseWith } from '../accounting.common.js';
import { AccountingReportingService } from './accounting-reporting.service.js';
import { RequireFeature } from '../../billing/feature.guard.js';

@Controller('accounting')
@RequireFeature('accounting') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class LedgerReportsController {
  constructor(
    @Inject(AccountingReportingService) private readonly reporting: AccountingReportingService,
  ) {}

  @Post('ledger')
  @HttpCode(200)
  @RequirePermission('accounting.read')
  async ledger(
    @CurrentOrgId() orgId: string,
    @Body() body: unknown,
  ): Promise<AccountingLedgerView> {
    return this.reporting.ledger(orgId, parseWith(AccountingPeriodCriteriaBody, body));
  }

  @Post('trial-balance')
  @HttpCode(200)
  @RequirePermission('accounting.read')
  async trialBalance(
    @CurrentOrgId() orgId: string,
    @Body() body: unknown,
  ): Promise<AccountingTrialBalanceView> {
    return this.reporting.trialBalance(orgId, parseWith(AccountingPeriodCriteriaBody, body));
  }

  @Post('auxiliary-balance')
  @HttpCode(200)
  @RequirePermission('accounting.read')
  async auxiliaryBalance(
    @CurrentOrgId() orgId: string,
    @Body() body: unknown,
  ): Promise<AccountingAuxiliaryBalanceView> {
    return this.reporting.auxiliaryBalance(orgId, parseWith(AccountingPeriodCriteriaBody, body));
  }
}
