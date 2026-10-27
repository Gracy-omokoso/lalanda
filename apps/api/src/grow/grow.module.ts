import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ActualPeriod, ActualPeriodSchema } from '../actuals/actual-period.schema.js';
import { BillingModule } from '../billing/billing.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { FinancialPlan, FinancialPlanSchema } from '../plans/plan.schema.js';
import { Project, ProjectSchema } from '../projects/project.schema.js';
import { CatalogItem, CatalogItemSchema } from '../sales/catalog-item.schema.js';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/invoices/invoice.schema.js';
import { TreasuryModule } from '../treasury/treasury.module.js';
import { GrowProfile, GrowProfileSchema } from './grow-profile.schema.js';
import { GrowProfileService } from './grow-profile.service.js';
import { GrowReaderService } from './grow-reader.service.js';
import { GrowController } from './grow.controller.js';

/**
 * GROW, premier lot (ADR-0032) : santé, indicateurs investisseurs, parcours.
 *
 * Les modèles de BUILD (projets, plans, réalisé) et de RUN (factures, catalogue)
 * sont enregistrés ici pour être LUS — @nestjs/mongoose déduplique les modèles par
 * connexion, comme `BillingModule` le fait déjà pour `Project`. GROW n'écrit que
 * dans `grow_profiles` (vérifié par `grow-readonly.surface.test.ts`).
 */
@Module({
  imports: [
    // AuthGuard résout l'organisation active via OrganizationsService.
    OrganizationsModule,
    BillingModule,
    // ADR-0034 : soldes des comptes de trésorerie (lecture seule), amendement
    // d'ADR-0032 du 27 oct. 2026.
    TreasuryModule,
    MongooseModule.forFeature([
      { name: GrowProfile.name, schema: GrowProfileSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: FinancialPlan.name, schema: FinancialPlanSchema },
      { name: ActualPeriod.name, schema: ActualPeriodSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: CatalogItem.name, schema: CatalogItemSchema },
    ]),
  ],
  controllers: [GrowController],
  providers: [GrowProfileService, GrowReaderService],
  exports: [GrowReaderService],
})
export class GrowModule {}
