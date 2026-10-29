// Module de composition de la conversion prospect → client (ADR-0040 § 3.1.1).
// ADR-0040 — C1.
//
// Importe Ventes ET le CRM. `CrmModule` ne peut pas importer `SalesModule` :
// Ventes l'importe déjà (synchronisation client → compte), ce serait un cycle.
// Même motif que `CrmOverviewModule` (lot C8).

import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../../../organizations/organizations.module.js';
import { SalesModule } from '../../../sales/sales.module.js';
import { CrmModule } from '../../crm.module.js';
import { CrmAccountConversionController } from './crm-account-conversion.controller.js';
import { CrmAccountConversionService } from './crm-account-conversion.service.js';

@Module({
  // `AuthGuard` résout l'organisation active via `OrganizationsService`.
  imports: [OrganizationsModule, SalesModule, CrmModule],
  controllers: [CrmAccountConversionController],
  providers: [CrmAccountConversionService],
})
export class CrmAccountConversionModule {}
