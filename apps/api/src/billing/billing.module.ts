import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { Project, ProjectSchema } from '../projects/project.schema.js';
import { BillingController } from './billing.controller.js';
import { BillingJobs } from './billing.jobs.js';
import { BillingService } from './billing.service.js';
import { PdfExportQuotaService } from './pdf-export-quota.service.js';
import { PdfExportEvent, PdfExportEventSchema } from './pdf-export-usage.schema.js';
import { PdfExportUsageService } from './pdf-export-usage.service.js';
import { Subscription, SubscriptionSchema } from './subscription.schema.js';

/**
 * Module abonnements + entitlements (S16b).
 * Le modèle Project est enregistré ici aussi (lecture seule, comptage d'usage) —
 * @nestjs/mongoose déduplique les modèles par connexion, pas de conflit avec
 * ProjectsModule. Évite un import circulaire Projects ↔ Billing.
 *
 * Le quota d'exports PDF vit ici, et pas dans `reports/`, pour la même raison
 * que la limite de projets vit ici et pas dans `projects/` : c'est une règle
 * COMMERCIALE, elle se relit avec la grille tarifaire. `ReportsModule` importe
 * déjà ce module (il y lit les entitlements du filigrane) et n'a donc qu'à
 * injecter `PdfExportQuotaService`.
 */
@Module({
  imports: [
    // AuthGuard (BillingController) résout l'org active via OrganizationsService.
    OrganizationsModule,
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: PdfExportEvent.name, schema: PdfExportEventSchema },
    ]),
  ],
  controllers: [BillingController],
  providers: [BillingService, PdfExportUsageService, PdfExportQuotaService, BillingJobs],
  // `PdfExportQuotaService` est exporté pour `ReportsModule`, qui garde ses
  // rendus avec. `PdfExportUsageService` ne l'est pas : personne n'a de raison
  // d'écrire dans le compteur sans passer par la garde.
  exports: [BillingService, PdfExportQuotaService],
})
export class BillingModule {}
