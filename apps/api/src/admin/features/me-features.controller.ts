// `GET /me/features` (ADR-0053 § 6.3 et § 7 — lot P4) : ce que l'offre de l'organisation
// ACTIVE permet, pour que l'interface explique une fonctionnalité absente (« Disponible
// avec l'offre … ») au lieu de la cacher. Informe seulement : l'API impose
// (`FeatureGuard`). Une dérogation y paraît avec son échéance et une raison générique,
// jamais le nom de l'opérateur.

import { Controller, Get, Inject, UseGuards } from '@nestjs/common';

import type { MyFeaturesView } from '@lalanda/shared/pricing';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { FeatureAccessService } from './feature-access.service.js';

@Controller('me')
@UseGuards(AuthGuard, PermissionsGuard)
export class MeFeaturesController {
  constructor(@Inject(FeatureAccessService) private readonly features: FeatureAccessService) {}

  @Get('features')
  @RequirePermission('analytics.read')
  async myFeatures(@CurrentOrgId() orgId: string): Promise<MyFeaturesView> {
    return this.features.myFeatures(orgId);
  }
}
