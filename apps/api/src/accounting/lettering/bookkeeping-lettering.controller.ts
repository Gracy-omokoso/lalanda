// Lettrage manuel (ADR-0049 § 6.11, § 11). ADR-0049 — K5.
//
//   POST /accounting/lettering                  accounting.post
//   POST /accounting/lettering/:code/unletter   accounting.post

import { AccountingLetteringBody, type AccountingLetteringView } from '@lalanda/shared/accounting';
import { Body, Controller, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import {
  badRequest,
  conflict,
  CurrentAccountingActor,
  parseWith,
  type AccountingActor,
} from '../accounting.common.js';
import { AccountingSettingsService } from '../settings/accounting-settings.service.js';
import { AccountingLetteringService } from './accounting-lettering.service.js';

@Controller('accounting/lettering')
@UseGuards(AuthGuard, PermissionsGuard)
export class BookkeepingLetteringController {
  constructor(
    @Inject(AccountingLetteringService) private readonly lettering: AccountingLetteringService,
    @Inject(AccountingSettingsService) private readonly settings: AccountingSettingsService,
  ) {}

  private async assertActive(orgId: string): Promise<void> {
    if ((await this.settings.ensure(orgId)).mode !== 'active') {
      conflict('ACCOUNTING_NOT_ACTIVE', 'Le lettrage n’existe qu’en mode actif.');
    }
  }

  @Post()
  @RequirePermission('accounting.post')
  async letter(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Body() body: unknown,
  ): Promise<AccountingLetteringView> {
    const { lineRefs } = parseWith(AccountingLetteringBody, body);
    await this.assertActive(orgId);
    return this.lettering.letter(orgId, lineRefs, actor);
  }

  @Post(':code/unletter')
  @HttpCode(200)
  @RequirePermission('accounting.post')
  async unletter(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('code') code: string,
  ): Promise<{ code: string; lineRefs: string[] }> {
    if (!/^L\d{6,}$/.test(code)) badRequest('INVALID_LETTERING_CODE', 'Code de lettrage invalide.');
    await this.assertActive(orgId);
    return this.lettering.unletter(orgId, code, actor);
  }
}
