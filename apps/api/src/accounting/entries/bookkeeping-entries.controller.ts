// Écritures (ADR-0049 § 2.6, § 6.9, § 11). ADR-0049 — K5.
//
//   GET    /accounting/entries                 accounting.read   (première page)
//   POST   /accounting/entries/search          accounting.read   (filtres en corps)
//   GET    /accounting/entries/:id             accounting.read
//   POST   /accounting/entries                 accounting.post   (opération diverse, brouillon)
//   PUT    /accounting/entries/:id             accounting.post   (brouillon seulement)
//   POST   /accounting/entries/:id/validate    accounting.post   (ⓢ, manualEntryDecision)
//   POST   /accounting/entries/:id/reverse     accounting.post   (contre-passation)
//   DELETE /accounting/entries/:id             accounting.post   (brouillon seulement)
//
// Le nom du contrôleur ne commence pas par `Accounting` : le bloc K4 de
// `routes-coverage.test.ts` énumère, à l'égalité stricte, les routes `Accounting…Controller`.

import {
  AccountingEntrySearchBody,
  CreateManualEntryBody,
  ReverseEntryBody,
  UpdateManualEntryBody,
  ValidateManualEntryBody,
  type AccountingEntryView,
  type AccountingPage,
} from '@lalanda/shared/accounting';
import {
  Body,
  Controller,
  Delete,
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
import { CurrentAccountingActor, parseWith, type AccountingActor } from '../accounting.common.js';
import { AccountingEntriesService } from './accounting-entries.service.js';

@Controller('accounting/entries')
@UseGuards(AuthGuard, PermissionsGuard)
export class BookkeepingEntriesController {
  constructor(@Inject(AccountingEntriesService) private readonly entries: AccountingEntriesService) {}

  @Get()
  @RequirePermission('accounting.read')
  async list(@CurrentOrgId() orgId: string): Promise<AccountingPage<AccountingEntryView>> {
    return this.entries.search(orgId, {});
  }

  @Post('search')
  @HttpCode(200)
  @RequirePermission('accounting.read')
  async search(
    @CurrentOrgId() orgId: string,
    @Body() body: unknown,
  ): Promise<AccountingPage<AccountingEntryView>> {
    return this.entries.search(orgId, parseWith(AccountingEntrySearchBody, body ?? {}));
  }

  @Get(':id')
  @RequirePermission('accounting.read')
  async get(@CurrentOrgId() orgId: string, @Param('id') id: string): Promise<AccountingEntryView> {
    return this.entries.get(orgId, id);
  }

  @Post()
  @RequirePermission('accounting.post')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Body() body: unknown,
  ): Promise<AccountingEntryView> {
    return this.entries.create(orgId, parseWith(CreateManualEntryBody, body), actor);
  }

  @Put(':id')
  @RequirePermission('accounting.post')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AccountingEntryView> {
    return this.entries.update(orgId, id, parseWith(UpdateManualEntryBody, body), actor);
  }

  @Post(':id/validate')
  @HttpCode(200)
  @RequirePermission('accounting.post')
  async validate(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AccountingEntryView> {
    return this.entries.validate(orgId, id, parseWith(ValidateManualEntryBody, body), actor);
  }

  @Post(':id/reverse')
  @RequirePermission('accounting.post')
  async reverse(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AccountingEntryView> {
    return this.entries.reverse(orgId, id, parseWith(ReverseEntryBody, body), actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('accounting.post')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('id') id: string,
  ): Promise<void> {
    await this.entries.remove(orgId, id, actor);
  }
}
