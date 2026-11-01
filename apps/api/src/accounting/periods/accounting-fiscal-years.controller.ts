// Exercices et périodes — structure (ADR-0049 § 2.7, § 11). ADR-0049 — K4.
//
//   GET  /accounting/fiscal-years   accounting.read
//   POST /accounting/fiscal-years   accounting.close
//
// Clôtures et réouvertures (`/accounting/periods/:year/:month/close`…) : lot K6.

import {
  CreateAccountingFiscalYearBody,
  type AccountingFiscalYearView,
} from '@lalanda/shared/accounting';
import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { CurrentAccountingActor, parseWith, type AccountingActor } from '../accounting.common.js';
import { AccountingPeriodsService } from './accounting-periods.service.js';

@Controller('accounting/fiscal-years')
@UseGuards(AuthGuard, PermissionsGuard)
export class AccountingFiscalYearsController {
  constructor(
    @Inject(AccountingPeriodsService) private readonly periods: AccountingPeriodsService,
  ) {}

  @Get()
  @RequirePermission('accounting.read')
  async list(@CurrentOrgId() orgId: string): Promise<{ items: AccountingFiscalYearView[] }> {
    return { items: await this.periods.list(orgId) };
  }

  @Post()
  @RequirePermission('accounting.close')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Body() body: unknown,
  ): Promise<AccountingFiscalYearView> {
    return this.periods.create(orgId, parseWith(CreateAccountingFiscalYearBody, body), actor);
  }
}
