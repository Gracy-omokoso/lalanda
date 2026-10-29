// Lecture des relances CRM pour « Mes tâches » — ADR-0040 — C4 § 5.2.
//
// Module à part, SANS dépendance : `WorkModule` l'importe pour fournir le port
// `CRM_AGENDA_SOURCE`, et `CrmModule` importe `WorkModule` (membres, réglage
// `dueSoonDays`) — passer par `CrmModule` créerait un cycle.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  CrmActivity,
  CrmActivitySchema,
  CrmContact,
  CrmContactSchema,
  CrmOpportunity,
  CrmOpportunitySchema,
} from '../crm.schemas.js';
import { CrmAgendaSource } from './crm-agenda.source.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CrmActivity.name, schema: CrmActivitySchema },
      { name: CrmOpportunity.name, schema: CrmOpportunitySchema },
      { name: CrmContact.name, schema: CrmContactSchema },
    ]),
  ],
  providers: [CrmAgendaSource],
  exports: [CrmAgendaSource],
})
export class CrmAgendaModule {}
