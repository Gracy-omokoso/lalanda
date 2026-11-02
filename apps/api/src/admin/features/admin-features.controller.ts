// Console — fonctionnalités par offre (ADR-0053 § 6.3 et § 7 — lot P4).
//
// GET    /admin/features                platform.features.read
// POST   /admin/features/overrides      platform.features.override (ré-auth)
// DELETE /admin/features/overrides/:id  platform.features.override (ré-auth)
//
// La grille est en LECTURE SEULE (O5-b) : aucune route ne la modifie. Les dérogations
// portent motif et échéance (90 jours au plus) ; le journal du client les reçoit en
// « Équipe Lalanda » avec une raison générique.

import { Body, Controller, Delete, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { featureOverrideInputSchema, PLATFORM_LIMITS } from '@lalanda/shared/platform';

import type { AuthenticatedRequest } from '../../auth/auth.guard.js';
import { PlatformConsoleRoute, RequirePlatformAction } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { PlatformAuthGuard } from '../../authz/platform-auth.guard.js';
import { RequireRecentReauth } from '../../integrations/reauth.guard.js';
import { invalidBody } from '../admin.dto.js';
import {
  FeatureAccessService,
  type AdminFeaturesView,
  type FeatureOverrideView,
} from './feature-access.service.js';

const RevokeOverrideInputSchema = z
  .object({
    internalNote: z
      .string()
      .trim()
      .min(PLATFORM_LIMITS.internalNoteMinLength, {
        message: `Note interne : ${PLATFORM_LIMITS.internalNoteMinLength} caractères au moins.`,
      })
      .max(PLATFORM_LIMITS.internalNoteMaxLength),
  })
  .strict();

@Controller('admin/features')
@UseGuards(PlatformAuthGuard, PermissionsGuard)
@PlatformConsoleRoute()
@RequirePlatformAction('platform.features.read')
export class AdminFeaturesController {
  constructor(@Inject(FeatureAccessService) private readonly features: FeatureAccessService) {}

  @Get()
  @RequirePlatformAction('platform.features.read')
  async view(): Promise<AdminFeaturesView> {
    return this.features.adminView();
  }

  @Post('overrides')
  @RequirePlatformAction('platform.features.override')
  @RequireRecentReauth()
  async grant(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<FeatureOverrideView> {
    const parsed = featureOverrideInputSchema(new Date()).safeParse(body);
    if (!parsed.success) {
      throw invalidBody(
        parsed.error,
        'Organisation, fonctionnalité, catégorie, note interne et échéance requises.',
      );
    }
    return this.features.grant(parsed.data, req.user!.id);
  }

  @Delete('overrides/:overrideId')
  @RequirePlatformAction('platform.features.override')
  @RequireRecentReauth()
  async revoke(
    @Req() req: AuthenticatedRequest,
    @Param('overrideId') overrideId: string,
    @Body() body: unknown,
  ): Promise<FeatureOverrideView> {
    const parsed = RevokeOverrideInputSchema.safeParse(body ?? {});
    if (!parsed.success) throw invalidBody(parsed.error, 'Note interne requise.');
    return this.features.revoke(overrideId, parsed.data.internalNote, req.user!.id);
  }
}
