import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BillingModule } from '../billing/billing.module.js';
import { Scenario, ScenarioSchema } from './scenario.schema.js';
import { ScenariosService } from './scenarios.service.js';

/**
 * Module scénarios (ADR-0015 §1, lot 1-A).
 *
 * AUCUN CONTRÔLEUR ici : les routes sont le lot 1-B. Ce module existe dès
 * maintenant pour deux raisons — enregistrer le modèle `Scenario` (donc créer
 * ses index, dont l'index unique partiel de référence, `autoIndex` étant actif
 * hors production) et exporter `ScenariosService` à `ProjectsModule`, qui crée
 * le scénario de référence à la création d'un projet.
 *
 * Il n'importe PAS `ProjectsModule` : le cycle serait immédiat. Voir la note
 * d'en-tête de `ScenariosService`.
 */
@Module({
  imports: [
    // `assertUnderLimit` lit le plan effectif de l'organisation.
    BillingModule,
    MongooseModule.forFeature([{ name: Scenario.name, schema: ScenarioSchema }]),
  ],
  providers: [ScenariosService],
  exports: [ScenariosService],
})
export class ScenariosModule {}
