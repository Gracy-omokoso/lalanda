// ─────────────────────────────────────────────────────────────────────────────
// ROUTES `/admin/announcements/**` (ADR-0053 § 6.6, § 7 — lot P6)
//
// Garde de CONSOLE : `PlatformAuthGuard` (aucune organisation résolue) puis
// `PermissionsGuard`, qui juge l'action plateforme de chaque route contre la matrice du
// § 5.2. Aucun rôle d'organisation ne détient `platform.announcements.*` : un
// Propriétaire ne crée ni n'envoie d'annonce.
//
// Ré-authentification (§ 2.4, « toute écriture de la console ») : toutes les écritures,
// sauf l'aperçu, qui ne fait que COMPTER. Approbation et envoi : `platform.announcements.approve`.
// ─────────────────────────────────────────────────────────────────────────────

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
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import {
  AnnouncementDraftInputSchema,
  AnnouncementSendInputSchema,
  PLATFORM_LIMITS,
} from '@lalanda/shared/platform';

import type { AuthenticatedRequest } from '../../auth/auth.guard.js';
import { PlatformConsoleRoute, RequirePlatformAction } from '../../authz/authz.decorators.js';
import { AuthzService } from '../../authz/authz.service.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { PlatformAuthGuard } from '../../authz/platform-auth.guard.js';
import { RequireRecentReauth } from '../../integrations/reauth.guard.js';
import type { AdminActor } from '../admin.service.js';
import { invalidBody } from '../admin.dto.js';
import {
  PlatformAnnouncementsService,
  type AdminAnnouncementView,
} from './platform-announcements.service.js';

/** Annuler : motif interne obligatoire (§ 2.4, un motif par écriture). */
const CancelAnnouncementInputSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(PLATFORM_LIMITS.internalNoteMinLength)
      .max(PLATFORM_LIMITS.internalNoteMaxLength),
  })
  .strict();

@Controller('admin/announcements')
@UseGuards(PlatformAuthGuard, PermissionsGuard)
@PlatformConsoleRoute()
@RequirePlatformAction('platform.announcements.draft')
export class PlatformAnnouncementsController {
  constructor(
    @Inject(PlatformAnnouncementsService)
    private readonly announcements: PlatformAnnouncementsService,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  /** Acteur du journal plateforme : rôles RELUS, jamais déduits de la route. */
  private async actorOf(req: AuthenticatedRequest): Promise<AdminActor> {
    const roles = await this.authz.platformRolesOf(req.user!.id);
    return { userId: req.user!.id, platformRole: roles.join(',') || 'aucun' };
  }

  @Get()
  @RequirePlatformAction('platform.announcements.draft')
  async list(@Query('limit') limit?: string): Promise<{ announcements: AdminAnnouncementView[] }> {
    const n = Number.parseInt(limit ?? '', 10);
    return { announcements: await this.announcements.list(Number.isFinite(n) ? n : undefined) };
  }

  @Post()
  @RequirePlatformAction('platform.announcements.draft')
  @RequireRecentReauth()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<AdminAnnouncementView> {
    const parsed = AnnouncementDraftInputSchema.safeParse(body ?? {});
    if (!parsed.success) throw invalidBody(parsed.error, 'Titre, texte et catégorie requis.');
    return this.announcements.create(parsed.data, await this.actorOf(req));
  }

  @Put(':id')
  @RequirePlatformAction('platform.announcements.draft')
  @RequireRecentReauth()
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminAnnouncementView> {
    const parsed = AnnouncementDraftInputSchema.safeParse(body ?? {});
    if (!parsed.success) throw invalidBody(parsed.error, 'Titre, texte et catégorie requis.');
    return this.announcements.update(id, parsed.data, await this.actorOf(req));
  }

  @Post(':id/preview')
  @RequirePlatformAction('platform.announcements.draft')
  @HttpCode(200)
  async preview(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<AdminAnnouncementView> {
    return this.announcements.preview(id, await this.actorOf(req));
  }

  @Post(':id/submit')
  @RequirePlatformAction('platform.announcements.draft')
  @RequireRecentReauth()
  @HttpCode(200)
  async submit(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<AdminAnnouncementView> {
    return this.announcements.submit(id, await this.actorOf(req));
  }

  @Post(':id/approve')
  @RequirePlatformAction('platform.announcements.approve')
  @RequireRecentReauth()
  @HttpCode(200)
  async approve(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<AdminAnnouncementView> {
    return this.announcements.approve(id, await this.actorOf(req));
  }

  @Post(':id/send')
  @RequirePlatformAction('platform.announcements.approve')
  @RequireRecentReauth()
  @HttpCode(200)
  async send(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminAnnouncementView> {
    const parsed = AnnouncementSendInputSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw invalidBody(parsed.error, 'Retapez le nombre de destinataires approuvé.');
    }
    return this.announcements.send(id, parsed.data.confirmedAudienceCount, await this.actorOf(req));
  }

  @Post(':id/cancel')
  @RequirePlatformAction('platform.announcements.draft')
  @RequireRecentReauth()
  @HttpCode(200)
  async cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminAnnouncementView> {
    const parsed = CancelAnnouncementInputSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw invalidBody(parsed.error, 'Motif d’annulation requis (dix caractères au moins).');
    }
    return this.announcements.cancel(id, parsed.data.reason, await this.actorOf(req));
  }
}
