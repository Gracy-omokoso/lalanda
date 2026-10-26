// Opportunités — ADR-0035 § 4.
//
// `crm.read` pour lire ; `crm.manage` pour créer, modifier, déplacer, supprimer,
// importer et exporter. Une opportunité d'une autre organisation répond 404.

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
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import type { OrgRole } from '../authz/permissions.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { crmActorOf, sendCsv } from './crm-actor.js';
import { CrmCsvService, type ImportResult } from './crm-csv.service.js';
import {
  CreateOpportunitySchema,
  CsvImportSchema,
  ListOpportunitiesQuerySchema,
  MoveOpportunitySchema,
  PutOpportunitySchema,
} from './crm.dto.js';
import {
  OpportunitiesService,
  type OpportunityPage,
  type OpportunityView,
} from './opportunities.service.js';

type User = { id: string };

@Controller('crm/opportunities')
@UseGuards(AuthGuard, PermissionsGuard)
export class CrmOpportunitiesController {
  constructor(
    @Inject(OpportunitiesService) private readonly opportunities: OpportunitiesService,
    @Inject(CrmCsvService) private readonly csv: CrmCsvService,
  ) {}

  @Get()
  @RequirePermission('crm.read')
  async list(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<OpportunityPage> {
    const parsed = ListOpportunitiesQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.opportunities.list(orgId, parsed.data);
  }

  @Get('export')
  @RequirePermission('crm.manage')
  async export(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    sendCsv(res, await this.csv.exportOpportunities(orgId, crmActorOf(user, role)));
  }

  @Post('import')
  @HttpCode(200)
  @RequirePermission('crm.manage')
  async import(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<ImportResult> {
    const parsed = CsvImportSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.csv.importOpportunities(
      orgId,
      parsed.data.csv,
      parsed.data.dryRun,
      crmActorOf(user, role),
    );
  }

  @Post()
  @RequirePermission('crm.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<OpportunityView> {
    const parsed = CreateOpportunitySchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.opportunities.create(
      orgId,
      parsed.data.stageKey,
      parsed.data.opportunity,
      crmActorOf(user, role),
    );
  }

  @Get(':opportunityId')
  @RequirePermission('crm.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('opportunityId') opportunityId: string,
  ): Promise<OpportunityView> {
    return this.opportunities.get(orgId, opportunityId);
  }

  @Put(':opportunityId')
  @RequirePermission('crm.manage')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('opportunityId') opportunityId: string,
    @Body() body: unknown,
  ): Promise<OpportunityView> {
    const parsed = PutOpportunitySchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.opportunities.put(
      orgId,
      opportunityId,
      parsed.data.expectedRevision,
      parsed.data.opportunity,
      crmActorOf(user, role),
    );
  }

  @Post(':opportunityId/move')
  @HttpCode(200)
  @RequirePermission('crm.manage')
  async move(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('opportunityId') opportunityId: string,
    @Body() body: unknown,
  ): Promise<OpportunityView> {
    const parsed = MoveOpportunitySchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.opportunities.move(
      orgId,
      opportunityId,
      parsed.data.expectedRevision,
      parsed.data.stageKey,
      parsed.data.lostReason,
      crmActorOf(user, role),
    );
  }

  @Delete(':opportunityId')
  @HttpCode(204)
  @RequirePermission('crm.manage')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('opportunityId') opportunityId: string,
  ): Promise<void> {
    await this.opportunities.remove(orgId, opportunityId, crmActorOf(user, role));
  }
}
