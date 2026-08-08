// Endpoint POST /ai/corrective-actions (S14a — agent D).
//
// Prend en entrée le résultat d'un `/evaluate` (feuilles + ratios avec seuil)
// et retourne 0 à 4 suggestions concrètes. Ne modifie aucun calcul officiel.
//
// S16a : endpoint facturé (OpenAI, ADR-0008) → authentification obligatoire
// + quota strict AI_THROTTLE appliqué par utilisateur (UserThrottlerGuard,
// après AuthGuard donc req.user disponible) ET par IP (guard global).

import { BadRequestException, Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AuthGuard } from '../auth/auth.guard.js';
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
  constructor(@Inject(AiActionsService) private readonly service: AiActionsService) {}

  @Post('corrective-actions')
  @RequirePermission('analytics.read')
  @Throttle({ default: AI_THROTTLE })
  @UseGuards(UserThrottlerGuard)
  async corrective(@Body() body: unknown): Promise<CorrectiveActionsResponse> {
    const parsed = CorrectiveActionsRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        issues: parsed.error.issues,
      });
    }
    return this.service.correctiveActions(parsed.data);
  }
}
