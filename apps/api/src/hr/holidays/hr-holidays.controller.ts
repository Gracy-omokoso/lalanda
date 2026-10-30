// Jours fériés et de fermeture — ADR-0045 § 2.6, § 3.2. ADR-0045 — H3.
//
//   GET    /hr/holidays?year=        analytics.read
//   POST   /hr/holidays              hr.manage
//   DELETE /hr/holidays/:holidayId   hr.manage

import {
  CreateHolidayBody,
  ListHolidaysQuery,
  type HolidayListView,
  type HolidayView,
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
import { HrHolidaysService } from './hr-holidays.service.js';

@Controller('hr/holidays')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrHolidaysController {
  constructor(@Inject(HrHolidaysService) private readonly holidays: HrHolidaysService) {}

  @Get()
  @RequirePermission('analytics.read')
  async list(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<HolidayListView> {
    const parsed = ListHolidaysQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    return this.holidays.list(orgId, parsed.data);
  }

  @Post()
  @RequirePermission('hr.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<HolidayView> {
    const parsed = CreateHolidayBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Jour férié invalide.');
    return this.holidays.create(orgId, parsed.data, { userId: user.id, role: role ?? 'unknown' });
  }

  @Delete(':holidayId')
  @HttpCode(204)
  @RequirePermission('hr.manage')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('holidayId') holidayId: string,
  ): Promise<void> {
    await this.holidays.remove(orgId, holidayId, { userId: user.id, role: role ?? 'unknown' });
  }
}
