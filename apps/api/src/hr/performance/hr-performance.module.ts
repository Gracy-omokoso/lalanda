// Objectifs individuels et évaluations (ADR-0051 § 2.5 à § 2.7, § 3.5, § 4, § 6.3).
// ADR-0051 — H15.
//
// Module autonome, importé par `HrModule` en UNE ligne (zones de conflit d'ADR-0051) :
// il déclare ses collections, ses contrôleurs et ses services, et instancie pour lui-même
// les deux lecteurs sans état dont il a besoin (`HrSettingsService`, `HrScopeService`),
// plutôt que d'importer `HrModule` (qui l'importe).
//
// L'effacement à l'anonymisation est fait par `HrEmployeesService.anonymize` (un bloc,
// collection lue par la connexion) ; la rotation des clés par `integrations/rewrap.ts`
// (un bloc) : ni l'un ni l'autre n'importe ce module.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuditEvent, AuditEventSchema } from '../../authz/audit-event.schema.js';
import { MasterKeyringProvider } from '../../integrations/keyring.provider.js';
import { OrganizationsModule } from '../../organizations/organizations.module.js';
import { Employee, EmployeeSchema } from '../employees/employee.schema.js';
import { HrScopeService } from '../scope/hr-scope.service.js';
import { HrSettings, HrSettingsSchema } from '../settings/hr-settings.schema.js';
import { HrSettingsService } from '../settings/hr-settings.service.js';
import { HrGoalsController } from './hr-goals.controller.js';
import { HrGoalsService } from './hr-goals.service.js';
import { HrPerformanceAccess } from './hr-performance-access.js';
import { HrPerformanceNotifier } from './hr-performance-notifier.js';
import { HrPerformanceSettingsController } from './hr-performance-settings.controller.js';
import { HrPerformanceSettingsService } from './hr-performance-settings.service.js';
import { HrReviewsController } from './hr-reviews.controller.js';
import { HrReviewsService } from './hr-reviews.service.js';
import {
  Goal,
  GoalSchema,
  Review,
  ReviewCycle,
  ReviewCycleSchema,
  ReviewSchema,
} from './performance.schemas.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    MongooseModule.forFeature([
      { name: Goal.name, schema: GoalSchema },
      { name: ReviewCycle.name, schema: ReviewCycleSchema },
      { name: Review.name, schema: ReviewSchema },
      // Lecture des fiches et des réglages ; journal (débit de `reveal`).
      { name: Employee.name, schema: EmployeeSchema },
      { name: HrSettings.name, schema: HrSettingsSchema },
      { name: AuditEvent.name, schema: AuditEventSchema },
    ]),
  ],
  controllers: [HrGoalsController, HrReviewsController, HrPerformanceSettingsController],
  providers: [
    MasterKeyringProvider,
    HrSettingsService,
    HrScopeService,
    HrPerformanceSettingsService,
    HrPerformanceAccess,
    HrPerformanceNotifier,
    HrGoalsService,
    HrReviewsService,
  ],
})
export class HrPerformanceModule {}
