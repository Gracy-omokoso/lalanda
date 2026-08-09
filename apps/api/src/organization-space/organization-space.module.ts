// Espace organisation (S21a).
//
// ── Pourquoi un module neuf plutôt qu'un enrichissement de `organizations/` ───
//
// 1. Frontière d'écriture. ADR-0012 §9 fait de `apps/api/src/organizations/**` un
//    périmètre à écrivain unique, et un second chantier tourne en parallèle sur
//    `/admin` et `integrations/`. Un module neuf garde la règle « un fichier, un
//    écrivain » sans arbitrage.
// 2. Responsabilités distinctes. `organizations/` GOUVERNE : memberships,
//    invitations, rôles, transfert de propriété — des écritures qui portent des
//    règles critiques (R1, R7). Ce module LIT et AGRÈGE pour une interface, plus
//    deux réglages de présentation. Les mélanger ferait cohabiter la logique la
//    plus sensible du produit avec sa vitrine.
// 3. Aucun doublon. Les données viennent des modules qui les possèdent
//    (`projects`, `plans`, `actuals`, `billing`) et les calculs de leurs fonctions
//    déjà testées. Ce module n'ajoute qu'une collection, `organization_settings`.
//
// Les modèles Mongoose des autres modules sont ré-enregistrés ici en LECTURE :
// @nestjs/mongoose déduplique les modèles par connexion, c'est le pattern déjà
// retenu par `BillingModule` pour compter les projets sans importer
// `ProjectsModule` (et sans créer de cycle).

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ActualPeriod, ActualPeriodSchema } from '../actuals/actual-period.schema.js';
import { Subscription, SubscriptionSchema } from '../billing/subscription.schema.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { FinancialPlan, FinancialPlanSchema } from '../plans/plan.schema.js';
import { Project, ProjectSchema } from '../projects/project.schema.js';
import { OrganizationSpaceController } from './organization-space.controller.js';
import { OrganizationSpaceService } from './organization-space.service.js';
import {
  OrganizationSettings,
  OrganizationSettingsSchema,
} from './organization-settings.schema.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`; le
    // module ré-exporte aussi les modèles `Organization` et `Membership`.
    OrganizationsModule,
    MongooseModule.forFeature([
      { name: OrganizationSettings.name, schema: OrganizationSettingsSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: FinancialPlan.name, schema: FinancialPlanSchema },
      { name: ActualPeriod.name, schema: ActualPeriodSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
  ],
  controllers: [OrganizationSpaceController],
  providers: [OrganizationSpaceService],
  exports: [OrganizationSpaceService],
})
export class OrganizationSpaceModule {}
