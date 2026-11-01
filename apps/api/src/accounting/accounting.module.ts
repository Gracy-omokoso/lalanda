// Comptabilité SYSCOHADA (projet à valider) — ADR-0049 (application RUN `/comptabilite`,
// module API `/accounting/…`). Créé par le lot K4 (référentiel et réglages : réglages,
// activation, simulation, packs, plan de l'organisation, règles, journaux, taux,
// exercices et périodes en structure). Les lots K5, K6 et K7 ajoutent chacun leurs
// lignes dans `imports`, `controllers` ou `providers`, sous leur commentaire.
//
// Points d'extension exportés : `AccountingSettingsService` (réglages, pack choisi),
// `ChartPacksService` (contenu du pack), `AccountingAccountsService` (plan actif),
// `AccountingJournalsService` (`ensureDefaults`), `AccountingPeriodsService`
// (`periodOf`), `AccountingRatesService`, `AccountingRuleSetsService`, et les modèles
// Mongoose du lot (via `MongooseModule`). L'audit et `AuthzService` sont globaux.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../organizations/organizations.module.js';
// ADR-0049 — K4
import { AccountingAccount, AccountingAccountSchema } from './chart/accounting-account.schema.js';
import { AccountingAccountsController } from './chart/accounting-accounts.controller.js';
import { AccountingAccountsService } from './chart/accounting-accounts.service.js';
import {
  AccountingChartPacksController,
  AccountingChartPacksPlatformController,
} from './chart/accounting-chart-packs.controller.js';
import { AccountingChartPack, AccountingChartPackSchema } from './chart/chart-pack.schema.js';
import { ChartPacksService } from './chart/chart-packs.service.js';
import {
  AccountingJournal,
  AccountingJournalSchema,
} from './journals/accounting-journal.schema.js';
import { AccountingJournalsController } from './journals/accounting-journals.controller.js';
import { AccountingJournalsService } from './journals/accounting-journals.service.js';
import { AccountingFiscalYearsController } from './periods/accounting-fiscal-years.controller.js';
import {
  AccountingFiscalYear,
  AccountingFiscalYearSchema,
  AccountingPeriod,
  AccountingPeriodSchema,
} from './periods/accounting-period.schema.js';
import { AccountingPeriodsService } from './periods/accounting-periods.service.js';
import {
  AccountingExchangeRate,
  AccountingExchangeRateSchema,
} from './rates/accounting-exchange-rate.schema.js';
import { AccountingRatesController } from './rates/accounting-rates.controller.js';
import { AccountingRatesService } from './rates/accounting-rates.service.js';
import { AccountingRuleSet, AccountingRuleSetSchema } from './rules/accounting-rule-set.schema.js';
import { AccountingRuleSetsController } from './rules/accounting-rule-sets.controller.js';
import { AccountingRuleSetsService } from './rules/accounting-rule-sets.service.js';
import {
  AccountingSettings,
  AccountingSettingsSchema,
} from './settings/accounting-settings.schema.js';
import { AccountingSettingsController } from './settings/accounting-settings.controller.js';
import { AccountingSettingsService } from './settings/accounting-settings.service.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    MongooseModule.forFeature([
      // ADR-0049 — K4
      { name: AccountingChartPack.name, schema: AccountingChartPackSchema },
      { name: AccountingSettings.name, schema: AccountingSettingsSchema },
      { name: AccountingAccount.name, schema: AccountingAccountSchema },
      { name: AccountingRuleSet.name, schema: AccountingRuleSetSchema },
      { name: AccountingJournal.name, schema: AccountingJournalSchema },
      { name: AccountingExchangeRate.name, schema: AccountingExchangeRateSchema },
      { name: AccountingFiscalYear.name, schema: AccountingFiscalYearSchema },
      { name: AccountingPeriod.name, schema: AccountingPeriodSchema },
    ]),
  ],
  controllers: [
    // ADR-0049 — K4
    AccountingSettingsController,
    AccountingChartPacksController,
    AccountingChartPacksPlatformController,
    AccountingAccountsController,
    AccountingRuleSetsController,
    AccountingJournalsController,
    AccountingRatesController,
    AccountingFiscalYearsController,
  ],
  providers: [
    // ADR-0049 — K4
    ChartPacksService,
    AccountingJournalsService,
    AccountingSettingsService,
    AccountingAccountsService,
    AccountingRuleSetsService,
    AccountingPeriodsService,
    AccountingRatesService,
  ],
  exports: [
    // ADR-0049 — K4 : points d'extension des lots K5 à K7.
    MongooseModule,
    ChartPacksService,
    AccountingJournalsService,
    AccountingSettingsService,
    AccountingAccountsService,
    AccountingRuleSetsService,
    AccountingPeriodsService,
    AccountingRatesService,
  ],
})
export class AccountingModule {}
