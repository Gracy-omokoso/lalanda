// Bibliothèque de documents — ADR-0046 § 5.3. ADR-0046 — S6.
//
//   GET    /documents/folders                     docs.read (arbre filtré)
//   POST   /documents/folders                     docs.manage
//   POST   /documents/folders/defaults            docs.manage — dossiers proposés (§ 4.1)
//   PUT    /documents/folders/:folderId           docs.manage (+ lecture du dossier)
//   POST   /documents/folders/:folderId/archive   docs.manage — vide seulement
//   GET    /documents?folderId=&entityType=&entityId=   docs.read — IDENTIFIANTS seulement
//   POST   /documents/search                      docs.read — critères dans le CORPS
//   GET    /documents/deadlines?within=           docs.read
//   GET    /documents/entity-pieces?entityType=&entityId=   docs.read + module de l'entité
//   POST   /documents                             docs.read + écriture du dossier ;
//                                                 `multipart/form-data` ; 30 par heure
//   GET    /documents/:documentId                 docs.read + dossier + liens
//   PUT    /documents/:documentId                 écriture (JSON : métadonnées, liens)
//   POST   /documents/:documentId/archive|restore écriture
//   DELETE /documents/:documentId                 écriture — suppression logique
//   POST   /documents/:documentId/versions        écriture ; `multipart/form-data`
//   POST   /documents/:documentId/versions/:versionId/restore   écriture
//   GET    /documents/:documentId/versions/:versionId/file      lecture ; téléchargement
//                                                 INERTE, journalisé (strict si sensible)
//
// Le titre, les étiquettes, les liens et le nom du fichier ne passent JAMAIS dans
// l'URL ni dans un en-tête (journalisés par pino-http) : formulaire ou corps JSON.

import {
  CreateDocumentFolderBodySchema,
  DOCUMENT_FILE_FIELD,
  DOCUMENT_LIMITS,
  DocumentDeadlinesQuerySchema,
  DocumentListQuerySchema,
  DocumentRevisionBodySchema,
  DocumentSearchBodySchema,
  EntityPiecesQuerySchema,
  UpdateDocumentFolderBodySchema,
  UpdateLibraryDocumentBodySchema,
  UploadDocumentVersionFieldsSchema,
  UploadLibraryDocumentFieldsSchema,
  type DocumentDeadlineList,
  type DocumentFolderList,
  type DocumentFolderView,
  type EntityPiecesView,
  type LibraryDocumentDetail,
  type LibraryDocumentPage,
} from '@lalanda/shared/documents';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { z } from 'zod';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { storageFailure } from '../purchases/attachments/purchase-attachments.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import { contentDisposition } from '../work/work-attachments.service.js';
import { documentsActorOf } from './document-access.js';
import { DocumentFoldersService } from './document-folders.service.js';
import type { LibraryDocumentVersionLean } from './document.schemas.js';
import {
  LibraryDocumentsService,
  classifyLibraryDocument,
  type DocumentUploadedFile,
} from './library-documents.service.js';

type User = { id: string };
type Perms = CurrentOrgPermissionsValue | undefined;

/** Formulaire lu EN MÉMOIRE, borné : rien n'est écrit sur disque, ni la pièce ni ses champs. */
const UPLOAD_LIMITS = {
  fileSize: DOCUMENT_LIMITS.pdfMaxBytes,
  files: 1,
  fields: 12,
  fieldSize: 4_000,
  parts: 13,
};

function parse<S extends z.ZodType>(schema: S, value: unknown, message: string): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) invalidRequest(parsed.error, message);
  return parsed.data;
}

/** Sert une version : TOUJOURS en téléchargement, en-têtes inertes, jamais en cache. */
function sendVersion(res: Response, v: LibraryDocumentVersionLean, body: Buffer): void {
  res
    .status(200)
    .set({
      'Content-Type': v.contentType,
      'Content-Length': String(body.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': contentDisposition('attachment', v.fileName),
      'Cache-Control': 'private, no-store',
    })
    .end(body);
}

@Controller('documents/folders')
@UseGuards(AuthGuard, PermissionsGuard)
export class DocumentFoldersController {
  constructor(@Inject(DocumentFoldersService) private readonly folders: DocumentFoldersService) {}

  @Get()
  @RequirePermission('docs.read')
  list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
  ): Promise<DocumentFolderList> {
    return this.folders.list(orgId, documentsActorOf(user.id, perms));
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('docs.manage')
  create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() body: unknown,
  ): Promise<DocumentFolderView> {
    const data = parse(CreateDocumentFolderBodySchema, body, 'Dossier invalide.');
    return this.folders.create(orgId, documentsActorOf(user.id, perms), data);
  }

  @Post('defaults')
  @HttpCode(200)
  @RequirePermission('docs.manage')
  defaults(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
  ): Promise<DocumentFolderList> {
    return this.folders.createDefaults(orgId, documentsActorOf(user.id, perms));
  }

  @Put(':folderId')
  @RequirePermission('docs.manage')
  update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('folderId') folderId: string,
    @Body() body: unknown,
  ): Promise<DocumentFolderView> {
    const data = parse(UpdateDocumentFolderBodySchema, body, 'Dossier invalide.');
    return this.folders.update(orgId, documentsActorOf(user.id, perms), folderId, data);
  }

  @Post(':folderId/archive')
  @HttpCode(200)
  @RequirePermission('docs.manage')
  archive(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('folderId') folderId: string,
    @Body() body: unknown,
  ): Promise<DocumentFolderView> {
    const data = parse(DocumentRevisionBodySchema, body, 'Révision attendue.');
    return this.folders.archive(orgId, documentsActorOf(user.id, perms), folderId, data);
  }
}

@Controller('documents')
@UseGuards(AuthGuard, PermissionsGuard)
export class LibraryDocumentsController {
  constructor(
    @Inject(LibraryDocumentsService) private readonly documents: LibraryDocumentsService,
  ) {}

  @Get()
  @RequirePermission('docs.read')
  list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Query() query: unknown,
  ): Promise<LibraryDocumentPage> {
    const q = parse(DocumentListQuerySchema, query, 'Paramètres de liste invalides.');
    return this.documents.list(orgId, documentsActorOf(user.id, perms), q);
  }

  @Post('search')
  @HttpCode(200)
  @RequirePermission('docs.read')
  search(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() body: unknown,
  ): Promise<LibraryDocumentPage> {
    const b = parse(DocumentSearchBodySchema, body, 'Critères de recherche invalides.');
    return this.documents.search(orgId, documentsActorOf(user.id, perms), b);
  }

  @Get('deadlines')
  @RequirePermission('docs.read')
  deadlines(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Query() query: unknown,
  ): Promise<DocumentDeadlineList> {
    const q = parse(DocumentDeadlinesQuerySchema, query, 'Paramètres invalides.');
    return this.documents.deadlines(orgId, documentsActorOf(user.id, perms), q);
  }

  @Get('entity-pieces')
  @RequirePermission('docs.read')
  entityPieces(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Query() query: unknown,
  ): Promise<EntityPiecesView> {
    const q = parse(EntityPiecesQuerySchema, query, 'Paramètres invalides.');
    return this.documents.entityPieces(orgId, documentsActorOf(user.id, perms), q);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('docs.read')
  @Throttle({ default: { ttl: 3_600_000, limit: DOCUMENT_LIMITS.uploadsPerHourPerUser } })
  @UseGuards(UserThrottlerGuard)
  @UseInterceptors(FileInterceptor(DOCUMENT_FILE_FIELD, { limits: UPLOAD_LIMITS }))
  async upload(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() fields: unknown,
    @UploadedFile() upload: DocumentUploadedFile | undefined,
  ): Promise<LibraryDocumentDetail> {
    const meta = parse(
      UploadLibraryDocumentFieldsSchema,
      { ...(fields as object) },
      'Métadonnées du document invalides.',
    );
    const actor = documentsActorOf(user.id, perms);
    await this.documents.assertCanUpload(orgId, actor, meta);
    const file = classifyLibraryDocument(upload);
    try {
      return await this.documents.upload(orgId, actor, meta, file, upload?.originalname);
    } catch (cause) {
      throw storageFailure(cause);
    }
  }

  @Get(':documentId')
  @RequirePermission('docs.read')
  get(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('documentId') documentId: string,
  ): Promise<LibraryDocumentDetail> {
    return this.documents.get(orgId, documentsActorOf(user.id, perms), documentId);
  }

  @Put(':documentId')
  @RequirePermission('docs.read')
  update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
  ): Promise<LibraryDocumentDetail> {
    const b = parse(UpdateLibraryDocumentBodySchema, body, 'Document invalide.');
    return this.documents.update(orgId, documentsActorOf(user.id, perms), documentId, b);
  }

  @Post(':documentId/archive')
  @HttpCode(200)
  @RequirePermission('docs.read')
  archive(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
  ): Promise<LibraryDocumentDetail> {
    const b = parse(DocumentRevisionBodySchema, body, 'Révision attendue.');
    return this.documents.setStatus(
      orgId,
      documentsActorOf(user.id, perms),
      documentId,
      'archived',
      b,
    );
  }

  @Post(':documentId/restore')
  @HttpCode(200)
  @RequirePermission('docs.read')
  restore(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
  ): Promise<LibraryDocumentDetail> {
    const b = parse(DocumentRevisionBodySchema, body, 'Révision attendue.');
    return this.documents.setStatus(
      orgId,
      documentsActorOf(user.id, perms),
      documentId,
      'active',
      b,
    );
  }

  @Delete(':documentId')
  @HttpCode(204)
  @RequirePermission('docs.read')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('documentId') documentId: string,
  ): Promise<void> {
    await this.documents.remove(orgId, documentsActorOf(user.id, perms), documentId);
  }

  @Post(':documentId/versions')
  @HttpCode(201)
  @RequirePermission('docs.read')
  @Throttle({ default: { ttl: 3_600_000, limit: DOCUMENT_LIMITS.uploadsPerHourPerUser } })
  @UseGuards(UserThrottlerGuard)
  @UseInterceptors(FileInterceptor(DOCUMENT_FILE_FIELD, { limits: UPLOAD_LIMITS }))
  async addVersion(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('documentId') documentId: string,
    @Body() fields: unknown,
    @UploadedFile() upload: DocumentUploadedFile | undefined,
  ): Promise<LibraryDocumentDetail> {
    const meta = parse(
      UploadDocumentVersionFieldsSchema,
      { ...(fields as object) },
      'Champs de la version invalides.',
    );
    const actor = documentsActorOf(user.id, perms);
    await this.documents.assertCanAddVersion(orgId, actor, documentId);
    const file = classifyLibraryDocument(upload);
    try {
      return await this.documents.addVersion(
        orgId,
        actor,
        documentId,
        meta,
        file,
        upload?.originalname,
      );
    } catch (cause) {
      throw storageFailure(cause);
    }
  }

  @Post(':documentId/versions/:versionId/restore')
  @HttpCode(201)
  @RequirePermission('docs.read')
  async restoreVersion(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('documentId') documentId: string,
    @Param('versionId') versionId: string,
  ): Promise<LibraryDocumentDetail> {
    try {
      return await this.documents.restoreVersion(
        orgId,
        documentsActorOf(user.id, perms),
        documentId,
        versionId,
      );
    } catch (cause) {
      throw storageFailure(cause);
    }
  }

  @Get(':documentId/versions/:versionId/file')
  @RequirePermission('docs.read')
  async download(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('documentId') documentId: string,
    @Param('versionId') versionId: string,
    @Res() res: Response,
  ): Promise<void> {
    let found;
    try {
      found = await this.documents.download(
        orgId,
        documentsActorOf(user.id, perms),
        documentId,
        versionId,
      );
    } catch (cause) {
      throw storageFailure(cause);
    }
    sendVersion(res, found.version, found.body);
  }
}
