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
import { HR_EMPLOYEE_LIFECYCLE } from './employees/hr-employee-lifecycle.port.js';
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
// ADR-0045 — H3
import { HrLeaveAccrualsJob } from './accruals/hr-leave-accruals.job.js';
import { HrAgendaModule } from './agenda/hr-agenda.module.js';
import { HrCalendarController } from './calendar/hr-calendar.controller.js';
import { Holiday, HolidaySchema } from './holidays/holiday.schema.js';
import { HrHolidaysController } from './holidays/hr-holidays.controller.js';
import { HrHolidaysService } from './holidays/hr-holidays.service.js';
import { HrNotifier } from './hr-notifier.js';
import { HrLeaveTypesController } from './leave/hr-leave-types.controller.js';
import { HrLeaveTypesService } from './leave/hr-leave-types.service.js';
import { HrLeaveController } from './leave/hr-leave.controller.js';
import { HrLeaveService } from './leave/hr-leave.service.js';
import { LeaveLedgerEntry, LeaveLedgerEntrySchema } from './leave/leave-ledger.schema.js';
import { LeaveRequest, LeaveRequestSchema } from './leave/leave-request.schema.js';
import { LeaveType, LeaveTypeSchema } from './leave/leave-type.schema.js';
import { HrLifecycleHub } from './lifecycle/hr-lifecycle.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    // ADR-0045 — H3 : lecteur des demandes à valider, partagé avec « Mes tâches ».
    HrAgendaModule,
    MongooseModule.forFeature([
      // ADR-0045 — H2 : réglages, services, fiches, données sensibles ; adhésions
      // (lien membre, destinataires de l'alerte bancaire) ; journal (débit de `reveal`).
      { name: HrSettings.name, schema: HrSettingsSchema },
      { name: Department.name, schema: DepartmentSchema },
      { name: Employee.name, schema: EmployeeSchema },
      { name: EmployeePrivate.name, schema: EmployeePrivateSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: AuditEvent.name, schema: AuditEventSchema },
      // ADR-0045 — H3 : types d'absence, fériés, demandes, grand livre.
      { name: LeaveType.name, schema: LeaveTypeSchema },
      { name: Holiday.name, schema: HolidaySchema },
      { name: LeaveRequest.name, schema: LeaveRequestSchema },
      { name: LeaveLedgerEntry.name, schema: LeaveLedgerEntrySchema },
    ]),
  ],
  controllers: [
    // ADR-0045 — H2
    HrEmployeesController,
    HrPrivateController,
    HrDepartmentsController,
    HrSettingsController,
    // ADR-0045 — H3
    HrLeaveTypesController,
    HrHolidaysController,
    HrLeaveController,
    HrCalendarController,
  ],
  providers: [
    MasterKeyringProvider,
    // ADR-0045 — H2 : réglages (lecture), portée, services, fiches, données sensibles
    // chiffrées.
    HrSettingsService,
    HrScopeService,
    HrDepartmentsService,
    HrEmployeesService,
    HrPrivateService,
    HrPrivateNotifier,
    // ADR-0045 — H3 : absences, circuit, grand livre, acquisitions, notifications ; le
    // port des effets de sortie annule les absences futures (H4 y branche les documents
    // par `HR_DOCUMENTS_LIFECYCLE`).
    HrLeaveTypesService,
    HrHolidaysService,
    HrNotifier,
    HrLeaveService,
    HrLeaveAccrualsJob,
    HrLifecycleHub,
    { provide: HR_EMPLOYEE_LIFECYCLE, useExisting: HrLifecycleHub },
  ],
  exports: [
    // ADR-0045 — H2
    HrSettingsService,
    HrScopeService,
    HrEmployeesService,
    HrDepartmentsService,
    // ADR-0045 — H3
    HrLeaveService,
    HrLeaveTypesService,
    HrHolidaysService,
  ],
})
export class HrModule {}
