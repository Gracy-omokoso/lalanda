import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [OrganizationsModule, ProjectsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
