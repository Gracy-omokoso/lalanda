// Réglages du formulaire public de prospects — ADR-0048 § 5.1.
//
// `crm.read` pour lire ; `crm.manage` pour créer, régler, activer et remplacer
// le lien. Organisation active seulement.

import {
  CreateLeadFormBody,
  RotateLeadFormTokenBody,
  UpdateLeadFormBody,
  type CrmLeadFormEnvelope,
  type CrmLeadFormView,
} from '@lalanda/shared/crm';
import { Body, Controller, Get, Inject, Post, Put, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { crmActorOf } from '../crm-actor.js';
import { CrmLeadFormsService } from './crm-lead-forms.service.js';

@Controller('crm/lead-form')
@UseGuards(AuthGuard, PermissionsGuard)
export class CrmLeadFormsController {
  constructor(@Inject(CrmLeadFormsService) private readonly forms: CrmLeadFormsService) {}

  @Get()
  @RequirePermission('crm.read')
  async get(@CurrentOrgId() orgId: string): Promise<CrmLeadFormEnvelope> {
    return { form: await this.forms.get(orgId) };
  }

  @Post()
  @RequirePermission('crm.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<CrmLeadFormView> {
    const parsed = CreateLeadFormBody.safeParse(body ?? {});
    if (!parsed.success) invalidRequest(parsed.error);
    return this.forms.create(orgId, parsed.data, crmActorOf(user, role));
  }

  @Put()
  @RequirePermission('crm.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<CrmLeadFormView> {
    const parsed = UpdateLeadFormBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.forms.update(orgId, parsed.data, crmActorOf(user, role));
  }

  @Post('rotate-token')
  @RequirePermission('crm.manage')
  async rotateToken(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<CrmLeadFormView> {
    const parsed = RotateLeadFormTokenBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.forms.rotateToken(orgId, parsed.data.expectedRevision, crmActorOf(user, role));
  }
}
