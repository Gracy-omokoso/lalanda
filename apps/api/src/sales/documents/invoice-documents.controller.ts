// Documents PDF des factures et avoirs — ADR-0025 § 8.
//
// `GET …/pdf` (`sales.read`) : l'original, reproduit à l'identique ; un pro
// forma pour tout document non final. `POST …/duplicate` (`sales.manage`) : un
// duplicata numéroté d'une facture finale, journalisé. Organisation active
// seulement ; un document d'une autre organisation répond 404.

import { Controller, Get, HttpCode, Inject, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import type { InvoiceActor } from '../invoices/invoice.types.js';
import {
  InvoiceDocumentsService,
  type RenderedInvoiceDocument,
} from './invoice-documents.service.js';

type User = { id: string; email: string; name?: string | null };

function actorOf(user: User, role: OrgRole | undefined): InvoiceActor {
  const name = user.name?.trim();
  return { userId: user.id, name: name ? name : user.email, role: role ?? 'unknown' };
}

function send(res: Response, doc: RenderedInvoiceDocument): void {
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="${doc.fileName}"`);
  res.setHeader('content-length', String(doc.pdf.byteLength));
  res.setHeader('cache-control', 'no-store');
  if (doc.duplicateNumber !== null) {
    res.setHeader('x-duplicate-number', String(doc.duplicateNumber));
  }
  res.end(doc.pdf);
}

@Controller('sales')
@UseGuards(AuthGuard, PermissionsGuard)
export class InvoiceDocumentsController {
  constructor(
    @Inject(InvoiceDocumentsService) private readonly documents: InvoiceDocumentsService,
  ) {}

  @Get('invoices/:invoiceId/pdf')
  @RequirePermission('sales.read')
  async pdf(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('invoiceId') invoiceId: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    send(res, await this.documents.original(orgId, invoiceId, actorOf(user, role)));
  }

  @Post('invoices/:invoiceId/duplicate')
  @HttpCode(200)
  @RequirePermission('sales.manage')
  async duplicate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('invoiceId') invoiceId: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    send(res, await this.documents.duplicate(orgId, invoiceId, actorOf(user, role)));
  }
}
