// ─────────────────────────────────────────────────────────────────────────────
// ROUTES `/me/announcements` (ADR-0053 § 6.6, § 7 — lot P6)
//
//   GET  /me/announcements                 ses annonces en cours (bannière, cloche)
//   POST /me/announcements/:id/read        lue (cloche)
//   POST /me/announcements/:id/dismiss     fermée (bannière)
//
// Destinataire seulement : `AuthGuard`, aucune action RBAC (§ 7). La personne vient
// TOUJOURS de la session ; l'organisation active n'entre dans aucun filtre — une
// annonce se lit quelle que soit l'organisation ouverte. La vue ne porte ni la
// catégorie, ni le nombre de destinataires, ni l'auteur ; une annonce dont on n'est
// pas destinataire répond `404`, comme une annonce inexistante.
// ─────────────────────────────────────────────────────────────────────────────

import { Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import {
  PlatformAnnouncementsService,
  type MyAnnouncementView,
} from './platform-announcements.service.js';

type User = { id: string };

@Controller('me/announcements')
@UseGuards(AuthGuard)
export class MeAnnouncementsController {
  constructor(
    @Inject(PlatformAnnouncementsService)
    private readonly announcements: PlatformAnnouncementsService,
  ) {}

  @Get()
  async list(@CurrentUser() user: User): Promise<{ announcements: MyAnnouncementView[] }> {
    return { announcements: await this.announcements.mine(user.id) };
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@CurrentUser() user: User, @Param('id') id: string): Promise<MyAnnouncementView> {
    return this.announcements.markRead(user.id, id);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  async dismiss(@CurrentUser() user: User, @Param('id') id: string): Promise<MyAnnouncementView> {
    return this.announcements.dismiss(user.id, id);
  }
}
