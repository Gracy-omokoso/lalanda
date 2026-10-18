import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ScheduledJob, ScheduledJobSchema } from './scheduled-job.schema.js';
import { SchedulerService } from './scheduler.service.js';

/**
 * Ordonnanceur (S25a, ADR-0020).
 *
 * Global : chaque module métier y enregistre ses tâches dans son propre
 * `onModuleInit` (`scheduler.every(...)`, `scheduler.register(...)`) sans avoir à
 * l'importer. L'enregistrement précède toujours `onApplicationBootstrap`, où les
 * tâches récurrentes sont inscrites en base et où le minuteur démarre.
 */
@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: ScheduledJob.name, schema: ScheduledJobSchema }])],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
