// Endpoint POST /ai/corrective-actions (S14a — agent D).
//
// Prend en entrée le résultat d'un `/evaluate` (feuilles + ratios avec seuil)
// et retourne 0 à 4 suggestions concrètes. Ne modifie aucun calcul officiel.
//
// S16a : endpoint facturé (OpenAI, ADR-0008) → authentification obligatoire
// + quota strict AI_THROTTLE appliqué par utilisateur (UserThrottlerGuard,
// après AuthGuard donc req.user disponible) ET par IP (guard global).

import { BadRequestException, Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AiUsageService } from '../admin/ai-usage.service.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { AI_THROTTLE } from '../security/throttling.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import {
  CorrectiveActionsRequestSchema,
  type CorrectiveActionsResponse,
} from './ai-actions.dto.js';
import { AiActionsService } from './ai-actions.service.js';

@Controller('ai')
@UseGuards(AuthGuard, PermissionsGuard)
export class AiActionsController {
  constructor(
    @Inject(AiActionsService) private readonly service: AiActionsService,
    @Inject(AiUsageService) private readonly usage: AiUsageService,
  ) {}

  @Post('corrective-actions')
  @RequirePermission('analytics.read')
  @Throttle({ default: AI_THROTTLE })
  @UseGuards(UserThrottlerGuard)
  async corrective(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<CorrectiveActionsResponse> {
    const parsed = CorrectiveActionsRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        issues: parsed.error.issues,
      });
    }
    const result = await this.service.correctiveActions(parsed.data);
    // Comptage APRÈS la réponse du service et à partir de `result.source` : c'est
    // la seule manière de distinguer un appel FACTURÉ d'un fallback déterministe.
    // Compter avant l'appel gonflerait la consommation OpenAI de tous les cas où
    // aucune clé n'est configurée (S21b — tableau de bord `/admin`).
    await this.usage.record({
      organizationId: req.orgId ?? 'inconnue',
      userId: req.user?.id ?? 'inconnu',
      action: 'ai.corrective_actions',
      source: result.source === 'llm' ? 'llm' : 'fallback',
    });
    return result;
  }
}
