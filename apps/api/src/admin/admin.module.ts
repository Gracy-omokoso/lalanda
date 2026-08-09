// Espace admin plateforme (S21b).
//
// N'importe pas `IntegrationsModule` pour ses secrets — seulement pour
// `PlatformAuditService`, le journal partagé. Les routes `/admin/integrations`
// appartiennent à `IntegrationsModule` : elles vivent avec le chiffrement
// qu'elles pilotent, pas avec le tableau de bord.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BillingModule } from '../billing/billing.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AiUsageEvent, AiUsageEventSchema } from './ai-usage.schema.js';
import { AiUsageService } from './ai-usage.service.js';
import {
  OrganizationSuspension,
  OrganizationSuspensionSchema,
} from './organization-suspension.schema.js';
import { PlatformAccessController } from './platform-access.controller.js';

@Module({
  imports: [
    // `Organization` et `Membership` viennent d'ici (module ré-exporté).
    OrganizationsModule,
    BillingModule,
    IntegrationsModule,
    MongooseModule.forFeature([
      { name: OrganizationSuspension.name, schema: OrganizationSuspensionSchema },
      { name: AiUsageEvent.name, schema: AiUsageEventSchema },
    ]),
  ],
  // `PlatformAccessController` sert `/me/platform-access` et NON `/admin/*` :
  // voir l'en-tête du fichier pour la raison — un utilisateur sans rôle doit
  // pouvoir apprendre qu'il n'en a pas.
  controllers: [AdminController, PlatformAccessController],
  providers: [AdminService, AiUsageService],
  // `AiUsageService` est exporté pour `AiModule`, qui compte ses propres appels.
  exports: [AiUsageService],
})
export class AdminModule {}
