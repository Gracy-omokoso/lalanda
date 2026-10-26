import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { TreasuryModule } from '../treasury/treasury.module.js';
import { ActualPeriod, ActualPeriodSchema } from './actual-period.schema.js';
import { ActualsController } from './actuals.controller.js';
import { ActualsService } from './actuals.service.js';
import { RunActualsLocks } from './run-actuals-locks.service.js';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/invoices/invoice.schema.js';
import {
  RunActualsBridge,
  RunActualsBridgeSchema,
} from './run-bridge/run-actuals-bridge.schema.js';
import { RunBridgeController } from './run-bridge/run-bridge.controller.js';
import { RunBridgeService } from './run-bridge/run-bridge.service.js';

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
    // ADR-0034 § 5 : verrou des lignes alimentées par le report des dépenses.
    TreasuryModule,
    MongooseModule.forFeature([
      { name: ActualPeriod.name, schema: ActualPeriodSchema },
      // ADR-0031 § 3 : réglage du pont et lecture SEULE des ventes (aucune écriture).
      { name: RunActualsBridge.name, schema: RunActualsBridgeSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
    ]),
  ],
  controllers: [ActualsController, RunBridgeController],
  providers: [ActualsService, RunBridgeService, RunActualsLocks],
  exports: [ActualsService],
})
export class ActualsModule {}
