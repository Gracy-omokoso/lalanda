// Devis — ADR-0035 § 4.
//
// `sales.read` pour lire et imprimer ; `sales.quote` (ADR-0040 § 4.1) pour
// préparer, supprimer un brouillon, marquer envoyé, accepté ou refusé et créer
// une nouvelle version ; `sales.quote` + `sales.manage` pour convertir en
// brouillon de facture (le brouillon de facture reste un geste de facturation).
// Un devis n'engage pas le contribuable : l'émission de la facture qui en naît
// reste en `sales.invoice`. Un devis d'une autre organisation répond 404.
// `GET`/`POST :id/email` (`sales.quote`, ADR-0042) : envoi au client, PDF joint.

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
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import {
  OrgDocumentEmailThrottlerGuard,
  UserDocumentEmailThrottlerGuard,
} from '../../security/document-email-throttler.guard.js';
import type { DocumentEmailDraft, DocumentEmailResult } from '../documents/document-email.js';
import { documentEmailInputOf, senderOf } from '../documents/invoice-documents.controller.js';
import { invalidRequest } from '../sales.errors.js';
import type { InvoiceActor } from '../invoices/invoice.types.js';
import { QuoteDocumentsService } from './quote-documents.service.js';
import {
  QuotesService,
  type QuoteConversionResult,
  type QuotePage,
  type QuoteView,
} from './quotes.service.js';
import {
  CreateQuoteSchema,
  ListQuotesQuerySchema,
  PutQuoteSchema,
  QuoteRevisionSchema,
  RefuseQuoteSchema,
} from './quotes.dto.js';

type User = { id: string; email: string; name?: string | null };

function actorOf(user: User, role: OrgRole | undefined): InvoiceActor {
  const name = user.name?.trim();
  return { userId: user.id, name: name ? name : user.email, role: role ?? 'unknown' };
}

function revisionOf(body: unknown): number {
  const parsed = QuoteRevisionSchema.safeParse(body);
  if (!parsed.success) invalidRequest(parsed.error);
  return parsed.data.expectedRevision;
}

@Controller('sales/quotes')
@UseGuards(AuthGuard, PermissionsGuard)
export class QuotesController {
  constructor(
    @Inject(QuotesService) private readonly quotes: QuotesService,
    @Inject(QuoteDocumentsService) private readonly documents: QuoteDocumentsService,
  ) {}

  @Get()
  @RequirePermission('sales.read')
  async list(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<QuotePage> {
    const parsed = ListQuotesQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.quotes.list(orgId, parsed.data);
  }

  @Post()
  @RequirePermission('sales.quote')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<QuoteView> {
    const parsed = CreateQuoteSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.quotes.create(orgId, parsed.data, actorOf(user, role));
  }

  @Get(':quoteId')
  @RequirePermission('sales.read')
  async get(@CurrentOrgId() orgId: string, @Param('quoteId') quoteId: string): Promise<QuoteView> {
    return this.quotes.view(orgId, quoteId);
  }

  @Put(':quoteId')
  @RequirePermission('sales.quote')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('quoteId') quoteId: string,
    @Body() body: unknown,
  ): Promise<QuoteView> {
    const parsed = PutQuoteSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.quotes.put(
      orgId,
      quoteId,
      parsed.data.expectedRevision,
      parsed.data.quote,
      actorOf(user, role),
    );
  }

  @Delete(':quoteId')
  @HttpCode(204)
  @RequirePermission('sales.quote')
  async remove(@CurrentOrgId() orgId: string, @Param('quoteId') quoteId: string): Promise<void> {
    await this.quotes.remove(orgId, quoteId);
  }

  @Post(':quoteId/send')
  @HttpCode(200)
  @RequirePermission('sales.quote')
  async send(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('quoteId') quoteId: string,
    @Body() body: unknown,
  ): Promise<QuoteView> {
    return this.quotes.send(orgId, quoteId, revisionOf(body), actorOf(user, role));
  }

  @Post(':quoteId/accept')
  @HttpCode(200)
  @RequirePermission('sales.quote')
  async accept(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('quoteId') quoteId: string,
    @Body() body: unknown,
  ): Promise<QuoteView> {
    return this.quotes.accept(orgId, quoteId, revisionOf(body), actorOf(user, role));
  }

  @Post(':quoteId/refuse')
  @HttpCode(200)
  @RequirePermission('sales.quote')
  async refuse(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('quoteId') quoteId: string,
    @Body() body: unknown,
  ): Promise<QuoteView> {
    const parsed = RefuseQuoteSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.quotes.refuse(
      orgId,
      quoteId,
      parsed.data.expectedRevision,
      parsed.data.reason,
      actorOf(user, role),
    );
  }

  @Post(':quoteId/new-version')
  @HttpCode(200)
  @RequirePermission('sales.quote')
  async newVersion(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('quoteId') quoteId: string,
    @Body() body: unknown,
  ): Promise<QuoteView> {
    return this.quotes.newVersion(orgId, quoteId, revisionOf(body), actorOf(user, role));
  }

  @Post(':quoteId/convert')
  @HttpCode(200)
  @RequirePermission('sales.quote', 'sales.manage')
  async convert(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('quoteId') quoteId: string,
    @Body() body: unknown,
  ): Promise<QuoteConversionResult> {
    return this.quotes.convert(orgId, quoteId, revisionOf(body), actorOf(user, role));
  }

  @Get(':quoteId/pdf')
  @RequirePermission('sales.read')
  async pdf(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('quoteId') quoteId: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const doc = await this.documents.pdf(orgId, quoteId, actorOf(user, role));
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${doc.fileName}"`);
    res.setHeader('content-length', String(doc.pdf.byteLength));
    res.setHeader('cache-control', 'no-store');
    res.end(doc.pdf);
  }

  @Get(':quoteId/email')
  @RequirePermission('sales.quote')
  async emailDraft(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('quoteId') quoteId: string,
  ): Promise<DocumentEmailDraft> {
    return this.documents.emailDraft(orgId, quoteId, actorOf(user, role).name);
  }

  @Post(':quoteId/email')
  @HttpCode(200)
  @RequirePermission('sales.quote')
  @UseGuards(UserDocumentEmailThrottlerGuard, OrgDocumentEmailThrottlerGuard)
  async email(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('quoteId') quoteId: string,
    @Body() body: unknown,
  ): Promise<DocumentEmailResult> {
    const input = documentEmailInputOf(body);
    return this.documents.email(orgId, quoteId, senderOf(user, role), input);
  }
}
