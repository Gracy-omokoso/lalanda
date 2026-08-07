import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BillingModule } from '../billing/billing.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { Project, ProjectSchema } from './project.schema.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  imports: [
    OrganizationsModule,
    BillingModule,
    MongooseModule.forFeature([{ name: Project.name, schema: ProjectSchema }]),
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
