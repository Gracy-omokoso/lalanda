// Pièces jointes — ADR-0039 § 2.5 et § 4.
//
//   GET    /work/tasks/:taskId/attachments    work.read
//   POST   /work/tasks/:taskId/attachments    work.update — corps BINAIRE brut, nom en
//                                             en-tête `X-File-Name` (encodé URI) ;
//                                             30 envois par heure et par utilisateur
//   GET    /work/attachments/:attachmentId    work.read — octets, en-têtes inertes
//   DELETE /work/attachments/:attachmentId    work.update (déposant ; sinon work.manage)

import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WORK_LIMITS, type WorkAttachmentView } from '@lalanda/shared/work';
import type { Request, Response } from 'express';

import { readRequestBody } from '../account/request-body.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import { ObjectStorageUnavailableError } from '../storage/object-storage.service.js';
import { WorkIdPipe, workActorOf } from './work.common.js';
import {
  WORK_ATTACHMENT_READ_LIMIT,
  WorkAttachmentsService,
  classifyAttachment,
  contentDisposition,
} from './work-attachments.service.js';

type User = { id: string };

function storageFailure(cause: unknown): HttpException {
  if (cause instanceof HttpException) return cause;
  if (cause instanceof ObjectStorageUnavailableError) {
    return new ServiceUnavailableException({ code: 'STORAGE_UNAVAILABLE', message: cause.reason });
  }
  return new ServiceUnavailableException({
    code: 'STORAGE_FAILURE',
    message: 'Le stockage des fichiers n’a pas pu traiter la demande.',
  });
}

@Controller('work')
@UseGuards(AuthGuard, PermissionsGuard)
export class WorkAttachmentsController {
  constructor(
    @Inject(WorkAttachmentsService) private readonly attachments: WorkAttachmentsService,
  ) {}

  @Get('tasks/:taskId/attachments')
  @RequirePermission('work.read')
  async list(
    @CurrentOrgId() orgId: string,
    @Param('taskId', WorkIdPipe) taskId: string,
  ): Promise<{ items: WorkAttachmentView[] }> {
    return this.attachments.list(orgId, taskId);
  }

  @Post('tasks/:taskId/attachments')
  @HttpCode(201)
  @RequirePermission('work.update')
  @Throttle({ default: { ttl: 3_600_000, limit: WORK_LIMITS.attachmentsPerHourPerUser } })
  @UseGuards(UserThrottlerGuard)
  async upload(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('taskId', WorkIdPipe) taskId: string,
    @Req() req: Request,
  ): Promise<WorkAttachmentView> {
    await this.attachments.assertUploadable(orgId, taskId);
    const read = await readRequestBody(req, WORK_ATTACHMENT_READ_LIMIT);
    if (!read.ok) {
      if (read.reason === 'TOO_LARGE') {
        throw new HttpException(
          { code: 'FILE_TOO_LARGE', message: 'Le fichier dépasse 10 Mio.' },
          413,
        );
      }
      throw new BadRequestException({ code: 'UPLOAD_ABORTED', message: 'Envoi interrompu.' });
    }
    const file = classifyAttachment(read.body);
    try {
      return await this.attachments.upload(
        orgId,
        taskId,
        file,
        req.headers['x-file-name'],
        workActorOf(user, perms),
      );
    } catch (cause) {
      throw storageFailure(cause);
    }
  }

  @Get('attachments/:attachmentId')
  @RequirePermission('work.read')
  async download(
    @CurrentOrgId() orgId: string,
    @Param('attachmentId', WorkIdPipe) attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    let found;
    try {
      found = await this.attachments.read(orgId, attachmentId);
    } catch (cause) {
      throw storageFailure(cause);
    }
    if (!found) {
      throw new NotFoundException({
        code: 'WORK_ATTACHMENT_NOT_FOUND',
        message: 'Pièce jointe introuvable.',
      });
    }
    const { meta, object } = found;
    const isPdf = meta.contentType === 'application/pdf';
    res
      .status(200)
      .set({
        // Le type servi est celui déduit du contenu au dépôt, jamais celui du stockage.
        'Content-Type': meta.contentType,
        'Content-Length': String(object.body.length),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        // Un PDF n'est jamais rendu par le navigateur : téléchargement seulement.
        'Content-Disposition': contentDisposition(isPdf ? 'attachment' : 'inline', meta.fileName),
        'Cache-Control': 'private, no-store',
      })
      .end(object.body);
  }

  @Delete('attachments/:attachmentId')
  @HttpCode(204)
  @RequirePermission('work.update')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('attachmentId', WorkIdPipe) attachmentId: string,
  ): Promise<void> {
    await this.attachments.remove(orgId, attachmentId, workActorOf(user, perms));
  }
}
