// Plan de l'organisation (ADR-0049 § 2.3, § 11). ADR-0049 — K4.
//
//   GET  /accounting/accounts                   accounting.read
//   POST /accounting/accounts                   accounting.manage
//   PUT  /accounting/accounts/:number           accounting.manage
//   POST /accounting/accounts/:number/archive   accounting.manage

import {
  AccountingAccountNumber,
  ArchiveAccountingAccountBody,
  CreateAccountingAccountBody,
  UpdateAccountingAccountBody,
  type AccountingAccountView,
} from '@lalanda/shared/accounting';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

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
import { AccountingAccountsService } from './accounting-accounts.service.js';
import { RequireFeature } from '../../billing/feature.guard.js';

@Controller('accounting/accounts')
@RequireFeature('accounting') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class AccountingAccountsController {
  constructor(
    @Inject(AccountingAccountsService) private readonly accounts: AccountingAccountsService,
  ) {}

  @Get()
  @RequirePermission('accounting.read')
  async list(@CurrentOrgId() orgId: string): Promise<{ items: AccountingAccountView[] }> {
    return { items: await this.accounts.list(orgId) };
  }

  @Post()
  @RequirePermission('accounting.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Body() body: unknown,
  ): Promise<AccountingAccountView> {
    return this.accounts.create(orgId, parseWith(CreateAccountingAccountBody, body), actor);
  }

  @Put(':number')
  @RequirePermission('accounting.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('number') number: string,
    @Body() body: unknown,
  ): Promise<AccountingAccountView> {
    return this.accounts.update(
      orgId,
      parseParam(AccountingAccountNumber, number),
      parseWith(UpdateAccountingAccountBody, body),
      actor,
    );
  }

  @Post(':number/archive')
  @HttpCode(200)
  @RequirePermission('accounting.manage')
  async archive(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('number') number: string,
    @Body() body: unknown,
  ): Promise<AccountingAccountView> {
    return this.accounts.archive(
      orgId,
      parseParam(AccountingAccountNumber, number),
      parseWith(ArchiveAccountingAccountBody, body),
      actor,
    );
  }
}
