import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Project, ProjectSchema } from '../projects/project.schema.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { Subscription, SubscriptionSchema } from './subscription.schema.js';

/**
 * Module abonnements + entitlements (S16b).
 * Le modèle Project est enregistré ici aussi (lecture seule, comptage d'usage) —
 * @nestjs/mongoose déduplique les modèles par connexion, pas de conflit avec
 * ProjectsModule. Évite un import circulaire Projects ↔ Billing.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
  ],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
