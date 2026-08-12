// Endpoint POST /ai/corrective-actions (S14a — agent D).
//
// Prend en entrée le résultat d'un `/evaluate` (feuilles + ratios avec seuil)
// et retourne 0 à 4 suggestions concrètes. Ne modifie aucun calcul officiel.
//
// S16a : endpoint facturé (OpenAI, ADR-0008) → authentification obligatoire
// + quota strict AI_THROTTLE appliqué par utilisateur (UserThrottlerGuard,
// après AuthGuard donc req.user disponible) ET par IP (guard global).

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

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
import { AiQuotaService } from './ai-quota.service.js';

@Controller('ai')
@UseGuards(AuthGuard, PermissionsGuard)
export class AiActionsController {
  constructor(
    @Inject(AiActionsService) private readonly service: AiActionsService,
    @Inject(AiQuotaService) private readonly quota: AiQuotaService,
  ) {}

  /**
   * Quota IA du mois — lecture seule, sans effet.
   *
   * Existe pour que l'interface puisse dire « il vous reste N messages, le
   * compteur repart le 1er » AVANT que l'utilisateur ne se heurte au refus.
   * C'est le rôle légitime de l'interface face à une limite : l'expliquer. Ce
   * n'est pas elle qui l'applique — `POST /ai/*` la fait respecter de son côté,
   * et cette route ne serait-elle jamais appelée que rien ne changerait.
   */
  @Get('quota')
  @RequirePermission('analytics.read')
  async quotaStatus(@Req() req: AuthenticatedRequest): Promise<{
    plan: string;
    limit: number | null;
    used: number;
    remaining: number | null;
    unlimited: boolean;
    resetAt: string;
    resetInDays: number;
  }> {
    const status = await this.quota.status(req.orgId ?? 'inconnue');
    return {
      plan: status.plan,
      limit: status.limit,
      used: status.used,
      remaining: status.remaining,
      unlimited: status.unlimited,
      resetAt: status.resetAt.toISOString(),
      resetInDays: status.resetInDays,
    };
  }

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
    // `runGuarded` tient ensemble les deux moitiés de la règle : refus AVANT
    // l'appel si le quota du mois est épuisé, comptage APRÈS à partir de la
    // source RÉELLE de la réponse. Compter avant l'appel décompterait les replis
    // déterministes, c'est-à-dire facturerait les cas où aucune clé n'est
    // configurée ; garder après laisserait passer l'appel payant qu'on refuse.
    return this.quota.runGuarded(
      {
        organizationId: req.orgId ?? 'inconnue',
        userId: req.user?.id ?? 'inconnu',
        action: 'ai.corrective_actions',
      },
      async () => {
        const result = await this.service.correctiveActions(parsed.data);
        return { value: result, source: result.source };
      },
    );
  }
}
