import { Module } from '@nestjs/common';

import { BillingModule } from '../billing/billing.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { PdfModule } from './pdf.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [OrganizationsModule, ProjectsModule, PlansModule, BillingModule, PdfModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
