// Restitution, clôtures et exports de la comptabilité (ADR-0049, lot K6).
//
// Module du lot K6, importé par `AccountingModule` (une ligne, zone de conflit de l'ADR) ;
// il lit en retour les points d'extension de K4 (réglages, pack, plan, règles, périodes)
// par `forwardRef`, et ceux de K5 (`AccountingEntriesService.reportingEntries`,
// `AccountingEntryStore`) par `AccountingEntriesModule`. Le rendu PDF est le moteur
// partagé du dépôt (`PdfModule`, un seul Chromium).
//
// Contrôleurs nommés `Ledger…` : les blocs K4 et K5 de `routes-coverage` énumèrent
// strictement les `Accounting…Controller` et les `Bookkeeping…Controller`.

import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../../organizations/organizations.module.js';
import { PdfModule } from '../../reports/pdf.module.js';
import { AccountingModule } from '../accounting.module.js';
import {
  AccountingClosing,
  AccountingClosingSchema,
} from '../closing/accounting-closing.schema.js';
import { AccountingClosingService } from '../closing/accounting-closing.service.js';
import { LedgerClosingController } from '../closing/ledger-closing.controller.js';
import { AccountingEntriesModule } from '../entries/accounting-entries.module.js';
import {
  AccountingExport,
  AccountingExportFile,
  AccountingExportFileSchema,
  AccountingExportSchema,
} from '../exports/accounting-export.schema.js';
import { AccountingExportsService } from '../exports/accounting-exports.service.js';
import {
  OrgAccountingExportThrottlerGuard,
  UserAccountingExportThrottlerGuard,
} from '../exports/export-throttler.guard.js';
import { LedgerExportsController } from '../exports/ledger-exports.controller.js';
import { CutoverOpeningModule } from '../opening/cutover-opening.module.js';
import { AccountingReconciliationService } from '../reconciliation/accounting-reconciliation.service.js';
import { LedgerReconciliationController } from '../reconciliation/ledger-reconciliation.controller.js';
import { AccountingStatementsService } from '../statements/accounting-statements.service.js';
import { LedgerStatementsController } from '../statements/ledger-statements.controller.js';
import { AccountingReportingService } from './accounting-reporting.service.js';
import { LedgerReportsController } from './ledger-reports.controller.js';

@Module({
  imports: [
    OrganizationsModule,
    PdfModule,
    forwardRef(() => AccountingModule),
    AccountingEntriesModule,
    forwardRef(() => CutoverOpeningModule),
    MongooseModule.forFeature([
      { name: AccountingClosing.name, schema: AccountingClosingSchema },
      { name: AccountingExport.name, schema: AccountingExportSchema },
      { name: AccountingExportFile.name, schema: AccountingExportFileSchema },
    ]),
  ],
  controllers: [
    LedgerReportsController,
    LedgerStatementsController,
    LedgerClosingController,
    LedgerReconciliationController,
    LedgerExportsController,
  ],
  providers: [
    AccountingReportingService,
    AccountingStatementsService,
    AccountingClosingService,
    AccountingReconciliationService,
    AccountingExportsService,
    UserAccountingExportThrottlerGuard,
    OrgAccountingExportThrottlerGuard,
  ],
  exports: [AccountingReportingService, AccountingStatementsService, AccountingClosingService],
})
export class AccountingReportingModule {}
