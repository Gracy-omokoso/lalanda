// Plannings — ADR-0051 § 2.4, § 3.6, § 6.2. ADR-0051 — H12.
//
//   GET    /hr/shifts                        analytics.read + portée (soi, équipe, service,
//                                            organisation selon le calendrier d'équipe)
//   POST   /hr/shifts                        analytics.read + manager (équipe) ou hr.manage
//   PUT    /hr/shifts/:id                    idem
//   POST   /hr/shifts/:id/cancel             idem
//   POST   /hr/shifts/publish                idem
//   POST   /hr/shifts/copy-week              idem (brouillons)
//   POST   /hr/shifts/:id/unavailability     analytics.read + le collaborateur planifié
//   GET    /hr/staffing-needs                hr.read
//   POST   /hr/staffing-needs                hr.manage
//   PUT    /hr/staffing-needs/:id            hr.manage
//   DELETE /hr/staffing-needs/:id            hr.manage
//   GET    /hr/planning/gaps                 analytics.read + manager (équipe) ou hr.read
//
// Routes RELATIONNELLES (motif d'ADR-0045 § 4.4) : le manager n'a besoin d'aucune action ;
// la portée est décidée dans le service sur les droits EFFECTIFS, hors portée → 404.
// Toute route rend `409 HR_FEATURE_DISABLED` tant que les plannings sont éteints (défaut).
// Lire ses créneaux ne demande ni `attendance.clock` ni `leave.request` au guard : la
// relation (soi, équipe, calendrier) suffit, comme pour le calendrier des absences.

import {
  CopyShiftWeekBody,
  CreateShiftBody,
  ListShiftsQuery,
  PlanningGapsQuery,
  PublishShiftsBody,
  ShiftUnavailabilityBody,
  StaffingNeedBody,
  UpdateShiftBody,
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
import { z } from 'zod';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import { HrScopeService } from '../scope/hr-scope.service.js';
import {
  HrPlanningService,
  type PlanningGapsView,
  type ShiftListView,
  type ShiftView,
  type ShiftWriteView,
  type StaffingNeedView,
} from './hr-planning.service.js';
import { RequireFeature } from '../../billing/feature.guard.js';

type User = { id: string };
type Perms = CurrentOrgPermissionsValue | undefined;

/** Révision attendue (annulation d'un créneau, modification d'un besoin). */
const ExpectedRevision = z.object({ expectedRevision: z.number().int().min(1) }).strict();

function actorOf(user: User, perms: Perms): HrActor {
  return { userId: user.id, role: perms?.role ?? 'unknown' };
}

@Controller('hr')
@RequireFeature('hr') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class HrShiftsController {
  constructor(
    @Inject(HrPlanningService) private readonly planning: HrPlanningService,
    @Inject(HrScopeService) private readonly scope: HrScopeService,
  ) {}

  @Get('shifts')
  @RequirePermission('analytics.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Query() query: unknown,
  ): Promise<ShiftListView> {
    const parsed = ListShiftsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.planning.list(orgId, viewer, parsed.data);
  }

  @Post('shifts')
  @RequirePermission('analytics.read')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() body: unknown,
  ): Promise<ShiftWriteView> {
    const parsed = CreateShiftBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Créneau invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.planning.create(orgId, viewer, parsed.data, actorOf(user, perms));
  }

  @Post('shifts/publish')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async publish(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() body: unknown,
  ): Promise<{ published: number; items: ShiftView[] }> {
    const parsed = PublishShiftsBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Publication invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.planning.publish(orgId, viewer, parsed.data, actorOf(user, perms));
  }

  @Post('shifts/copy-week')
  @RequirePermission('analytics.read')
  async copyWeek(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() body: unknown,
  ): Promise<Awaited<ReturnType<HrPlanningService['copyWeek']>>> {
    const parsed = CopyShiftWeekBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Copie de semaine invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.planning.copyWeek(orgId, viewer, parsed.data, actorOf(user, perms));
  }

  @Put('shifts/:shiftId')
  @RequirePermission('analytics.read')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('shiftId') shiftId: string,
    @Body() body: unknown,
  ): Promise<ShiftWriteView> {
    const parsed = UpdateShiftBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Créneau invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.planning.update(orgId, viewer, shiftId, parsed.data, actorOf(user, perms));
  }

  @Post('shifts/:shiftId/cancel')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async cancel(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('shiftId') shiftId: string,
    @Body() body: unknown,
  ): Promise<ShiftView> {
    const parsed = ExpectedRevision.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.planning.cancel(
      orgId,
      viewer,
      shiftId,
      parsed.data.expectedRevision,
      actorOf(user, perms),
    );
  }

  @Post('shifts/:shiftId/unavailability')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async unavailability(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('shiftId') shiftId: string,
    @Body() body: unknown,
  ): Promise<ShiftView> {
    const parsed = ShiftUnavailabilityBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Indisponibilité : commentaire attendu.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.planning.signalUnavailability(
      orgId,
      viewer,
      shiftId,
      parsed.data,
      actorOf(user, perms),
    );
  }

  @Get('staffing-needs')
  @RequirePermission('hr.read')
  async listNeeds(@CurrentOrgId() orgId: string): Promise<{ items: StaffingNeedView[] }> {
    return this.planning.listNeeds(orgId);
  }

  @Post('staffing-needs')
  @RequirePermission('hr.manage')
  async createNeed(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() body: unknown,
  ): Promise<StaffingNeedView> {
    const parsed = StaffingNeedBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Besoin d’effectif invalide.');
    return this.planning.createNeed(orgId, parsed.data, actorOf(user, perms));
  }

  @Put('staffing-needs/:needId')
  @RequirePermission('hr.manage')
  async updateNeed(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('needId') needId: string,
    @Body() body: unknown,
  ): Promise<StaffingNeedView> {
    const raw = (body ?? {}) as Record<string, unknown>;
    const { expectedRevision, ...rest } = typeof raw === 'object' ? raw : {};
    const rev = ExpectedRevision.safeParse({ expectedRevision });
    if (!rev.success) invalidRequest(rev.error);
    const parsed = StaffingNeedBody.safeParse(rest);
    if (!parsed.success) invalidRequest(parsed.error, 'Besoin d’effectif invalide.');
    return this.planning.updateNeed(
      orgId,
      needId,
      rev.data.expectedRevision,
      parsed.data,
      actorOf(user, perms),
    );
  }

  @Delete('staffing-needs/:needId')
  @HttpCode(204)
  @RequirePermission('hr.manage')
  async deleteNeed(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('needId') needId: string,
  ): Promise<void> {
    await this.planning.deleteNeed(orgId, needId, actorOf(user, perms));
  }

  @Get('planning/gaps')
  @RequirePermission('analytics.read')
  async gaps(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Query() query: unknown,
  ): Promise<PlanningGapsView> {
    const parsed = PlanningGapsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.planning.gaps(orgId, viewer, parsed.data);
  }
}
