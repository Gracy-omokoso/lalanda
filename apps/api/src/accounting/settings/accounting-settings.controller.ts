// Réglages, mode et activation (ADR-0049 § 2.2, § 3.1, § 11). ADR-0049 — K4.
//
//   GET  /accounting/settings     accounting.read
//   PUT  /accounting/settings     accounting.manage   (mode off | simulation, options)
//   POST /accounting/activate     accounting.manage + fiscal.manage (cumul, § 3.1)
//   POST /accounting/deactivate   accounting.manage + fiscal.manage

import {
  AccountingActivationBody,
  UpdateAccountingSettingsBody,
  type AccountingSettingsView,
} from '@lalanda/shared/accounting';
import { Body, Controller, Get, HttpCode, Inject, Post, Put, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { CurrentAccountingActor, parseWith, type AccountingActor } from '../accounting.common.js';
import { AccountingSettingsService } from './accounting-settings.service.js';
import { RequireFeature } from '../../billing/feature.guard.js';

@Controller('accounting')
@RequireFeature('accounting') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class AccountingSettingsController {
  constructor(
    @Inject(AccountingSettingsService) private readonly settings: AccountingSettingsService,
  ) {}

  @Get('settings')
  @RequirePermission('accounting.read')
  async get(@CurrentOrgId() orgId: string): Promise<AccountingSettingsView> {
    return this.settings.view(orgId);
  }

  @Put('settings')
  @RequirePermission('accounting.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Body() body: unknown,
  ): Promise<AccountingSettingsView> {
    return this.settings.update(orgId, parseWith(UpdateAccountingSettingsBody, body), actor);
  }

  @Post('activate')
  @HttpCode(200)
  @RequirePermission('accounting.manage', 'fiscal.manage')
  async activate(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Body() body: unknown,
  ): Promise<AccountingSettingsView> {
    return this.settings.activate(orgId, parseWith(AccountingActivationBody, body), actor);
  }

  @Post('deactivate')
  @HttpCode(200)
  @RequirePermission('accounting.manage', 'fiscal.manage')
  async deactivate(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Body() body: unknown,
  ): Promise<AccountingSettingsView> {
    return this.settings.deactivate(orgId, parseWith(AccountingActivationBody, body), actor);
  }
}
