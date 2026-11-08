// Cartes de service et cartes de visite — routes internes (ADR-0069 § 7).
//
//   GET    /hr/cards/settings                              hr.read
//   PUT    /hr/cards/settings                              hr.manage
//   GET    /hr/cards/templates/:templateId/preview         hr.read   (120/h/utilisateur)
//   GET    /hr/cards/packages                              hr.read
//   POST   /hr/cards/packages          (ZIP, 20/h)         hr.manage
//   POST   /hr/cards/batch             (≤ 100, 30/h)       hr.read
//   GET    /hr/employees/:id/card                          hr.read
//   GET    /hr/employees/:id/card/photo                    hr.read
//   PUT    /hr/employees/:id/card/consent                  hr.manage
//   PUT    /hr/employees/:id/card/photo  (image brute)     hr.manage
//   DELETE /hr/employees/:id/card/photo                    hr.manage
//   POST   /hr/employees/:id/card/issue · /revoke          hr.manage
//   GET    /hr/employees/:id/card/export                   hr.read   (120/h/utilisateur)
//
// Aucune action nouvelle : lecture `hr.read`, écriture `hr.manage` (mêmes
// détenteurs que la fiche). Aucune donnée n'est envoyée à l'IA.

import {
  CardBatchBody,
  CardExportQuery,
  CardPreviewQuery,
  CardRevisionBody,
  PutCardConsentBody,
  PutCardSettingsBody,
  type CardPackageView,
  type CardProfileView,
  type CardSettingsView,
} from '@lalanda/shared/hr';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnsupportedMediaTypeException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  validateAndSanitizeImage,
} from '../../account/image-validation.js';
import { readRequestBody } from '../../account/request-body.js';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { RequireFeature } from '../../billing/feature.guard.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { PACKAGE_LIMITS } from '../../sales/documents/templates/custom/package-files.js';
import { UserThrottlerGuard } from '../../security/user-throttler.guard.js';
import { CardTemplateRef } from '@lalanda/shared/hr';
import type { CardValidationReport } from './custom/card-package.js';
import { HrCardsService, type CardActor, type CardFile } from './hr-cards.service.js';

function actorOf(user: { id: string }, role: OrgRole | undefined): CardActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

function send(res: Response, file: CardFile, disposition: 'inline' | 'attachment'): void {
  res.setHeader('content-type', file.contentType);
  res.setHeader('content-disposition', `${disposition}; filename="${file.fileName}"`);
  res.setHeader('content-length', String(file.body.byteLength));
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(file.body);
}

const ZIP_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  'multipart/x-zip',
]);

@Controller('hr')
@RequireFeature('hr') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class HrCardsController {
  constructor(@Inject(HrCardsService) private readonly cards: HrCardsService) {}

  // ── Réglages et modèles ────────────────────────────────────────────────────

  @Get('cards/settings')
  @RequirePermission('hr.read')
  async getSettings(@CurrentOrgId() orgId: string): Promise<CardSettingsView> {
    return this.cards.settings(orgId);
  }

  @Put('cards/settings')
  @RequirePermission('hr.manage')
  async putSettings(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<CardSettingsView> {
    const parsed = PutCardSettingsBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.cards.putSettings(orgId, parsed.data, actorOf(user, role));
  }

  @Get('cards/templates/:templateId/preview')
  @RequirePermission('hr.read')
  @Throttle({ default: { ttl: 3_600_000, limit: 120 } })
  @UseGuards(UserThrottlerGuard)
  async preview(
    @CurrentOrgId() orgId: string,
    @Param('templateId') templateId: string,
    @Query() query: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const ref = CardTemplateRef.safeParse(templateId);
    if (!ref.success) invalidRequest(ref.error, 'Modèle inconnu.');
    const parsed = CardPreviewQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    send(res, await this.cards.preview(orgId, ref.data, parsed.data), 'inline');
  }

  @Get('cards/packages')
  @RequirePermission('hr.read')
  async listPackages(@CurrentOrgId() orgId: string): Promise<{ packages: CardPackageView[] }> {
    return { packages: await this.cards.listPackages(orgId) };
  }

  @Post('cards/packages')
  @RequirePermission('hr.manage')
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  @UseGuards(UserThrottlerGuard)
  async installPackage(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Req() req: Request,
  ): Promise<{ installed: CardPackageView; created: boolean; report: CardValidationReport }> {
    const annonce = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (annonce && !ZIP_TYPES.has(annonce)) {
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_PACKAGE_TYPE',
        message: `Type « ${annonce} » non accepté : envoyez l’archive .zip du modèle.`,
      });
    }
    const lecture = await readRequestBody(req, PACKAGE_LIMITS.maxArchiveBytes);
    if (!lecture.ok) {
      if (lecture.reason === 'TOO_LARGE') {
        throw new HttpException(
          {
            code: 'PACKAGE_TOO_LARGE',
            message: `L’archive dépasse ${PACKAGE_LIMITS.maxArchiveBytes / 1024 / 1024} Mio.`,
          },
          413,
        );
      }
      throw new BadRequestException({ code: 'UPLOAD_ABORTED', message: 'Envoi interrompu.' });
    }
    return this.cards.installPackage(orgId, lecture.body, actorOf(user, role));
  }

  @Post('cards/batch')
  @RequirePermission('hr.read')
  @HttpCode(200)
  @Throttle({ default: { ttl: 3_600_000, limit: 30 } })
  @UseGuards(UserThrottlerGuard)
  async batch(
    @CurrentOrgId() orgId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = CardBatchBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    send(res, await this.cards.exportBatch(orgId, parsed.data), 'attachment');
  }

  // ── Carte d'un collaborateur ───────────────────────────────────────────────

  @Get('employees/:employeeId/card')
  @RequirePermission('hr.read')
  async getProfile(
    @CurrentOrgId() orgId: string,
    @Param('employeeId') employeeId: string,
  ): Promise<CardProfileView> {
    return this.cards.getProfile(orgId, employeeId);
  }

  @Get('employees/:employeeId/card/photo')
  @RequirePermission('hr.read')
  async getPhoto(
    @CurrentOrgId() orgId: string,
    @Param('employeeId') employeeId: string,
    @Res() res: Response,
  ): Promise<void> {
    const photo = await this.cards.photoBytes(orgId, employeeId);
    if (!photo) {
      res.status(404).json({ code: 'CARD_PHOTO_NOT_FOUND', message: 'Aucune photo.' });
      return;
    }
    send(res, { body: photo.body, contentType: photo.contentType, fileName: 'photo' }, 'inline');
  }

  @Put('employees/:employeeId/card/consent')
  @RequirePermission('hr.manage')
  async putConsent(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ): Promise<CardProfileView> {
    const parsed = PutCardConsentBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.cards.putConsent(orgId, employeeId, parsed.data, actorOf(user, role));
  }

  @Put('employees/:employeeId/card/photo')
  @RequirePermission('hr.manage')
  async putPhoto(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('employeeId') employeeId: string,
    @Req() req: Request,
  ): Promise<CardProfileView> {
    const annonce = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (
      annonce &&
      !ACCEPTED_IMAGE_TYPES.includes(annonce as never) &&
      annonce !== 'application/octet-stream'
    ) {
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_IMAGE_TYPE',
        message: `Type « ${annonce} » non accepté. Attendu : ${ACCEPTED_IMAGE_TYPES.join(', ')}.`,
      });
    }
    const lecture = await readRequestBody(req, MAX_IMAGE_BYTES);
    if (!lecture.ok) {
      if (lecture.reason === 'TOO_LARGE') {
        throw new HttpException(
          {
            code: 'FILE_TOO_LARGE',
            message: `Le fichier dépasse ${MAX_IMAGE_BYTES / 1024 / 1024} Mio.`,
          },
          413,
        );
      }
      throw new BadRequestException({ code: 'UPLOAD_ABORTED', message: 'Envoi interrompu.' });
    }
    const verdict = validateAndSanitizeImage(lecture.body);
    if (!verdict.ok) {
      throw new HttpException(
        { code: verdict.code, message: verdict.message },
        verdict.code === 'UNSUPPORTED_IMAGE_TYPE'
          ? 415
          : verdict.code === 'FILE_TOO_LARGE'
            ? 413
            : 422,
      );
    }
    return this.cards.putPhoto(orgId, employeeId, verdict, actorOf(user, role));
  }

  @Delete('employees/:employeeId/card/photo')
  @RequirePermission('hr.manage')
  async removePhoto(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('employeeId') employeeId: string,
  ): Promise<CardProfileView> {
    return this.cards.removePhoto(orgId, employeeId, actorOf(user, role));
  }

  @Post('employees/:employeeId/card/issue')
  @RequirePermission('hr.manage')
  @HttpCode(200)
  async issue(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ): Promise<CardProfileView> {
    const parsed = CardRevisionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.cards.issue(orgId, employeeId, parsed.data.expectedRevision, actorOf(user, role));
  }

  @Post('employees/:employeeId/card/revoke')
  @RequirePermission('hr.manage')
  @HttpCode(200)
  async revoke(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ): Promise<CardProfileView> {
    const parsed = CardRevisionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.cards.revoke(orgId, employeeId, parsed.data.expectedRevision, actorOf(user, role));
  }

  @Get('employees/:employeeId/card/export')
  @RequirePermission('hr.read')
  @Throttle({ default: { ttl: 3_600_000, limit: 120 } })
  @UseGuards(UserThrottlerGuard)
  async export(
    @CurrentOrgId() orgId: string,
    @Param('employeeId') employeeId: string,
    @Query() query: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = CardExportQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    send(res, await this.cards.exportOne(orgId, employeeId, parsed.data), 'attachment');
  }
}
