// Lecture de la bibliothèque pour le brief du matin — ADR-0046 § 6.6. ADR-0046 — S7.
//
// Importe `DocumentsModule` pour `LibraryDocumentsService` (droits des dossiers) ; le
// module du brief l'importe à son tour pour fournir le port `DOCUMENTS_SOURCE`.

import { Module } from '@nestjs/common';

import { DocumentsModule } from '../documents.module.js';
import { DocumentsBriefSource } from './documents-brief.source.js';

@Module({
  imports: [DocumentsModule],
  providers: [DocumentsBriefSource],
  exports: [DocumentsBriefSource],
})
export class DocumentsBriefModule {}
