// Règles de correspondance (ADR-0049 § 2.4, § 11). ADR-0049 — K4.
//
//   GET  /accounting/rule-sets                      accounting.read
//   GET  /accounting/rule-sets/:version             accounting.read
//   POST /accounting/rule-sets                      accounting.manage   (brouillon)
//   PUT  /accounting/rule-sets/:version             accounting.manage
//   POST /accounting/rule-sets/:version/validate    accounting.manage   (ⓢ, ruleSetDecision)

import {
  CreateAccountingRuleSetBody,
  UpdateAccountingRuleSetBody,
  ValidateAccountingRuleSetBody,
  type AccountingRuleSetView,
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
  badRequest,
  CurrentAccountingActor,
  parseWith,
  type AccountingActor,
} from '../accounting.common.js';
import { AccountingRuleSetsService } from './accounting-rule-sets.service.js';
import { RequireFeature } from '../../billing/feature.guard.js';

function versionOf(raw: string): number {
  if (!/^[1-9]\d{0,5}$/.test(raw)) badRequest('INVALID_VERSION', 'Version de règles invalide.');
  return Number(raw);
}

@Controller('accounting/rule-sets')
@RequireFeature('accounting') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class AccountingRuleSetsController {
  constructor(
    @Inject(AccountingRuleSetsService) private readonly ruleSets: AccountingRuleSetsService,
  ) {}

  @Get()
  @RequirePermission('accounting.read')
  async list(@CurrentOrgId() orgId: string): Promise<{ items: AccountingRuleSetView[] }> {
    return { items: await this.ruleSets.list(orgId) };
  }

  @Get(':version')
  @RequirePermission('accounting.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('version') version: string,
  ): Promise<AccountingRuleSetView> {
    return this.ruleSets.get(orgId, versionOf(version));
  }

  @Post()
  @RequirePermission('accounting.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Body() body: unknown,
  ): Promise<AccountingRuleSetView> {
    parseWith(CreateAccountingRuleSetBody, body ?? {});
    return this.ruleSets.create(orgId, actor);
  }

  @Put(':version')
  @RequirePermission('accounting.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('version') version: string,
    @Body() body: unknown,
  ): Promise<AccountingRuleSetView> {
    return this.ruleSets.update(
      orgId,
      versionOf(version),
      parseWith(UpdateAccountingRuleSetBody, body),
      actor,
    );
  }

  @Post(':version/validate')
  @HttpCode(200)
  @RequirePermission('accounting.manage')
  async validate(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('version') version: string,
    @Body() body: unknown,
  ): Promise<AccountingRuleSetView> {
    return this.ruleSets.validate(
      orgId,
      versionOf(version),
      parseWith(ValidateAccountingRuleSetBody, body),
      actor,
    );
  }
}
