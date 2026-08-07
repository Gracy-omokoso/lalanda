import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { FinancialPlan, FinancialPlanSchema } from './plan.schema.js';
import { PlansController } from './plans.controller.js';
import { PlansService } from './plans.service.js';

@Module({
  imports: [
    OrganizationsModule,
    ProjectsModule,
    MongooseModule.forFeature([{ name: FinancialPlan.name, schema: FinancialPlanSchema }]),
  ],
  controllers: [PlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
