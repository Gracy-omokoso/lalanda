// Points d'API de l'appel vocal avec Lala.
//
//   GET  /ai/lala/vocal/etat       — le bouton peut-il s'allumer ? (sans effet)
//   POST /ai/lala/vocal/sessions   — ouvre une session, rend l'URL signée
//   POST /ai/lala/vocal/cloture    — rapporte la durée réelle d'une session
//
// Même protection que `LalaController` : authentification obligatoire, permission
// `analytics.read`, quota technique AI_THROTTLE par IP (garde global) ET par
// utilisateur (`UserThrottlerGuard`).
//
// ── Le quota d'offre est appliqué ICI, et il est DISTINCT ───────────────────
//
// `LalaController` laissait deux accroches au chantier offres. Celle-ci n'en
// laisse pas : le quota vocal est branché, parce qu'une minute de conversation
// vocale coûte deux ordres de grandeur de plus qu'un message texte et qu'une
// route facturée à la minute ne s'ouvre pas « en attendant ».
//
// Il ne consomme AUCUN message texte : `LalaVocalUsageService` écrit dans sa
// propre collection, et `AiUsageService.countBilledForOrganizationSince()` — qui
// alimente le quota de messages — n'y regarde pas. Voir `lala-vocal-quota.ts`.
//
// ── Pourquoi `sessions` accepte un corps VIDE et pas « rien » ────────────────
//
// Le schéma est strict et sans champ (`lala-vocal.dto.ts`). Le valider quand
// même, plutôt que d'ignorer le corps, transforme une tentative d'envoi de
// chiffres en 400 explicite. Un corps ignoré en silence ne laisserait aucune
// trace du jour où quelqu'un a essayé.

import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { AI_THROTTLE } from '../security/throttling.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import {
  ClotureVocaleRequestSchema,
  SessionVocaleRequestSchema,
  type ClotureVocaleResponse,
  type EtatVocalResponse,
  type SessionVocaleResponse,
} from './lala-vocal.dto.js';
import { LalaVocalService } from './lala-vocal.service.js';

@Controller('ai/lala/vocal')
@UseGuards(AuthGuard, PermissionsGuard)
export class LalaVocalController {
  constructor(private readonly service: LalaVocalService) {}

  @Get('etat')
  @RequirePermission('analytics.read')
  async etat(@Req() req: AuthenticatedRequest): Promise<EtatVocalResponse> {
    return this.service.etat(this.organisation(req));
  }

  @Post('sessions')
  @RequirePermission('analytics.read')
  @Throttle({ default: AI_THROTTLE })
  @UseGuards(UserThrottlerGuard)
  async ouvrir(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<SessionVocaleResponse> {
    // `?? {}` : un POST sans corps est légitime ici, puisqu'il n'y a rien à
    // envoyer. C'est un corps NON VIDE qui est une anomalie.
    const parsed = SessionVocaleRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message:
          'L’appel vocal ne transporte aucune donnée de projet : cette requête n’accepte aucun champ.',
        issues: parsed.error.issues,
      });
    }
    return this.service.ouvrirSession(this.organisation(req), req.user?.id ?? 'inconnu');
  }

  @Post('cloture')
  @RequirePermission('analytics.read')
  @Throttle({ default: AI_THROTTLE })
  @UseGuards(UserThrottlerGuard)
  async cloturer(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<ClotureVocaleResponse> {
    const parsed = ClotureVocaleRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    return this.service.cloturerSession(
      this.organisation(req),
      parsed.data.sessionId,
      parsed.data.minutes,
    );
  }

  /**
   * Organisation courante.
   *
   * Résolue par `AuthGuard`, jamais lue dans le corps : c'est ce qui rattache le
   * débit à la bonne organisation même si le client ment sur tout le reste.
   */
  private organisation(req: AuthenticatedRequest): string {
    const orgId = req.orgId;
    if (!orgId) {
      throw new BadRequestException({
        code: 'ORGANIZATION_REQUIRED',
        message: 'Aucune organisation active pour cette requête.',
      });
    }
    return orgId;
  }
}
