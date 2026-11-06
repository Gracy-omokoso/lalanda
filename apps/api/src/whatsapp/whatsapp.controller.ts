// Webhook PUBLIC de Meta — ADR-0065 § 5. Les routes de l'écran sont dans
// `work-whatsapp.controller.ts`.
//
//   GET  /whatsapp/webhook   poignée de main (`hub.mode`, `hub.verify_token`, `hub.challenge`)
//   POST /whatsapp/webhook   statuts de livraison et messages entrants (« STOP »),
//                            signature `X-Hub-Signature-256` vérifiée sur le corps brut
//
// Hors `/work` : aucune fonction d'offre (un « STOP » doit être enregistré quelle que
// soit l'offre de l'organisation), aucune session (c'est Meta qui appelle).

import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { WhatsAppService } from './whatsapp.service.js';

/** Lit `hub.mode` que l'analyseur de requête l'ait gardé à plat ou imbriqué. */
function hubParam(req: Request, name: 'mode' | 'verify_token' | 'challenge'): unknown {
  const q = req.query as Record<string, unknown>;
  const flat = q[`hub.${name}`];
  if (flat !== undefined) return flat;
  const hub = q['hub'];
  return hub && typeof hub === 'object' ? (hub as Record<string, unknown>)[name] : undefined;
}

@Controller('whatsapp')
export class WhatsappController {
  constructor(@Inject(WhatsAppService) private readonly whatsapp: WhatsAppService) {}

  /** Poignée de main : renvoie `hub.challenge` en texte brut, sinon 403. */
  @Get('webhook')
  async verify(@Req() req: Request, @Res() res: Response): Promise<void> {
    const challenge = await this.whatsapp.handshake(
      hubParam(req, 'mode'),
      hubParam(req, 'verify_token'),
      hubParam(req, 'challenge'),
    );
    if (challenge === null) {
      throw new ForbiddenException({
        code: 'WHATSAPP_VERIFY_TOKEN_INVALID',
        message: 'Jeton de vérification WhatsApp invalide.',
      });
    }
    res.status(200).type('text/plain').send(challenge);
  }

  /** Événements signés : statuts, « STOP ». Toujours 200 une fois la signature admise. */
  @Post('webhook')
  @HttpCode(200)
  async events(@Req() req: RawBodyRequest<Request>): Promise<{ ok: true }> {
    const raw = req.rawBody ?? Buffer.alloc(0);
    const v = req.headers['x-hub-signature-256'];
    const signature = Array.isArray(v) ? v[0] : v;
    if (!(await this.whatsapp.handleWebhook(raw, signature))) {
      throw new UnauthorizedException({
        code: 'WHATSAPP_SIGNATURE_INVALID',
        message: 'Signature WhatsApp absente ou invalide.',
      });
    }
    return { ok: true };
  }
}
