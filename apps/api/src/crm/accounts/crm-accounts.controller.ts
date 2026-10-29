// Comptes 360° — ADR-0040 § 3.1. ADR-0040 — C1.
//
// `crm.read` pour lire ; `crm.manage` pour écrire. La conversion prospect → client
// (`POST …/:accountId/convert`, `crm.manage` + `sales.manage`) est servie par
// `CrmAccountConversionController` (module de composition qui importe Ventes) ;
// la fiche 360° et le fil chronologique par `CrmOverviewController` (lot C8).
// Un compte d'une autre organisation répond 404.

import {
  CreateCrmAccountBody,
  CrmAccountRevisionBody,
  ListCrmAccountsQuery,
  MergeCrmAccountBody,
  UpdateCrmAccountBody,
  type CrmAccountPage,
  type CrmAccountView,
  type CrmAccountWriteResult,
} from '@lalanda/shared/crm';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { crmActorOf } from '../crm-actor.js';
import { CrmAccountsService, type MergeResult } from './crm-accounts.service.js';

type User = { id: string };

@Controller('crm/accounts')
@UseGuards(AuthGuard, PermissionsGuard)
export class CrmAccountsController {
  constructor(@Inject(CrmAccountsService) private readonly accounts: CrmAccountsService) {}

  @Get()
  @RequirePermission('crm.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Query() query: unknown,
  ): Promise<CrmAccountPage> {
    const parsed = ListCrmAccountsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.accounts.list(orgId, parsed.data, crmActorOf(user, role));
  }

  @Post()
  @RequirePermission('crm.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<CrmAccountWriteResult> {
    const parsed = CreateCrmAccountBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.accounts.create(orgId, parsed.data, crmActorOf(user, role));
  }

  // Déclarée AVANT `:accountId` : sinon « migration-report » serait lu comme un identifiant.
  @Get('migration-report')
  @RequirePermission('crm.manage')
  async migrationReport(@CurrentOrgId() orgId: string): Promise<Record<string, unknown>> {
    const report = await this.accounts.migrationReport(orgId);
    if (!report) {
      throw new NotFoundException({
        code: 'CRM_MIGRATION_REPORT_NOT_FOUND',
        message: 'Aucun rapport de migration des comptes pour cette organisation.',
      });
    }
    return report;
  }

  @Get(':accountId')
  @RequirePermission('crm.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('accountId') accountId: string,
  ): Promise<CrmAccountView> {
    return this.accounts.get(orgId, accountId);
  }

  @Put(':accountId')
  @RequirePermission('crm.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
  ): Promise<CrmAccountWriteResult> {
    const parsed = UpdateCrmAccountBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.accounts.update(orgId, accountId, parsed.data, crmActorOf(user, role));
  }

  @Post(':accountId/archive')
  @HttpCode(200)
  @RequirePermission('crm.manage')
  async archive(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
  ): Promise<CrmAccountView> {
    const parsed = CrmAccountRevisionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.accounts.setActive(
      orgId,
      accountId,
      false,
      parsed.data.expectedRevision,
      crmActorOf(user, role),
    );
  }

  @Post(':accountId/restore')
  @HttpCode(200)
  @RequirePermission('crm.manage')
  async restore(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
  ): Promise<CrmAccountView> {
    const parsed = CrmAccountRevisionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.accounts.setActive(
      orgId,
      accountId,
      true,
      parsed.data.expectedRevision,
      crmActorOf(user, role),
    );
  }

  @Delete(':accountId')
  @HttpCode(204)
  @RequirePermission('crm.manage')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('accountId') accountId: string,
  ): Promise<void> {
    await this.accounts.remove(orgId, accountId, crmActorOf(user, role));
  }

  @Post(':accountId/merge')
  @HttpCode(200)
  @RequirePermission('crm.manage')
  async merge(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
  ): Promise<MergeResult> {
    const parsed = MergeCrmAccountBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.accounts.merge(
      orgId,
      accountId,
      parsed.data.targetAccountId,
      parsed.data.expectedRevision,
      crmActorOf(user, role),
    );
  }
}
