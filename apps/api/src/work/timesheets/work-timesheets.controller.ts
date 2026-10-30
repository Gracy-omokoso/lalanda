// Feuille de temps hebdomadaire en lecture — ADR-0045 § 3.3, § 6.3. ADR-0045 — H5.
//
//   GET /work/timesheets?userId=&week=   work.read (soi) ; autrui : work.manage ou manager
//
// La décision « autrui » est prise dans le service (droits effectifs, relation de
// manager du moteur RH). Aucune route d'écriture : ni saisie, ni validation.

import { WeeklyTimesheetQuery, type WeeklyTimesheetView } from '@lalanda/shared/work';
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
import { workActorOf } from '../work.common.js';
import { WorkTimesheetsService } from './work-timesheets.service.js';

@Controller('work/timesheets')
@UseGuards(AuthGuard, PermissionsGuard)
export class WorkTimesheetsController {
  constructor(@Inject(WorkTimesheetsService) private readonly timesheets: WorkTimesheetsService) {}

  @Get()
  @RequirePermission('work.read')
  async weekly(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
  ): Promise<WeeklyTimesheetView> {
    const parsed = WeeklyTimesheetQuery.safeParse(query);
    if (!parsed.success)
      invalidRequest(parsed.error, 'Paramètres de la feuille de temps invalides.');
    return this.timesheets.weekly(orgId, parsed.data, workActorOf(user, perms));
  }
}
