// Présences et pointage simple — ADR-0051 § 3.4, § 6.2. ADR-0051 — H12.
//
//   GET  /hr/attendance/settings                    analytics.read (pointage, plannings activés ?)
//   PUT  /hr/attendance/settings                    hr.manage (réglages `attendance.*`, `planning.*`)
//   POST /hr/attendance/clock                       attendance.clock (pour soi, heure du serveur)
//   POST /hr/attendance/events                      analytics.read + manager (équipe) ou hr.manage
//   GET  /hr/attendance/days                        analytics.read + portée (soi, équipe, hr.read)
//   GET  /hr/attendance/corrections                 analytics.read + portée
//   POST /hr/attendance/corrections                 analytics.read + attendance.clock (pour soi)
//                                                   ou manager / hr.manage (pour autrui)
//   POST /hr/attendance/corrections/:id/approve     analytics.read + attendanceCorrectionDecision
//   POST /hr/attendance/corrections/:id/reject      analytics.read + attendanceCorrectionDecision
//
// Routes RELATIONNELLES (motif d'ADR-0045 § 4.4) : le manager n'a besoin d'aucune action ;
// la portée est décidée dans le service sur les droits EFFECTIFS, hors portée → 404.
// Toute route rend `409 HR_FEATURE_DISABLED` tant que le pointage est éteint (défaut),
// sauf la lecture et l'écriture des réglages.

import {
  AttendanceDaysQuery,
  ClockAttendanceBody,
  CreateAttendanceCorrectionBody,
  CreateAttendanceEventBody,
  DecideAttendanceCorrectionBody,
  ListAttendanceCorrectionsQuery,
  RejectAttendanceCorrectionBody,
} from '@lalanda/shared/hr';
import {
  Body,
  Controller,
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
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import { HrScopeService } from '../scope/hr-scope.service.js';
import {
  HrAttendanceService,
  type AttendanceClockView,
  type AttendanceCorrectionPage,
  type AttendanceCorrectionView,
  type AttendanceDaysView,
  type AttendanceEventView,
} from './hr-attendance.service.js';
import {
  HrPresenceSettingsService,
  UpdatePresenceSettingsBody,
  type HrPresenceSettingsView,
} from './hr-presence-settings.js';
import { RequireFeature } from '../../billing/feature.guard.js';

type User = { id: string };
type Perms = CurrentOrgPermissionsValue | undefined;

function actorOf(user: User, perms: Perms): HrActor {
  return { userId: user.id, role: perms?.role ?? 'unknown' };
}

@Controller('hr/attendance')
@RequireFeature('hr') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class HrAttendanceController {
  constructor(
    @Inject(HrAttendanceService) private readonly attendance: HrAttendanceService,
    @Inject(HrPresenceSettingsService) private readonly settings: HrPresenceSettingsService,
    @Inject(HrScopeService) private readonly scope: HrScopeService,
  ) {}

  @Get('settings')
  @RequirePermission('analytics.read')
  async getSettings(@CurrentOrgId() orgId: string): Promise<HrPresenceSettingsView> {
    return this.settings.view(orgId);
  }

  @Put('settings')
  @RequirePermission('hr.manage')
  async putSettings(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() body: unknown,
  ): Promise<HrPresenceSettingsView> {
    const parsed = UpdatePresenceSettingsBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Réglages des présences : saisie invalide.');
    return this.settings.update(orgId, parsed.data, actorOf(user, perms));
  }

  @Post('clock')
  @RequirePermission('attendance.clock')
  async clock(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() body: unknown,
  ): Promise<AttendanceClockView> {
    const parsed = ClockAttendanceBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Pointage invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.attendance.clock(orgId, viewer, parsed.data, actorOf(user, perms));
  }

  @Post('events')
  @RequirePermission('analytics.read')
  async record(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() body: unknown,
  ): Promise<AttendanceEventView> {
    const parsed = CreateAttendanceEventBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Pointage invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.attendance.record(orgId, viewer, parsed.data, actorOf(user, perms));
  }

  @Get('days')
  @RequirePermission('analytics.read')
  async days(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Query() query: unknown,
  ): Promise<AttendanceDaysView> {
    const parsed = AttendanceDaysQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.attendance.days(orgId, viewer, parsed.data);
  }

  @Get('corrections')
  @RequirePermission('analytics.read')
  async listCorrections(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Query() query: unknown,
  ): Promise<AttendanceCorrectionPage> {
    const parsed = ListAttendanceCorrectionsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.attendance.listCorrections(orgId, viewer, parsed.data);
  }

  @Post('corrections')
  @RequirePermission('analytics.read')
  async requestCorrection(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() body: unknown,
  ): Promise<AttendanceCorrectionView> {
    const parsed = CreateAttendanceCorrectionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Demande de correction invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.attendance.requestCorrection(orgId, viewer, parsed.data, actorOf(user, perms));
  }

  @Post('corrections/:correctionId/approve')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async approve(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('correctionId') correctionId: string,
    @Body() body: unknown,
  ): Promise<AttendanceCorrectionView> {
    const parsed = DecideAttendanceCorrectionBody.safeParse(body ?? {});
    if (!parsed.success) invalidRequest(parsed.error);
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.attendance.approveCorrection(
      orgId,
      viewer,
      correctionId,
      parsed.data,
      actorOf(user, perms),
    );
  }

  @Post('corrections/:correctionId/reject')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async reject(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('correctionId') correctionId: string,
    @Body() body: unknown,
  ): Promise<AttendanceCorrectionView> {
    const parsed = RejectAttendanceCorrectionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Un refus porte un commentaire.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.attendance.rejectCorrection(
      orgId,
      viewer,
      correctionId,
      parsed.data,
      actorOf(user, perms),
    );
  }
}
