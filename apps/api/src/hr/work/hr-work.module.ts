// Absences des membres pour les projets et la feuille de temps — ADR-0045 § 6.2, § 6.3.
// ADR-0045 — H5.
//
// Module à part, SANS dépendance (motif de `HrAgendaModule`) : `WorkModule` l'importe
// pour fournir le port `WORK_ABSENCES_SOURCE` sans dépendre de `HrModule`. La connexion
// Mongo vient du module racine.

import { Module } from '@nestjs/common';

import { HrWorkAbsencesSource } from './hr-work-absences.source.js';

@Module({
  providers: [HrWorkAbsencesSource],
  exports: [HrWorkAbsencesSource],
})
export class HrWorkModule {}
