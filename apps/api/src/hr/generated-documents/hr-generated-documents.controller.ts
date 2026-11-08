// Documents RH générés — routes (ADR-0072 § 5).
//
//   GET  /hr/generated-documents/settings                         hr.read
//   PUT  /hr/generated-documents/settings                         hr.manage
//   GET  /hr/employees/:employeeId/generated-documents            hr.read   (registre)
//   POST /hr/employees/:employeeId/generated-documents/preview    hr.manage (PDF, 60/h)
//   POST /hr/employees/:employeeId/generated-documents            hr.manage (30/h)
//
// Aucune action nouvelle. L'adresse personnelle exige EN PLUS `hr.sensitive.read`
// (décidé dans le service, droits EFFECTIFS). Le PDF produit est un document RH :
// sa lecture et son téléchargement sont ceux d'ADR-0045 § 2.8. Aucune donnée n'est
// envoyée à l'IA.

import {
  GENERATED_DOCUMENT_LIMITS,
  GenerateHrDocumentBody,
  PutGeneratedDocumentSettingsBody,
  type GeneratedDocumentPage,
  type GeneratedDocumentSettingsView,
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
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

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
import { RequireFeature } from '../../billing/feature.guard.js';
import { storageFailure } from '../../purchases/attachments/purchase-attachments.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { UserThrottlerGuard } from '../../security/user-throttler.guard.js';
import { HrScopeService } from '../scope/hr-scope.service.js';
import {
  HrGeneratedDocumentsService,
  type GeneratedDocActor,
  type GeneratedDocResult,
} from './hr-generated-documents.service.js';

type User = { id: string };

function actorOf(user: User, role: OrgRole | undefined): GeneratedDocActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

@Controller('hr')
@RequireFeature('hr') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class HrGeneratedDocumentsController {
  constructor(
    @Inject(HrGeneratedDocumentsService) private readonly generated: HrGeneratedDocumentsService,
    @Inject(HrScopeService) private readonly scope: HrScopeService,
  ) {}

  @Get('generated-documents/settings')
  @RequirePermission('hr.read')
  async getSettings(@CurrentOrgId() orgId: string): Promise<GeneratedDocumentSettingsView> {
    return this.generated.settings(orgId);
  }

  @Put('generated-documents/settings')
  @RequirePermission('hr.manage')
  async putSettings(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<GeneratedDocumentSettingsView> {
    const parsed = PutGeneratedDocumentSettingsBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Réglages des documents invalides.');
    return this.generated.putSettings(orgId, parsed.data, actorOf(user, role));
  }

  @Get('employees/:employeeId/generated-documents')
  @RequirePermission('hr.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('employeeId') employeeId: string,
  ): Promise<GeneratedDocumentPage> {
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.generated.list(orgId, viewer, employeeId);
  }

  @Post('employees/:employeeId/generated-documents/preview')
  @HttpCode(200)
  @RequirePermission('hr.manage')
  @Throttle({ default: { ttl: 3_600_000, limit: GENERATED_DOCUMENT_LIMITS.previewsPerHour } })
  @UseGuards(UserThrottlerGuard)
  async preview(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = GenerateHrDocumentBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Demande de document invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    const pdf = await this.generated.preview(
      orgId,
      viewer,
      employeeId,
      parsed.data,
      actorOf(user, role),
    );
    res
      .status(200)
      .set({
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': 'inline; filename="apercu.pdf"',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'private, no-store',
      })
      .end(pdf);
  }

  @Post('employees/:employeeId/generated-documents')
  @HttpCode(201)
  @RequirePermission('hr.manage')
  @Throttle({ default: { ttl: 3_600_000, limit: GENERATED_DOCUMENT_LIMITS.generationsPerHour } })
  @UseGuards(UserThrottlerGuard)
  async generate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ): Promise<GeneratedDocResult> {
    const parsed = GenerateHrDocumentBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Demande de document invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    try {
      return await this.generated.generate(
        orgId,
        viewer,
        employeeId,
        parsed.data,
        actorOf(user, role),
      );
    } catch (cause) {
      throw storageFailure(cause);
    }
  }
}
