// Fonctionnalités par offre (ADR-0053 § 6.3 — lot P4).
//
// `@Global` par nécessité, comme `AuthzModule` : `FeatureGuard` est posé par
// `@RequireFeature` sur des contrôleurs de TOUS les modules (CRM, ventes, RH…), et Nest
// l'instancie dans l'injecteur de chacun. Sans module global, chaque module métier
// devrait importer celui-ci — une ligne de plus par module, et un oubli = un démarrage
// en échec.

import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BillingModule } from '../../billing/billing.module.js';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { OrganizationsModule } from '../../organizations/organizations.module.js';
import { PlatformMirrorService } from '../mirror.js';
import { AdminFeaturesController } from './admin-features.controller.js';
import { FeatureAccessService } from './feature-access.service.js';
import {
  PlatformFeatureOverride,
  PlatformFeatureOverrideSchema,
} from './feature-override.schema.js';
import { MeFeaturesController } from './me-features.controller.js';

@Global()
@Module({
  imports: [
    OrganizationsModule,
    BillingModule,
    IntegrationsModule,
    MongooseModule.forFeature([
      { name: PlatformFeatureOverride.name, schema: PlatformFeatureOverrideSchema },
    ]),
  ],
  controllers: [AdminFeaturesController, MeFeaturesController],
  providers: [FeatureAccessService, PlatformMirrorService],
  exports: [FeatureAccessService],
})
export class FeaturesModule {}
