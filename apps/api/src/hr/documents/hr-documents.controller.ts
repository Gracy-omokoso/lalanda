// Documents RH — ADR-0045 § 2.8, § 3.3. ADR-0045 — H4.
//
//   GET    /hr/employees/:employeeId/documents?category=   analytics.read + portée :
//                                       hr.read (non sensibles), hr.sensitive.read (tous),
//                                       soi (visibleToEmployee) ; manager : 403
//   POST   /hr/employees/:employeeId/documents?category=&label=&issuedOn=&expiresOn=
//          &sensitive=&visibleToEmployee=   analytics.read + : hr.manage (+ hr.sensitive.read
//                                       si sensible) ; soi pour `leave_justification` ;
//                                       corps BINAIRE, nom en `X-File-Name`, 30 par heure
//   GET    /hr/documents/:documentId/file   comme la liste ; téléchargement INERTE ;
//                                       audit strict si sensible
//   DELETE /hr/documents/:documentId     hr.manage (+ hr.sensitive.read si sensible)
//
// Routes RELATIONNELLES (soi) : `analytics.read` au guard, décision dans le service sur
// les droits EFFECTIFS (`HrScopeService`). Hors portée, autre organisation : 404.

import {
  HR_LIMITS,
  ListHrDocumentsQuery,
  UploadHrDocumentQuery,
  type HrDocumentPage,
  type HrDocumentView,
} from '@lalanda/shared/hr';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

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
import { storageFailure } from '../../purchases/attachments/purchase-attachments.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { UserThrottlerGuard } from '../../security/user-throttler.guard.js';
import { contentDisposition } from '../../work/work-attachments.service.js';
import { HrScopeService } from '../scope/hr-scope.service.js';
import {
  HrDocumentsService,
  readHrDocumentBody,
  type HrDocumentActor,
} from './hr-documents.service.js';
import type { HrDocumentLean } from './hr-document.schema.js';

type User = { id: string };

function actorOf(user: User, role: OrgRole | undefined): HrDocumentActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

/** Sert un document : TOUJOURS en téléchargement, en-têtes inertes, jamais en cache. */
function sendDocument(res: Response, doc: HrDocumentLean, body: Buffer): void {
  res
    .status(200)
    .set({
      'Content-Type': doc.contentType,
      'Content-Length': String(body.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': contentDisposition('attachment', doc.fileName),
      'Cache-Control': 'private, no-store',
    })
    .end(body);
}

@Controller('hr')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrDocumentsController {
  constructor(
    @Inject(HrDocumentsService) private readonly documents: HrDocumentsService,
    @Inject(HrScopeService) private readonly scope: HrScopeService,
  ) {}

  @Get('employees/:employeeId/documents')
  @RequirePermission('analytics.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('employeeId') employeeId: string,
    @Query() query: unknown,
  ): Promise<HrDocumentPage> {
    const parsed = ListHrDocumentsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.documents.list(orgId, viewer, employeeId, parsed.data);
  }

  @Post('employees/:employeeId/documents')
  @HttpCode(201)
  @RequirePermission('analytics.read')
  @Throttle({ default: { ttl: 3_600_000, limit: HR_LIMITS.documentUploadsPerHour } })
  @UseGuards(UserThrottlerGuard)
  async upload(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('employeeId') employeeId: string,
    @Query() query: unknown,
    @Req() req: Request,
  ): Promise<HrDocumentView> {
    const parsed = UploadHrDocumentQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Métadonnées du document invalides.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    const meta = this.documents.assertCanUpload(viewer, employeeId, parsed.data);
    const file = await readHrDocumentBody(req);
    try {
      return await this.documents.upload(
        orgId,
        employeeId,
        meta,
        file,
        req.headers['x-file-name'],
        actorOf(user, role),
      );
    } catch (cause) {
      throw storageFailure(cause);
    }
  }

  @Get('documents/:documentId/file')
  @RequirePermission('analytics.read')
  async download(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    let found;
    try {
      found = await this.documents.download(orgId, viewer, documentId, actorOf(user, role));
    } catch (cause) {
      throw storageFailure(cause);
    }
    sendDocument(res, found.doc, found.body);
  }

  @Delete('documents/:documentId')
  @HttpCode(204)
  @RequirePermission('hr.manage')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('documentId') documentId: string,
  ): Promise<void> {
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    await this.documents.remove(orgId, viewer, documentId, actorOf(user, role));
  }
}
