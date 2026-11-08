// Dépenses et trésorerie réelle — ADR-0034 (deuxième module RUN, ADR-0018).
//
// Routes sous `/treasury/…`. Lit les projets et les plans validés en LECTURE
// SEULE (aucune écriture dans un plan) ; écrit dans `actual_periods` seulement
// par le report explicite des dépenses (ADR-0034 § 5). `ObjectStorageService`
// vient du `StorageModule` global (pièces justificatives).
//
// Encaissements (ADR-0031) : lus par le port `TREASURY_RECEIPTS_SOURCE`, fourni
// depuis l'intégration du 26 oct. 2026 par `SalesReceiptsSource` (encaissements
// et reste à encaisser réel du module Ventes, en lecture seule).

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ActualPeriod, ActualPeriodSchema } from '../actuals/actual-period.schema.js';
import { RunLinkModule } from '../actuals/run-link/run-link.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { TreasuryAccountsController } from './treasury-accounts.controller.js';
import { TreasuryAccountsService } from './treasury-accounts.service.js';
import { TreasuryActualsController } from './treasury-actuals.controller.js';
import { TreasuryBridgeLocks } from './treasury-bridge-locks.service.js';
import { TreasuryExpensesController } from './treasury-expenses.controller.js';
import { TreasuryExpensesService } from './treasury-expenses.service.js';
import { TreasuryMovementsService } from './treasury-movements.service.js';
import { TreasuryPlanningService } from './treasury-planning.service.js';
import { TreasuryRecurringService } from './treasury-recurring.service.js';
// ADR-0044 — P5 : échéances fournisseurs (lecture seule par la connexion, sans
// importer le module des achats, qui importe celui-ci).
import { PurchasesPayablesSource } from '../purchases/treasury/purchases-payables.source.js';
// ADR-0051 — H10 : remboursements au personnel (lecture seule par la connexion, sans
// importer le module RH, qui importe celui-ci).
import { HrPayablesSource } from '../hr/expenses/hr-payables.source.js';
import {
  SalesReceiptsSource,
  TREASURY_HR_PAYABLES_SOURCE,
  TREASURY_PAYABLES_SOURCE,
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

// ADR-0071 — tableaux de bord des écrans
import { TreasuryStatsController } from './treasury-stats.controller.js';
import { TreasuryStatsService } from './treasury-stats.service.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    ProjectsModule,
    PlansModule,
    // Rattachement commun aux deux ponts vers le réalisé (projet, début d'exercice).
    RunLinkModule,
    // ADR-0031 : encaissements et règlements (`SalesTreasuryFeed`, lecture seule).
    SalesModule,
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
  // ADR-0071 : `TreasuryStatsController` AVANT les dépenses et les comptes.
  controllers: [
    TreasuryStatsController,
    TreasuryExpensesController,
    TreasuryAccountsController,
    TreasuryActualsController,
  ],
  providers: [
    // ADR-0071
    TreasuryStatsService,
    TreasuryAccountsService,
    TreasuryExpensesService,
    TreasuryRecurringService,
    TreasuryMovementsService,
    TreasuryPlanningService,
    TreasuryReceivablesReader,
    TreasuryBridgeLocks,
    { provide: TREASURY_RECEIPTS_SOURCE, useClass: SalesReceiptsSource },
    // ADR-0044 — P5 (§ 6.3)
    { provide: TREASURY_PAYABLES_SOURCE, useClass: PurchasesPayablesSource },
    // ADR-0051 — H10 (§ 7.2) : notes approuvées non remboursées, avances non versées.
    { provide: TREASURY_HR_PAYABLES_SOURCE, useClass: HrPayablesSource },
  ],
  // ADR-0033 (amendement du 27 oct. 2026) : le brief lit les soldes des comptes.
  // ADR-0044 — P5 (§ 6.2) : les paiements fournisseurs écrivent leurs dépenses par
  // `TreasuryExpensesService`, seul écrivain de `treasury_expenses`.
  // ADR-0051 — H11 (§ 7.1) : les RH écrivent leurs dépenses et leurs mouvements
  // d'avance par `recordOwnedByExpenseReport` et `recordOwnedByAdvance`.
  exports: [
    TreasuryBridgeLocks,
    TreasuryAccountsService,
    TreasuryExpensesService,
    TreasuryMovementsService,
  ],
})
export class TreasuryModule {}
