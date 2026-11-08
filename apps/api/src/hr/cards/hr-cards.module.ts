// Cartes de service et cartes de visite — ADR-0069.
//
// Module autonome importé par `HrModule` : il enregistre ses propres collections
// et relit, en lecture seule, les fiches (`hr_employees`), les services et le nom
// de l'organisation. Il fournit le point d'extension `HR_CARDS_LIFECYCLE`
// (effacement de la photo et retrait du jeton à l'anonymisation).

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BrandingModule } from '../../branding/branding.module.js';
import { Organization, OrganizationSchema } from '../../organizations/organization.schema.js';
import { OrganizationsModule } from '../../organizations/organizations.module.js';
import { PdfModule } from '../../reports/pdf.module.js';
import { Department, DepartmentSchema } from '../departments/department.schema.js';
import { Employee, EmployeeSchema } from '../employees/employee.schema.js';
import { HR_CARDS_LIFECYCLE } from '../lifecycle/hr-lifecycle.js';
import {
  HrCardProfile,
  HrCardProfileSchema,
  HrCardSettings,
  HrCardSettingsSchema,
  HrCardTemplatePackage,
  HrCardTemplatePackageSchema,
} from './card.schemas.js';
import { HrCardsController } from './hr-cards.controller.js';
import { HrCardsService } from './hr-cards.service.js';
import {
  PublicCardIpThrottlerGuard,
  PublicCardTokenThrottlerGuard,
} from './public-card-throttler.guard.js';
import { PublicCardsController } from './public-cards.controller.js';

@Module({
  imports: [
    OrganizationsModule,
    BrandingModule,
    PdfModule,
    MongooseModule.forFeature([
      { name: HrCardProfile.name, schema: HrCardProfileSchema },
      { name: HrCardSettings.name, schema: HrCardSettingsSchema },
      { name: HrCardTemplatePackage.name, schema: HrCardTemplatePackageSchema },
      { name: Employee.name, schema: EmployeeSchema },
      { name: Department.name, schema: DepartmentSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
  ],
  controllers: [HrCardsController, PublicCardsController],
  providers: [
    HrCardsService,
    PublicCardIpThrottlerGuard,
    PublicCardTokenThrottlerGuard,
    { provide: HR_CARDS_LIFECYCLE, useExisting: HrCardsService },
  ],
  exports: [HR_CARDS_LIFECYCLE],
})
export class HrCardsModule {}
