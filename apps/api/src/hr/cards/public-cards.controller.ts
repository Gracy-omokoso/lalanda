// Routes PUBLIQUES de vérification d'une carte de service — ADR-0069 § 4.
//
// Ni session, ni cookie, ni permission : le jeton fait autorité. Inscrites, avec
// leur justification, dans `SANS_PERMISSION` de `routes-coverage.test.ts`.
// Journalisation HTTP automatique coupée pour ce préfixe (`app.module.ts`).
//
// Jeton inconnu, mal formé, révoqué, remplacé, fiche anonymisée : MÊME réponse
// `{ valid: false }` (aucun oracle). Photo non montrable : 404 unique.

import type { PublicCardView } from '@lalanda/shared/hr';
import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { HrCardsService } from './hr-cards.service.js';
import {
  PublicCardIpThrottlerGuard,
  PublicCardTokenThrottlerGuard,
} from './public-card-throttler.guard.js';

function apiBase(): string {
  return (process.env['API_URL'] ?? 'http://localhost:3001').replace(/\/+$/, '');
}

@Controller('public/cards')
@UseGuards(PublicCardIpThrottlerGuard, PublicCardTokenThrottlerGuard)
export class PublicCardsController {
  constructor(@Inject(HrCardsService) private readonly cards: HrCardsService) {}

  @Get(':token')
  @Header('cache-control', 'no-store')
  @Header('x-robots-tag', 'noindex, nofollow')
  async verify(@Param('token') token: string): Promise<PublicCardView> {
    return this.cards.verify(token, apiBase());
  }

  @Get(':token/photo')
  async photo(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const photo = await this.cards.publicPhoto(token).catch(() => null);
    if (!photo) throw new NotFoundException();
    res
      .status(200)
      .set({
        'Content-Type': photo.contentType,
        'Content-Length': String(photo.body.length),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-store',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Robots-Tag': 'noindex, nofollow',
      })
      .end(photo.body);
  }
}
