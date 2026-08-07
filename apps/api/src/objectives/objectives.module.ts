import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ObjectivesController } from './objectives.controller.js';
import { FinancialObjectives, FinancialObjectivesSchema } from './objectives.schema.js';
import { ObjectivesService } from './objectives.service.js';

@Module({
  imports: [
    OrganizationsModule,
    ProjectsModule,
    PlansModule,
    MongooseModule.forFeature([
      { name: FinancialObjectives.name, schema: FinancialObjectivesSchema },
    ]),
  ],
  controllers: [ObjectivesController],
  providers: [ObjectivesService],
  exports: [ObjectivesService],
})
export class ObjectivesModule {}
