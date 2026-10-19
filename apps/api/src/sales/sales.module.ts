// Module ventes — clients et catalogue (ADR-0022, lot S25c, chantier D1).
//
// Routes sous `/sales/…`. `FiscalModule` fournit le lecteur de l'environnement
// DGI de l'organisation ; `EdefModule`, le dernier instantané des groupes de
// taxation. `SalesUsageService` est exporté pour le lot S25e (factures).

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { EdefModule } from '../edef/edef.module.js';
import { FiscalModule } from '../fiscal/fiscal.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { CatalogItem, CatalogItemSchema } from './catalog-item.schema.js';
import { CatalogItemsController } from './catalog-items.controller.js';
import { CatalogItemsService } from './catalog-items.service.js';
import { Customer, CustomerSchema } from './customer.schema.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { SalesUsageService } from './sales-usage.service.js';
import { TaxGroupsController } from './tax-groups.controller.js';
import { TaxGroupsService } from './tax-groups.service.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    FiscalModule,
    EdefModule,
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: CatalogItem.name, schema: CatalogItemSchema },
    ]),
  ],
  controllers: [CustomersController, CatalogItemsController, TaxGroupsController],
  providers: [CustomersService, CatalogItemsService, TaxGroupsService, SalesUsageService],
  exports: [SalesUsageService, TaxGroupsService],
})
export class SalesModule {}
