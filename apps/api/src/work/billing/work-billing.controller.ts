// Branchements « argent » des projets du RUN — ADR-0039 § 4 (lot L4a).
//
//   POST   /work/projects/from-quote                       work.manage + sales.read
//   GET    /work/quotes/:quoteId/project                   work.read + sales.read
//   POST   /work/projects/from-opportunity                 work.manage + crm.read (+ sales.read si quoteId)
//   GET    /work/opportunities/:opportunityId/project      work.read + crm.read
//   GET    /work/projects/:projectId/invoices              work.read + sales.read
//   POST   /work/projects/:projectId/invoices              work.manage + sales.read
//   DELETE /work/projects/:projectId/invoices/:invoiceId   work.manage
//   POST   /work/tasks/:taskId/prepare-invoice             work.read + sales.manage
//   GET    /work/projects/:projectId/margin                work.read + sales.read + treasury.read
//
// Les actions listées sont TOUTES requises (sémantique conjonctive). Le brouillon
// préparé n'est jamais émis ni normalisé : « Émettre » reste un geste de
// l'utilisateur sous `sales.invoice`. Ressource d'une autre organisation : 404.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CreateProjectFromOpportunityBody,
  CreateProjectFromQuoteBody,
  LinkInvoiceBody,
  PrepareInvoiceBody,
  ProjectMarginQuery,
  type ProjectMarginView,
  type WorkInvoiceLinkView,
  type WorkProjectView,
} from '@lalanda/shared/work';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { ProjectMarginService } from '../margin/project-margin.service.js';
import { WorkIdPipe, workActorOf } from '../work.common.js';
import {
  WorkBillingService,
  type BillingUser,
  type PreparedInvoiceView,
} from './work-billing.service.js';

@Controller('work')
@UseGuards(AuthGuard, PermissionsGuard)
export class WorkBillingController {
  constructor(
    @Inject(WorkBillingService) private readonly billing: WorkBillingService,
    @Inject(ProjectMarginService) private readonly margins: ProjectMarginService,
  ) {}

  @Post('projects/from-quote')
  @RequirePermission('work.manage', 'sales.read')
  async createFromQuote(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: BillingUser,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Body() body: unknown,
  ): Promise<WorkProjectView> {
    const parsed = CreateProjectFromQuoteBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.billing.createFromQuote(orgId, parsed.data, workActorOf(user, perms));
  }

  /** Projet créé depuis ce devis, ou `null` : la fiche du devis propose « Ouvrir le projet ». */
  @Get('quotes/:quoteId/project')
  @RequirePermission('work.read', 'sales.read')
  async projectForQuote(
    @CurrentOrgId() orgId: string,
    @Param('quoteId', WorkIdPipe) quoteId: string,
  ): Promise<{ projectId: string | null }> {
    return this.billing.projectForQuote(orgId, quoteId);
  }

  /**
   * ADR-0040 — C7 § 6.4 : opportunité gagnée → projet. `sales.read` n'est exigé
   * que pour désigner un devis (`quoteId`) : contrôle dans le service, sur les
   * droits EFFECTIFS de l'appelant (ADR-0041).
   */
  @Post('projects/from-opportunity')
  @RequirePermission('work.manage', 'crm.read')
  async createFromOpportunity(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: BillingUser,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Body() body: unknown,
  ): Promise<WorkProjectView> {
    const parsed = CreateProjectFromOpportunityBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.billing.createFromOpportunity(orgId, parsed.data, workActorOf(user, perms));
  }

  /** Projet issu de cette opportunité (ou d'un de ses devis), ou `null`. */
  @Get('opportunities/:opportunityId/project')
  @RequirePermission('work.read', 'crm.read')
  async projectForOpportunity(
    @CurrentOrgId() orgId: string,
    @Param('opportunityId', WorkIdPipe) opportunityId: string,
  ): Promise<{ projectId: string | null }> {
    return this.billing.projectForOpportunity(orgId, opportunityId);
  }

  @Get('projects/:projectId/invoices')
  @RequirePermission('work.read', 'sales.read')
  async listInvoices(
    @CurrentOrgId() orgId: string,
    @Param('projectId', WorkIdPipe) projectId: string,
  ): Promise<{ items: WorkInvoiceLinkView[] }> {
    return { items: await this.billing.list(orgId, projectId) };
  }

  @Post('projects/:projectId/invoices')
  @RequirePermission('work.manage', 'sales.read')
  async linkInvoice(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: BillingUser,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('projectId', WorkIdPipe) projectId: string,
    @Body() body: unknown,
  ): Promise<WorkInvoiceLinkView> {
    const parsed = LinkInvoiceBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.billing.link(orgId, projectId, parsed.data.invoiceId, workActorOf(user, perms));
  }

  @Delete('projects/:projectId/invoices/:invoiceId')
  @HttpCode(204)
  @RequirePermission('work.manage')
  async unlinkInvoice(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: BillingUser,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('projectId', WorkIdPipe) projectId: string,
    @Param('invoiceId', WorkIdPipe) invoiceId: string,
  ): Promise<void> {
    await this.billing.unlink(orgId, projectId, invoiceId, workActorOf(user, perms));
  }

  @Post('tasks/:taskId/prepare-invoice')
  @RequirePermission('work.read', 'sales.manage')
  async prepareInvoice(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: BillingUser,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('taskId', WorkIdPipe) taskId: string,
    @Body() body: unknown,
  ): Promise<PreparedInvoiceView> {
    const parsed = PrepareInvoiceBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.billing.prepareInvoice(orgId, taskId, parsed.data, workActorOf(user, perms), user);
  }

  @Get('projects/:projectId/margin')
  @RequirePermission('work.read', 'sales.read', 'treasury.read')
  async margin(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: BillingUser,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('projectId', WorkIdPipe) projectId: string,
    @Query() query: unknown,
  ): Promise<ProjectMarginView> {
    const parsed = ProjectMarginQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de période invalides.');
    return this.margins.margin(orgId, projectId, parsed.data, workActorOf(user, perms));
  }
}
