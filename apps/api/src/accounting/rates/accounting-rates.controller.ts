// Taux saisis (ADR-0049 § 2.7, § 5, § 11). ADR-0049 — K4.
//
//   GET /accounting/exchange-rates                  accounting.read
//   PUT /accounting/exchange-rates/:date/:from/:to  accounting.post

import {
  AccountingCalendarDay,
  AccountingCurrencySchema,
  PutAccountingExchangeRateBody,
  type AccountingExchangeRateView,
} from '@lalanda/shared/accounting';
import { Body, Controller, Get, Inject, Param, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import {
  CurrentAccountingActor,
  parseParam,
  parseWith,
  type AccountingActor,
} from '../accounting.common.js';
import { AccountingRatesService } from './accounting-rates.service.js';
import { RequireFeature } from '../../billing/feature.guard.js';

@Controller('accounting/exchange-rates')
@RequireFeature('accounting') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class AccountingRatesController {
  constructor(@Inject(AccountingRatesService) private readonly rates: AccountingRatesService) {}

  @Get()
  @RequirePermission('accounting.read')
  async list(@CurrentOrgId() orgId: string): Promise<{ items: AccountingExchangeRateView[] }> {
    return { items: await this.rates.list(orgId) };
  }

  @Put(':date/:from/:to')
  @RequirePermission('accounting.post')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('date') date: string,
    @Param('from') from: string,
    @Param('to') to: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccountingExchangeRateView> {
    const saved = await this.rates.put(
      orgId,
      parseParam(AccountingCalendarDay, date),
      parseParam(AccountingCurrencySchema, from),
      parseParam(AccountingCurrencySchema, to),
      parseWith(PutAccountingExchangeRateBody, body),
      actor,
    );
    res.status(saved.created ? 201 : 200);
    return saved.rate;
  }
}
