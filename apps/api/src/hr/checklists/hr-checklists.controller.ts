// Modèles et listes d'entrée et de sortie — ADR-0045 § 2.9, § 3.3. ADR-0045 — H4.
//
//   GET    /hr/checklist-templates                          hr.read
//   POST   /hr/checklist-templates                          hr.manage
//   PUT    /hr/checklist-templates/:templateId              hr.manage
//   DELETE /hr/checklist-templates/:templateId              hr.manage (désactive)
//   POST   /hr/employees/:employeeId/checklists { templateId, hrAssigneeUserId? }   hr.manage
//   GET    /hr/checklists?employeeId=&open=                 hr.read
//   POST   /hr/checklists/:checklistId/items/:itemId/done · /undone
//                                   analytics.read : l'assigné, ou hr.manage (sinon 404)
//
// Les listes ne sont PAS des tâches RUN (O4) : aucun projet ne les voit.

import {
  CreateChecklistTemplateBody,
  InstantiateChecklistBody,
  ListChecklistsQuery,
  UpdateChecklistTemplateBody,
  type ChecklistItemView,
  type ChecklistPage,
  type ChecklistTemplatePage,
  type ChecklistTemplateView,
  type ChecklistView,
} from '@lalanda/shared/hr';
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
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../../authz/current-org-permissions.decorator.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { HrScopeService } from '../scope/hr-scope.service.js';
import { HrChecklistsService, type HrChecklistActor } from './hr-checklists.service.js';

type User = { id: string };

function actorOf(user: User, role: OrgRole | undefined): HrChecklistActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

@Controller('hr')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrChecklistsController {
  constructor(
    @Inject(HrChecklistsService) private readonly checklists: HrChecklistsService,
    @Inject(HrScopeService) private readonly scope: HrScopeService,
  ) {}

  @Get('checklist-templates')
  @RequirePermission('hr.read')
  async listTemplates(@CurrentOrgId() orgId: string): Promise<ChecklistTemplatePage> {
    return this.checklists.listTemplates(orgId);
  }

  @Post('checklist-templates')
  @RequirePermission('hr.manage')
  async createTemplate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<ChecklistTemplateView> {
    const parsed = CreateChecklistTemplateBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.checklists.createTemplate(orgId, parsed.data, actorOf(user, role));
  }

  @Put('checklist-templates/:templateId')
  @RequirePermission('hr.manage')
  async updateTemplate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('templateId') templateId: string,
    @Body() body: unknown,
  ): Promise<ChecklistTemplateView> {
    const parsed = UpdateChecklistTemplateBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.checklists.updateTemplate(orgId, templateId, parsed.data, actorOf(user, role));
  }

  @Delete('checklist-templates/:templateId')
  @HttpCode(204)
  @RequirePermission('hr.manage')
  async removeTemplate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('templateId') templateId: string,
  ): Promise<void> {
    await this.checklists.removeTemplate(orgId, templateId, actorOf(user, role));
  }

  @Post('employees/:employeeId/checklists')
  @HttpCode(201)
  @RequirePermission('hr.manage')
  async instantiate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ): Promise<ChecklistView> {
    const parsed = InstantiateChecklistBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.checklists.instantiate(orgId, viewer, employeeId, parsed.data, actorOf(user, role));
  }

  @Get('checklists')
  @RequirePermission('hr.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
  ): Promise<ChecklistPage> {
    const parsed = ListChecklistsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.checklists.list(orgId, viewer, parsed.data);
  }

  @Post('checklists/:checklistId/items/:itemId/done')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async done(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('checklistId') checklistId: string,
    @Param('itemId') itemId: string,
  ): Promise<ChecklistItemView> {
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.checklists.toggle(orgId, viewer, checklistId, itemId, true, actorOf(user, role));
  }

  @Post('checklists/:checklistId/items/:itemId/undone')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async undone(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('checklistId') checklistId: string,
    @Param('itemId') itemId: string,
  ): Promise<ChecklistItemView> {
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.checklists.toggle(orgId, viewer, checklistId, itemId, false, actorOf(user, role));
  }
}
