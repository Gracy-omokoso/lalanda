// Lecture des maintenances pour « Mes tâches » — ADR-0046 § 6.7. ADR-0046 — S7.
//
// Importe `AssetsModule` (qui n'importe que les organisations) pour `AssetsService` ;
// `WorkModule` l'importe pour fournir le port `ASSETS_AGENDA_SOURCE`.

import { Module } from '@nestjs/common';

import { AssetsModule } from '../assets.module.js';
import { AssetsAgendaSource } from './assets-agenda.source.js';

@Module({
  imports: [AssetsModule],
  providers: [AssetsAgendaSource],
  exports: [AssetsAgendaSource],
})
export class AssetsAgendaModule {}
