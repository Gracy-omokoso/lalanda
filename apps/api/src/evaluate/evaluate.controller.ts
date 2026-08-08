// Endpoint POST /evaluate — évalue un template avec des drivers utilisateur.
// Sans persistence. Le moteur reste la seule source de vérité.
// S16a : authentification requise (l'exposition publique « S3-lite » est terminée) —
// les templates et l'évaluation ne sont servis qu'aux sessions valides.

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { EngineError, evaluateTemplate, type Template } from '@lalanda/engine';

import { AuthGuard } from '../auth/auth.guard.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import {
  EvaluateRequestSchema,
  type EvaluateRequest,
  type EvaluateResponse,
} from './evaluate.dto.js';
import {
  getTemplate,
  listTemplateSlugs,
  listTemplateSummaries,
  type TemplateSummary,
} from './template-registry.js';

@Controller('evaluate')
@UseGuards(AuthGuard, PermissionsGuard)
export class EvaluateController {
  @Get('templates')
  @RequirePermission('project.read')
  listTemplates(): { slugs: string[]; templates: TemplateSummary[] } {
    return { slugs: listTemplateSlugs(), templates: listTemplateSummaries() };
  }

  /**
   * Retourne le Template complet — métadonnées + drivers avec label/aide/min/max/etc.
   * Consommé par le frontend pour générer le wizard dynamiquement (S5a).
   */
  @Get('templates/:slug')
  @RequirePermission('project.read')
  getTemplateBySlug(@Param('slug') slug: string): { template: Template } {
    const template = getTemplate(slug);
    if (!template) {
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: `Template inconnu : ${slug}`,
      });
    }
    return { template };
  }

  @Post()
  @RequirePermission('plan.calculate')
  evaluate(@Body() body: unknown): EvaluateResponse {
    // Validation Zod du payload (source unique de vérité, cohérence avec le moteur).
    const parsed = EvaluateRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        issues: parsed.error.issues,
      });
    }
    const { templateSlug, drivers }: EvaluateRequest = parsed.data;

    const template = getTemplate(templateSlug);
    if (!template) {
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: `Template inconnu : ${templateSlug}`,
      });
    }

    try {
      const result = evaluateTemplate(template, drivers);
      return {
        templateSlug: template.slug,
        templateVersion: template.version,
        drivers: Object.fromEntries(result.drivers),
        lines: result.lines.map((l) => ({
          sheetId: l.sheetId,
          lineId: l.lineId,
          label: l.label,
          formulaSource: l.formulaSource,
          value: l.value,
          format: l.format,
        })),
      };
    } catch (err) {
      if (err instanceof EngineError) {
        // Traduction des erreurs métier en 400 avec code stable pour l'UI.
        throw new BadRequestException({
          code: err.code,
          message: err.message,
          details: err.details,
        });
      }
      throw err;
    }
  }
}
