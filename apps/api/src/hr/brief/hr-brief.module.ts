// Lecture des RH pour le brief du matin — ADR-0045 § 6.5. ADR-0045 — H5.
//
// Module à part, SANS dépendance vers `HrModule` (motif de `PurchasesBriefModule`) : le
// module du brief l'importe pour fournir le port `HR_SOURCE`. Le lecteur des demandes à
// valider vient de `HrAgendaModule` (le même que « Mes tâches ») ; la connexion Mongo,
// du module racine.

import { Module } from '@nestjs/common';

import { HrAgendaModule } from '../agenda/hr-agenda.module.js';
import { HrBriefSource } from './hr-brief.source.js';

@Module({
  imports: [HrAgendaModule],
  providers: [HrBriefSource],
  exports: [HrBriefSource],
})
export class HrBriefModule {}
