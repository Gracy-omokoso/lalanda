// Reprise de l'existant (ADR-0049 § 3.2, lot K7).
//
// Module du lot K7, importé par `AccountingModule` (une ligne, zone de conflit de l'ADR).
// Il lit les points d'extension de K4 (réglages, plan, journaux) et de K5 (`AccountingEntryStore`,
// `AccountingSyncService.state`, lettrage), et le grand livre de la trésorerie
// (`TreasuryAccountsService.ledger`, lecture seule) pour le moteur `treasury`.
//
// Point d'extension exporté pour K6 : `CutoverOpeningService.reserveInput(org)` (réserve
// `OPENING_INCOMPLETE`, § 6.10).

import { forwardRef, Module } from '@nestjs/common';

import { OrganizationsModule } from '../../organizations/organizations.module.js';
import { TreasuryModule } from '../../treasury/treasury.module.js';
import { AccountingModule } from '../accounting.module.js';
import { AccountingEntriesModule } from '../entries/accounting-entries.module.js';
import { CutoverOpeningController } from './cutover-opening.controller.js';
import { CutoverOpeningService } from './cutover-opening.service.js';
import { OpeningSourcesReader } from './opening-sources.js';

@Module({
  imports: [
    OrganizationsModule,
    TreasuryModule,
    forwardRef(() => AccountingModule),
    forwardRef(() => AccountingEntriesModule),
  ],
  controllers: [CutoverOpeningController],
  providers: [OpeningSourcesReader, CutoverOpeningService],
  exports: [CutoverOpeningService],
})
export class CutoverOpeningModule {}
