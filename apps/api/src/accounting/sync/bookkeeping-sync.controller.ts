// Synchronisation, régénération, comptes de trésorerie ↔ plan (ADR-0049 § 4, § 6, § 11).
// ADR-0049 — K5.
//
//   POST /accounting/sync                                   accounting.manage
//   POST /accounting/periods/:year/:month/regenerate        accounting.manage (aperçu, puis ?confirm=true)
//   GET  /accounting/treasury-links                         accounting.read
//   PUT  /accounting/treasury-links/:treasuryAccountId      accounting.manage

import {
  AccountingMonthParam,
  AccountingYearParam,
  PutAccountingTreasuryLinkBody,
  type AccountingRegenerationView,
  type AccountingSyncResult,
  type AccountingTreasuryLinkView,
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
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import {
  CurrentAccountingActor,
  notFound,
  parseParam,
  parseWith,
  type AccountingActor,
} from '../accounting.common.js';
import { AccountingSyncService } from './accounting-sync.service.js';

@Controller('accounting')
@UseGuards(AuthGuard, PermissionsGuard)
export class BookkeepingSyncController {
  constructor(@Inject(AccountingSyncService) private readonly sync: AccountingSyncService) {}

  @Post('sync')
  @HttpCode(200)
  @RequirePermission('accounting.manage')
  async run(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
  ): Promise<AccountingSyncResult> {
    return this.sync.sync(orgId, actor);
  }

  @Post('periods/:year/:month/regenerate')
  @HttpCode(200)
  @RequirePermission('accounting.manage')
  async regenerate(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('year') year: string,
    @Param('month') month: string,
    @Query('confirm') confirm: string | undefined,
  ): Promise<AccountingRegenerationView> {
    return this.sync.regenerate(
      orgId,
      parseParam(AccountingYearParam, year),
      parseParam(AccountingMonthParam, month),
      confirm === 'true',
      actor,
    );
  }

  @Get('treasury-links')
  @RequirePermission('accounting.read')
  async links(@CurrentOrgId() orgId: string): Promise<{ items: AccountingTreasuryLinkView[] }> {
    return { items: await this.sync.treasuryLinks(orgId) };
  }

  @Put('treasury-links/:treasuryAccountId')
  @RequirePermission('accounting.manage')
  async putLink(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('treasuryAccountId') treasuryAccountId: string,
    @Body() body: unknown,
  ): Promise<AccountingTreasuryLinkView> {
    if (!/^[0-9a-f]{24}$/i.test(treasuryAccountId)) {
      notFound('TREASURY_ACCOUNT_NOT_FOUND', 'Compte de trésorerie introuvable.');
    }
    return this.sync.putTreasuryLink(
      orgId,
      treasuryAccountId.toLowerCase(),
      parseWith(PutAccountingTreasuryLinkBody, body),
      actor,
    );
  }
}
