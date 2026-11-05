// Routes PUBLIQUES de l'intégration Slack — ADR-0064 § 2 et § 6. Les routes de
// l'écran sont dans `work-slack.controller.ts`, le canal d'un projet dans le module
// `work` (`/work/projects/:projectId/slack-channel`).
//
//   GET    /slack/oauth/callback       public : `state` signé + session vérifiée
//   POST   /slack/events               public : signature `X-Slack-Signature` vérifiée
//
// Hors `/work` : aucune fonction d'offre (Slack doit pouvoir annoncer une
// désinstallation même pour une organisation dont l'offre a changé).

import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { SlackConnectionsService, slackSettingsUrl } from './slack-connections.service.js';

/** Routes appelées par Slack (ou par le navigateur revenant de Slack). */
@Controller('slack')
export class SlackController {
  constructor(@Inject(SlackConnectionsService) private readonly slack: SlackConnectionsService) {}

  /** Retour OAuth : toujours une redirection vers l'écran, jamais une erreur brute. */
  @Get('oauth/callback')
  async callback(
    @Query('code') code: unknown,
    @Query('state') state: unknown,
    @Query('error') error: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    let target: string;
    try {
      target = await this.slack.completeConnect({
        code,
        state,
        error,
        headers: headersOf(req),
      });
    } catch {
      target = slackSettingsUrl('erreur');
    }
    res.redirect(302, target);
  }

  /** Events API : `url_verification`, `app_uninstalled`, `tokens_revoked`. */
  @Post('events')
  @HttpCode(200)
  async events(@Req() req: RawBodyRequest<Request>): Promise<{ challenge?: string; ok?: true }> {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
    const result = await this.slack.handleEvent({
      rawBody: raw,
      timestamp: header(req, 'x-slack-request-timestamp'),
      signature: header(req, 'x-slack-signature'),
    });
    if (!result) {
      throw new UnauthorizedException({
        code: 'SLACK_SIGNATURE_INVALID',
        message: 'Signature Slack absente ou invalide.',
      });
    }
    return result;
  }
}

function header(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function headersOf(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.join(', ');
  }
  return out;
}
