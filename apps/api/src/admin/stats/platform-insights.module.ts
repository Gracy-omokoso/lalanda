// Statistiques et finances du site (ADR-0053 § 6.7, § 6.8 — lot P7).
//
// Lecture seule, par la connexion Mongo (projections minimales) : aucun modèle de
// collection métier n'est injecté. `IntegrationsModule` fournit `PlatformAuditService`
// (journal de l'export) ; `AuthzService` vient du module global d'autorisation.

import { Module } from '@nestjs/common';

import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { OrganizationsModule } from '../../organizations/organizations.module.js';
import { AdminFinanceController } from '../finance/admin-finance.controller.js';
import { AdminFinanceService } from '../finance/admin-finance.service.js';
import { AdminStatsController } from './admin-stats.controller.js';
import { AdminStatsService } from './admin-stats.service.js';

@Module({
  imports: [OrganizationsModule, IntegrationsModule],
  controllers: [AdminStatsController, AdminFinanceController],
  providers: [AdminStatsService, AdminFinanceService],
})
export class PlatformInsightsModule {}
