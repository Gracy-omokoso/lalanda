// Conversion prospect → client — ADR-0040 § 3.1.1. ADR-0040 — C1.
//
// `crm.manage` + `sales.manage` : convertir crée ou rattache une fiche client
// (NIF, type DGI), geste de Ventes. Le Commercial, qui n'a pas `sales.manage`,
// reçoit 403 (décision ouverte n° 4 d'ADR-0040, défaut appliqué).

import { ConvertCrmAccountBody } from '@lalanda/shared/crm';
import { Body, Controller, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../../auth/current-user.decorator.js';
import { RequirePermission } from '../../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../../authz/permissions.guard.js';
import type { OrgRole } from '../../../authz/permissions.js';
import { invalidRequest } from '../../../sales/sales.errors.js';
import { crmActorOf } from '../../crm-actor.js';
import {
  CrmAccountConversionService,
  type ConversionResult,
} from './crm-account-conversion.service.js';

@Controller('crm/accounts')
@UseGuards(AuthGuard, PermissionsGuard)
export class CrmAccountConversionController {
  constructor(
    @Inject(CrmAccountConversionService)
    private readonly conversion: CrmAccountConversionService,
  ) {}

  @Post(':accountId/convert')
  @HttpCode(200)
  @RequirePermission('crm.manage', 'sales.manage')
  async convert(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
  ): Promise<ConversionResult> {
    const parsed = ConvertCrmAccountBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.conversion.convert(orgId, accountId, parsed.data, crmActorOf(user, role));
  }
}
