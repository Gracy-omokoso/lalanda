// Clôtures et réouvertures (ADR-0049 § 4, § 11). ADR-0049 — K6.
//
//   POST /accounting/periods/:year/:month/close    accounting.close
//   POST /accounting/periods/:year/:month/reopen   accounting.close + Propriétaire seul
//   POST /accounting/fiscal-years/:year/close      accounting.close
//   POST /accounting/fiscal-years/:year/reopen     accounting.close + Propriétaire seul
//
// La réouverture exige en plus le TITRE de Propriétaire (`accountingReopenDecision`,
// `403 REOPEN_OWNER_ONLY`), jugé dans le service : aucun ajout ne le confère (ADR-0041).

import {
  AccountingMonthParam,
  AccountingReopenBody,
  AccountingYearParam,
  CloseAccountingFiscalYearBody,
  type AccountingFiscalYearCloseView,
  type AccountingFiscalYearView,
} from '@lalanda/shared/accounting';
import { Body, Controller, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';

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
import { AccountingClosingService } from './accounting-closing.service.js';
import { RequireFeature } from '../../billing/feature.guard.js';

@Controller('accounting')
@RequireFeature('accounting') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class LedgerClosingController {
  constructor(
    @Inject(AccountingClosingService) private readonly closing: AccountingClosingService,
  ) {}

  @Post('periods/:year/:month/close')
  @HttpCode(200)
  @RequirePermission('accounting.close')
  async closePeriod(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('year') year: string,
    @Param('month') month: string,
  ): Promise<AccountingFiscalYearView> {
    return this.closing.closePeriod(
      orgId,
      parseParam(AccountingYearParam, year),
      parseParam(AccountingMonthParam, month),
      actor,
    );
  }

  @Post('periods/:year/:month/reopen')
  @HttpCode(200)
  @RequirePermission('accounting.close')
  async reopenPeriod(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('year') year: string,
    @Param('month') month: string,
    @Body() body: unknown,
  ): Promise<AccountingFiscalYearView> {
    return this.closing.reopenPeriod(
      orgId,
      parseParam(AccountingYearParam, year),
      parseParam(AccountingMonthParam, month),
      parseWith(AccountingReopenBody, body ?? {}),
      actor,
    );
  }

  @Post('fiscal-years/:year/close')
  @HttpCode(200)
  @RequirePermission('accounting.close')
  async closeFiscalYear(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('year') year: string,
    @Body() body: unknown,
  ): Promise<AccountingFiscalYearCloseView> {
    return this.closing.closeFiscalYear(
      orgId,
      parseParam(AccountingYearParam, year),
      parseWith(CloseAccountingFiscalYearBody, body ?? {}),
      actor,
    );
  }

  @Post('fiscal-years/:year/reopen')
  @HttpCode(200)
  @RequirePermission('accounting.close')
  async reopenFiscalYear(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('year') year: string,
    @Body() body: unknown,
  ): Promise<AccountingFiscalYearView> {
    return this.closing.reopenFiscalYear(
      orgId,
      parseParam(AccountingYearParam, year),
      parseWith(AccountingReopenBody, body ?? {}),
      actor,
    );
  }
}
