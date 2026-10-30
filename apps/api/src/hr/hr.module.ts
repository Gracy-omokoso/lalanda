// Ressources humaines — ADR-0045 (application RUN `/rh`, module API `/hr/…`). Créé par
// le lot H2 ; les lots H3, H4 et H5 ajoutent chacun leurs lignes dans `controllers`,
// `providers` et `forFeature`, sous leur commentaire (ADR-0045, zones de conflit).
//
// Le trousseau `MASTER_KEYRING` (ADR-0013) est fourni ici par le même fournisseur que
// les achats : une fabrique sans état qui lit l'environnement.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuditEvent, AuditEventSchema } from '../authz/audit-event.schema.js';
import { MasterKeyringProvider } from '../integrations/keyring.provider.js';
import { Membership, MembershipSchema } from '../organizations/membership.schema.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
// ADR-0045 — H2
import { Department, DepartmentSchema } from './departments/department.schema.js';
import { HrDepartmentsController } from './departments/hr-departments.controller.js';
import { HrDepartmentsService } from './departments/hr-departments.service.js';
import { Employee, EmployeeSchema } from './employees/employee.schema.js';
import {
  HR_EMPLOYEE_LIFECYCLE,
  noHrEmployeeLifecycle,
} from './employees/hr-employee-lifecycle.port.js';
import { HrEmployeesController } from './employees/hr-employees.controller.js';
import { HrEmployeesService } from './employees/hr-employees.service.js';
import { EmployeePrivate, EmployeePrivateSchema } from './private/employee-private.schema.js';
import { HrPrivateController } from './private/hr-private.controller.js';
import { HrPrivateNotifier } from './private/hr-private-notifier.js';
import { HrPrivateService } from './private/hr-private.service.js';
import { HrScopeService } from './scope/hr-scope.service.js';
import { HrSettings, HrSettingsSchema } from './settings/hr-settings.schema.js';
import { HrSettingsController } from './settings/hr-settings.controller.js';
import { HrSettingsService } from './settings/hr-settings.service.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    MongooseModule.forFeature([
      // ADR-0045 — H2 : réglages, services, fiches, données sensibles ; adhésions
      // (lien membre, destinataires de l'alerte bancaire) ; journal (débit de `reveal`).
      { name: HrSettings.name, schema: HrSettingsSchema },
      { name: Department.name, schema: DepartmentSchema },
      { name: Employee.name, schema: EmployeeSchema },
      { name: EmployeePrivate.name, schema: EmployeePrivateSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: AuditEvent.name, schema: AuditEventSchema },
    ]),
  ],
  controllers: [
    // ADR-0045 — H2
    HrEmployeesController,
    HrPrivateController,
    HrDepartmentsController,
    HrSettingsController,
  ],
  providers: [
    MasterKeyringProvider,
    // ADR-0045 — H2 : réglages (lecture), portée, services, fiches, données sensibles
    // chiffrées. Port des effets de sortie et d'anonymisation : nul jusqu'à H3 et H4.
    HrSettingsService,
    HrScopeService,
    HrDepartmentsService,
    HrEmployeesService,
    HrPrivateService,
    HrPrivateNotifier,
    { provide: HR_EMPLOYEE_LIFECYCLE, useValue: noHrEmployeeLifecycle },
  ],
  exports: [
    // ADR-0045 — H2
    HrSettingsService,
    HrScopeService,
    HrEmployeesService,
    HrDepartmentsService,
  ],
})
export class HrModule {}
