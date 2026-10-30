// Branchements « argent » des projets du RUN — ADR-0039 lot L4a.
//
// Importe `WorkModule` (services et modèles du cœur, lot L1) et `SalesModule`
// (`InvoiceDraftsService`, utilisé tel quel). Les devis, factures, encaissements
// et dépenses sont LUS en lecture seule par la connexion ; ce module n'écrit que
// `work_invoice_links` et le champ `billing` des jalons.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../../organizations/organizations.module.js';
import { SalesModule } from '../../sales/sales.module.js';
import { PurchasesMarginSource } from '../../purchases/margin/purchases-margin.source.js';
import { ProjectMarginService } from '../margin/project-margin.service.js';
import { WORK_PURCHASES_SOURCE } from '../margin/work-purchases.port.js';
import { WorkModule } from '../work.module.js';
import { WorkBillingController } from './work-billing.controller.js';
import { WorkBillingService } from './work-billing.service.js';
import { WorkInvoiceLink, WorkInvoiceLinkSchema } from './work-invoice-link.schema.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active.
    OrganizationsModule,
    WorkModule,
    SalesModule,
    MongooseModule.forFeature([{ name: WorkInvoiceLink.name, schema: WorkInvoiceLinkSchema }]),
  ],
  controllers: [WorkBillingController],
  providers: [
    WorkBillingService,
    ProjectMarginService,
    // ADR-0044 — P6 : coûts engagés de la marge (lecture seule par la connexion).
    { provide: WORK_PURCHASES_SOURCE, useClass: PurchasesMarginSource },
  ],
})
export class WorkBillingModule {}
