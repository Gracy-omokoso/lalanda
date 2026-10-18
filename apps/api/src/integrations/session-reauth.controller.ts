// Ré-authentification d'un membre d'organisation — `GET` / `POST /me/reauth`
// (ADR-0021 §8 et §10, chantier A).
//
// Jusqu'ici, seule `admin/reauth` ouvrait une fenêtre, réservée au
// super-administrateur. Ces routes l'ouvrent à tout utilisateur connecté, pour SA
// PROPRE session : elles ne donnent aucun droit, elles prouvent seulement la
// présence de la personne. D'où leur place dans `SANS_PERMISSION`
// (`authz/routes-coverage.test.ts`). La fenêtre est la même collection et le même
// mécanisme qu'`/admin` : une fenêtre ouverte ici vaut aussi là-bas.
//
// Deux moyens de preuve (ADR-0021 § Conséquences) :
//   - mot de passe, pour un compte qui en a un ;
//   - connexion Google récente (session de moins de 10 minutes), pour un compte
//     créé par Google, qui n'a pas de mot de passe à saisir.
//
// Le mot de passe soumis n'est ni renvoyé, ni journalisé, ni recopié dans un
// message d'erreur (`no-secret-leak.test.ts`).

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { INTEGRATION_WRITE_THROTTLE } from '../security/throttling.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import { ReauthService, type ReauthMethod } from './reauth.service.js';

/** Corps de `POST /me/reauth` : mot de passe facultatif (absent = connexion Google récente). */
const SessionReauthSchema = z.object({ password: z.string().min(1).max(256).optional() }).strict();

export interface SessionReauthStatusView {
  valid: boolean;
  expiresAt: string | null;
  /** Ajout au contrat §10 : dit à l'interface quoi demander (mot de passe ou Google). */
  method: ReauthMethod;
}

@Controller('me/reauth')
@UseGuards(AuthGuard)
export class SessionReauthController {
  constructor(@Inject(ReauthService) private readonly reauth: ReauthService) {}

  /** État de la fenêtre de CETTE session — l'interface affiche le temps restant. */
  @Get()
  async status(@Req() req: AuthenticatedRequest): Promise<SessionReauthStatusView> {
    const userId = req.user!.id;
    const [state, method] = await Promise.all([
      this.reauth.statusOf(userId, req.headers.cookie),
      this.reauth.methodOf(userId),
    ]);
    return { valid: state.active, expiresAt: state.expiresAt, method };
  }

  @Post()
  @HttpCode(200)
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: INTEGRATION_WRITE_THROTTLE })
  async confirm(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ expiresAt: string }> {
    const parsed = SessionReauthSchema.safeParse(body ?? {});
    if (!parsed.success) {
      // Ni `parsed.error`, ni ses `issues` : Zod recopie la valeur reçue dans
      // certains messages, ce qui remettrait le mot de passe dans la réponse.
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Corps de requête invalide : seul le champ « password » est accepté.',
      });
    }
    const input = {
      userId: req.user!.id,
      headers: new Headers(req.headers as Record<string, string>),
      cookieHeader: req.headers.cookie,
    };
    const { expiresAt } =
      parsed.data.password === undefined
        ? await this.reauth.confirmRecentSignIn(input)
        : await this.reauth.confirm({ ...input, password: parsed.data.password });
    return { expiresAt: expiresAt.toISOString() };
  }
}
