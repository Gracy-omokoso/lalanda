// Calendrier des absences — ADR-0045 § 3.2, § 6.1. ADR-0045 — H3.
//
//   GET /hr/calendar?from=&to=&scope=me|team|department|organization   analytics.read
//
// Portée bornée par `teamCalendarVisibility` et par la portée du moteur
// (`hrViewerScope`) ; absences approuvées, et en attente pour soi, son équipe, les RH ;
// « Absent » pour un type confidentiel hors ayants droit (moteur `teamCalendar`).

import { HrCalendarQuery, type HrCalendarView } from '@lalanda/shared/hr';
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { HrLeaveService } from '../leave/hr-leave.service.js';
import { HrScopeService } from '../scope/hr-scope.service.js';

@Controller('hr/calendar')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrCalendarController {
  constructor(
    @Inject(HrLeaveService) private readonly leave: HrLeaveService,
    @Inject(HrScopeService) private readonly scope: HrScopeService,
  ) {}

  @Get()
  @RequirePermission('analytics.read')
  async calendar(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
  ): Promise<HrCalendarView> {
    const parsed = HrCalendarQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres du calendrier invalides.');
    return this.leave.calendar(
      orgId,
      await this.scope.viewerOf(orgId, user.id, perms),
      parsed.data,
    );
  }
}
