// Lecture des demandes d'absence à traiter pour « Mes tâches » et pour la liste
// « À valider » — ADR-0045 § 6.1. ADR-0045 — H3.
//
// Module à part, SANS dépendance (motif de `PurchasesAgendaModule`) : `WorkModule`
// l'importe pour fournir le port `HR_AGENDA_SOURCE` sans dépendre de `HrModule` ;
// `HrModule` l'importe pour réutiliser le même lecteur. `AuthzService` vient du module
// global d'autorisation. Le lot H4 fournit ici le jeton `HR_CHECKLIST_AGENDA`.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

// ADR-0045 — H4 : lecteur des éléments de liste (port `HR_CHECKLIST_AGENDA`).
import { Checklist, ChecklistSchema } from '../checklists/checklist.schemas.js';
import { HrChecklistAgendaSource } from '../checklists/hr-checklist-agenda.reader.js';
import { Employee, EmployeeSchema } from '../employees/employee.schema.js';
import { LeaveRequest, LeaveRequestSchema } from '../leave/leave-request.schema.js';
import { LeaveType, LeaveTypeSchema } from '../leave/leave-type.schema.js';
import { HrAgendaSource } from './hr-agenda.source.js';
import { HR_CHECKLIST_AGENDA } from './hr-checklist-agenda.port.js';
import { HrLeaveApprovalsReader } from './hr-leave-approvals.reader.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LeaveRequest.name, schema: LeaveRequestSchema },
      { name: LeaveType.name, schema: LeaveTypeSchema },
      { name: Employee.name, schema: EmployeeSchema },
      // ADR-0045 — H4
      { name: Checklist.name, schema: ChecklistSchema },
    ]),
  ],
  providers: [
    HrLeaveApprovalsReader,
    HrAgendaSource,
    // ADR-0045 — H4 : éléments de liste d'entrée et de sortie de l'appelant.
    HrChecklistAgendaSource,
    { provide: HR_CHECKLIST_AGENDA, useExisting: HrChecklistAgendaSource },
  ],
  exports: [HrLeaveApprovalsReader, HrAgendaSource],
})
export class HrAgendaModule {}
