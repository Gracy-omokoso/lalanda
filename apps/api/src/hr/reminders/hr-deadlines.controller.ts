// Échéances RH — ADR-0045 § 3.3. ADR-0045 — H4.
//
//   GET /hr/deadlines?within=   hr.read — fins d'essai, fins de contrat, documents et
//                               pièces d'identité qui expirent (moteur `hrDeadlines`).
//
// Sans `within`, les délais des réglages (`reminders` : 15, 30, 30 jours par défaut).
// Le libellé d'un document sensible et la nature d'une pièce d'identité ne sont
// servis qu'avec `hr.sensitive.read` ; jamais un numéro.

import { HrDeadlinesQuery, type HrDeadlinesView } from '@lalanda/shared/hr';
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { effectiveActions } from '../../authz/permissions.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { HrDeadlinesService } from './hr-deadlines.service.js';

@Controller('hr')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrDeadlinesController {
  constructor(@Inject(HrDeadlinesService) private readonly deadlines: HrDeadlinesService) {}

  @Get('deadlines')
  @RequirePermission('hr.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
  ): Promise<HrDeadlinesView> {
    const parsed = HrDeadlinesQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    const seesSensitive = perms
      ? effectiveActions(perms.role, perms.context).includes('hr.sensitive.read')
      : false;
    return this.deadlines.view(orgId, seesSensitive, parsed.data.within);
  }
}
