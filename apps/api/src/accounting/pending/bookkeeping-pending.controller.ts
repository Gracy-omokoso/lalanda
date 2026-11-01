// « À comptabiliser » (ADR-0049 § 2.7, § 11). ADR-0049 — K5.
//
//   GET  /accounting/pending               accounting.read
//   POST /accounting/pending/:id/resolve   accounting.post   (revue motivée)

import {
  ResolvePendingBody,
  type AccountingPage,
  type AccountingPendingView,
} from '@lalanda/shared/accounting';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import {
  conflict,
  CurrentAccountingActor,
  parseWith,
  type AccountingActor,
} from '../accounting.common.js';
import { AccountingEntriesService } from '../entries/accounting-entries.service.js';
import { AccountingSettingsService } from '../settings/accounting-settings.service.js';
import { AccountingPendingService } from './accounting-pending.service.js';

@Controller('accounting/pending')
@UseGuards(AuthGuard, PermissionsGuard)
export class BookkeepingPendingController {
  constructor(
    @Inject(AccountingEntriesService) private readonly entries: AccountingEntriesService,
    @Inject(AccountingPendingService) private readonly pending: AccountingPendingService,
    @Inject(AccountingSettingsService) private readonly settings: AccountingSettingsService,
  ) {}

  @Get()
  @RequirePermission('accounting.read')
  async list(@CurrentOrgId() orgId: string): Promise<AccountingPage<AccountingPendingView>> {
    return this.entries.listPending(orgId);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermission('accounting.post')
  async resolve(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AccountingPendingView> {
    const { note } = parseWith(ResolvePendingBody, body);
    if ((await this.settings.ensure(orgId)).mode === 'simulation') {
      conflict('ACCOUNTING_NOT_ACTIVE', 'En simulation, rien n’est enregistré : rien à résoudre.');
    }
    return this.pending.resolve(orgId, id, note, actor);
  }
}
