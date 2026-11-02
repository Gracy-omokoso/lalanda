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
// ADR-0053 — P2
import { PlatformMirrorService } from './mirror.js';
// ADR-0053 — P3
import { Subscription, SubscriptionSchema } from '../billing/subscription.schema.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { PlanGrant, PlanGrantSchema } from './billing/plan-grant.schema.js';
import { PlatformBillingController } from './billing/platform-billing.controller.js';
import { PlatformBillingService } from './billing/platform-billing.service.js';
// ADR-0053 — P4 : fonctionnalités par offre (@Global, sert `FeatureGuard` partout).
import { FeaturesModule } from './features/features.module.js';
// ADR-0053 — P5
import { AdminAuditModule } from './audit/admin-audit.module.js';
// ADR-0053 — P6
import { PlatformAnnouncementsModule } from './announcements/announcements.module.js';
// ADR-0053 — P7 : statistiques et finances du site (`/admin/stats`, `/admin/finance`).
import { PlatformInsightsModule } from './stats/platform-insights.module.js';
// ADR-0053 — P8
import { PlatformTwoFactorController } from './two-factor/platform-two-factor.controller.js';

@Module({
  imports: [
    // `Organization` et `Membership` viennent d'ici (module ré-exporté).
    OrganizationsModule,
    BillingModule,
    IntegrationsModule,
    // ADR-0053 — P3 : file des paiements manuels (`PaymentsService`).
    PaymentsModule,
    FeaturesModule, // ADR-0053 — P4
    MongooseModule.forFeature([
      { name: OrganizationSuspension.name, schema: OrganizationSuspensionSchema },
      { name: AiUsageEvent.name, schema: AiUsageEventSchema },
      // ADR-0053 — P3
      { name: PlanGrant.name, schema: PlanGrantSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
    // ADR-0053 — P5 : journal plateforme filtré, export CSV, événements de sécurité.
    AdminAuditModule,
    // ADR-0053 — P6 : annonces (`/admin/announcements/**`, `/me/announcements`).
    PlatformAnnouncementsModule,
    // ADR-0053 — P7
    PlatformInsightsModule,
  ],
  // `PlatformAccessController` sert `/me/platform-access` et NON `/admin/*` :
  // voir l'en-tête du fichier pour la raison — un utilisateur sans rôle doit
  // pouvoir apprendre qu'il n'en a pas.
  controllers: [
    AdminController,
    PlatformAccessController,
    PlatformBillingController,
    // ADR-0053 — P8
    PlatformTwoFactorController,
  ],
  providers: [AdminService, AiUsageService, PlatformMirrorService, PlatformBillingService],
  // `AiUsageService` est exporté pour `AiModule`, qui compte ses propres appels.
  // ADR-0047 : `AdminService` et `PlatformMirrorService` servent la console des factures d'abonnement.
  exports: [AiUsageService, AdminService, PlatformMirrorService],
})
export class AdminModule {}
