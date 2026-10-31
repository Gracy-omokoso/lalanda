// Équipements — ADR-0046 § 3, § 5.2 (application RUN `/equipements`, module API `/assets/…`).
// Créé par le lot S5 ; le lot S7 ajoute une ligne (brief, « Mes tâches ») sous son
// commentaire (ADR-0046, zones de conflit).
//
// Les modules lus (RH, achats, projets, stocks, bibliothèque, trésorerie) ne sont PAS
// importés : `AssetsLinks` les lit en lecture seule par la connexion, organisation par
// organisation. Le port des notifications est fourni par `NotificationsModule` (@Global).

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../organizations/organizations.module.js';
// ADR-0046 — S5
import { AssetsLinks } from './assets-links.js';
import {
  Asset,
  AssetAssignment,
  AssetAssignmentSchema,
  AssetCategory,
  AssetCategorySchema,
  AssetCounter,
  AssetCounterSchema,
  AssetCoverage,
  AssetCoverageSchema,
  AssetMaintenance,
  AssetMaintenanceSchema,
  AssetReminderClaim,
  AssetReminderClaimSchema,
  AssetSchema,
  AssetSettings,
  AssetSettingsSchema,
} from './assets.schemas.js';
import { AssetMaintenanceController } from './maintenance/asset-maintenance.controller.js';
import { AssetMaintenanceService } from './maintenance/asset-maintenance.service.js';
import { AssetsController } from './registry/assets.controller.js';
import { AssetsService } from './registry/assets.service.js';
import { AssetsRemindersJob } from './reminders/assets-reminders.job.js';
import { AssetSettingsController } from './settings/asset-settings.controller.js';
import { AssetSettingsService } from './settings/asset-settings.service.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    MongooseModule.forFeature([
      // ADR-0046 — S5
      { name: Asset.name, schema: AssetSchema },
      { name: AssetAssignment.name, schema: AssetAssignmentSchema },
      { name: AssetMaintenance.name, schema: AssetMaintenanceSchema },
      { name: AssetCoverage.name, schema: AssetCoverageSchema },
      { name: AssetCategory.name, schema: AssetCategorySchema },
      { name: AssetSettings.name, schema: AssetSettingsSchema },
      { name: AssetCounter.name, schema: AssetCounterSchema },
      { name: AssetReminderClaim.name, schema: AssetReminderClaimSchema },
    ]),
  ],
  controllers: [
    // ADR-0046 — S5 : les routes fixes (`categories`, `settings`) avant `/:assetId`.
    AssetSettingsController,
    AssetMaintenanceController,
    AssetsController,
  ],
  providers: [
    // ADR-0046 — S5
    AssetsLinks,
    AssetSettingsService,
    AssetsService,
    AssetMaintenanceService,
    AssetsRemindersJob,
  ],
  exports: [
    // ADR-0046 — S5
    AssetsService,
    AssetSettingsService,
  ],
})
export class AssetsModule {}
