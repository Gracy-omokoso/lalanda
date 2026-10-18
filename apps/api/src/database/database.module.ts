import { Module } from '@nestjs/common';

import { IndexesService } from './indexes.service.js';

/**
 * Entretien de la base (S25a) : aujourd'hui, la création des index en
 * production. Déclaré juste après `MongooseModule.forRootAsync` dans
 * `app.module.ts` pour que ses index existent avant que les autres modules ne
 * s'en remettent à eux au démarrage (tâches récurrentes de l'ordonnanceur).
 */
@Module({ providers: [IndexesService], exports: [IndexesService] })
export class DatabaseModule {}
