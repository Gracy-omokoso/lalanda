// Dépenses et trésorerie réelle — ADR-0034 (deuxième module RUN, ADR-0018).
//
// Routes sous `/treasury/…`. Lit les projets et les plans validés en LECTURE
// SEULE (aucune écriture dans un plan) ; écrit dans `actual_periods` seulement
// par le report explicite des dépenses (ADR-0034 § 5). `ObjectStorageService`
// vient du `StorageModule` global (pièces justificatives).
//
// Encaissements (ADR-0031) : lus par le port `TREASURY_RECEIPTS_SOURCE`. Le
// fournisseur par défaut est vide et se déclare non intégré ; la fusion d'ADR-0031
// le remplace sans toucher au reste du module.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ActualPeriod, ActualPeriodSchema } from '../actuals/actual-period.schema.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { TreasuryAccountsController } from './treasury-accounts.controller.js';
import { TreasuryAccountsService } from './treasury-accounts.service.js';
import { TreasuryActualsController } from './treasury-actuals.controller.js';
import { TreasuryBridgeLocks } from './treasury-bridge-locks.service.js';
import { TreasuryExpensesController } from './treasury-expenses.controller.js';
import { TreasuryExpensesService } from './treasury-expenses.service.js';
import { TreasuryMovementsService } from './treasury-movements.service.js';
import { TreasuryPlanningService } from './treasury-planning.service.js';
import { TreasuryRecurringService } from './treasury-recurring.service.js';
import {
  NoReceiptsSource,
  TREASURY_RECEIPTS_SOURCE,
  TreasuryReceivablesReader,
} from './treasury-sources.js';
import {
  TreasuryAccount,
  TreasuryAccountSchema,
  TreasuryExpense,
  TreasuryExpenseSchema,
  TreasuryMovement,
  TreasuryMovementSchema,
  TreasuryRecurringExpense,
  TreasuryRecurringExpenseSchema,
  TreasurySettings,
  TreasurySettingsSchema,
} from './treasury.schemas.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    ProjectsModule,
    PlansModule,
    MongooseModule.forFeature([
      { name: TreasuryAccount.name, schema: TreasuryAccountSchema },
      { name: TreasuryExpense.name, schema: TreasuryExpenseSchema },
      { name: TreasuryRecurringExpense.name, schema: TreasuryRecurringExpenseSchema },
      { name: TreasuryMovement.name, schema: TreasuryMovementSchema },
      { name: TreasurySettings.name, schema: TreasurySettingsSchema },
      // Écriture du réalisé (report des dépenses). Les factures sont LUES par la
      // connexion (`treasury-sources.ts`), sans modèle injecté.
      { name: ActualPeriod.name, schema: ActualPeriodSchema },
    ]),
  ],
  controllers: [TreasuryExpensesController, TreasuryAccountsController, TreasuryActualsController],
  providers: [
    TreasuryAccountsService,
    TreasuryExpensesService,
    TreasuryRecurringService,
    TreasuryMovementsService,
    TreasuryPlanningService,
    TreasuryReceivablesReader,
    TreasuryBridgeLocks,
    { provide: TREASURY_RECEIPTS_SOURCE, useClass: NoReceiptsSource },
  ],
  exports: [TreasuryBridgeLocks],
})
export class TreasuryModule {}
