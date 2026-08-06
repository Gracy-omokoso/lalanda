// Endpoint POST /ai/corrective-actions (S14a — agent D).
//
// Prend en entrée le résultat d'un `/evaluate` (feuilles + ratios avec seuil)
// et retourne 0 à 4 suggestions concrètes. Ne modifie aucun calcul officiel.

import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';

import {
  CorrectiveActionsRequestSchema,
  type CorrectiveActionsResponse,
} from './ai-actions.dto.js';
import { AiActionsService } from './ai-actions.service.js';

@Controller('ai')
export class AiActionsController {
  constructor(@Inject(AiActionsService) private readonly service: AiActionsService) {}

  @Post('corrective-actions')
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
