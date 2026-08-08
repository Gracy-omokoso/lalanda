import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ActualPeriod, ActualPeriodSchema } from './actual-period.schema.js';
import { ActualsController } from './actuals.controller.js';
import { ActualsService } from './actuals.service.js';

/**
 * Suivi prévisionnel vs réalisé (S18b — docs/08).
 * Consomme le module plans (dernier plan validé) en LECTURE SEULE — aucune
 * écriture sur les plans, qui restent immuables (S16c).
 */
@Module({
  imports: [
    // OrganizationsModule ré-exporte son MongooseModule → accès au modèle Membership
    // (vérification du rôle owner à la réouverture) sans dupliquer le schéma.
    OrganizationsModule,
    ProjectsModule,
    PlansModule,
    MongooseModule.forFeature([{ name: ActualPeriod.name, schema: ActualPeriodSchema }]),
  ],
  controllers: [ActualsController],
  providers: [ActualsService],
  exports: [ActualsService],
})
export class ActualsModule {}
