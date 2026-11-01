// Journaux (ADR-0049 § 2.5, § 11). ADR-0049 — K4.
//
//   GET  /accounting/journals         accounting.read
//   POST /accounting/journals         accounting.manage
//   PUT  /accounting/journals/:code   accounting.manage

import {
  AccountingJournalCode,
  CreateAccountingJournalBody,
  UpdateAccountingJournalBody,
  type AccountingJournalView,
} from '@lalanda/shared/accounting';
import { Body, Controller, Get, Inject, Param, Post, Put, UseGuards } from '@nestjs/common';

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
import { AccountingJournalsService } from './accounting-journals.service.js';

@Controller('accounting/journals')
@UseGuards(AuthGuard, PermissionsGuard)
export class AccountingJournalsController {
  constructor(
    @Inject(AccountingJournalsService) private readonly journals: AccountingJournalsService,
  ) {}

  @Get()
  @RequirePermission('accounting.read')
  async list(@CurrentOrgId() orgId: string): Promise<{ items: AccountingJournalView[] }> {
    return { items: await this.journals.list(orgId) };
  }

  @Post()
  @RequirePermission('accounting.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Body() body: unknown,
  ): Promise<AccountingJournalView> {
    return this.journals.create(orgId, parseWith(CreateAccountingJournalBody, body), actor);
  }

  @Put(':code')
  @RequirePermission('accounting.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('code') code: string,
    @Body() body: unknown,
  ): Promise<AccountingJournalView> {
    return this.journals.update(
      orgId,
      parseParam(AccountingJournalCode, code),
      parseWith(UpdateAccountingJournalBody, body),
      actor,
    );
  }
}
