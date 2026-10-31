// Bibliothèque de documents — ADR-0046 § 4, § 5.3 (application RUN `/documents`, module
// API `/documents/…`). Créé par le lot S6 ; S7 ajoute une ligne (fournisseur du brief)
// sous son commentaire (ADR-0046, zones de conflit).
//
// Le trousseau `MASTER_KEYRING` (ADR-0013) est fourni ici par le même fournisseur que
// les achats et les RH : une fabrique sans état qui lit l'environnement.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { MasterKeyringProvider } from '../integrations/keyring.provider.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
// ADR-0046 — S6
import { DocumentFoldersService } from './document-folders.service.js';
import {
  DocumentFolder,
  DocumentFolderSchema,
  LibraryDocument,
  LibraryDocumentSchema,
  LibraryDocumentVersion,
  LibraryDocumentVersionSchema,
} from './document.schemas.js';
import {
  DocumentReminderClaim,
  DocumentReminderClaimSchema,
  DocumentsJobs,
} from './documents-jobs.js';
import {
  DocumentFoldersController,
  LibraryDocumentsController,
} from './library-documents.controller.js';
import { LibraryDocumentsService } from './library-documents.service.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    MongooseModule.forFeature([
      // ADR-0046 — S6
      { name: DocumentFolder.name, schema: DocumentFolderSchema },
      { name: LibraryDocument.name, schema: LibraryDocumentSchema },
      { name: LibraryDocumentVersion.name, schema: LibraryDocumentVersionSchema },
      { name: DocumentReminderClaim.name, schema: DocumentReminderClaimSchema },
    ]),
  ],
  // Les dossiers d'abord : `GET /documents/folders` avant `GET /documents/:documentId`.
  controllers: [DocumentFoldersController, LibraryDocumentsController],
  providers: [
    MasterKeyringProvider,
    // ADR-0046 — S6
    DocumentFoldersService,
    LibraryDocumentsService,
    DocumentsJobs,
  ],
  exports: [DocumentFoldersService, LibraryDocumentsService],
})
export class DocumentsModule {}
