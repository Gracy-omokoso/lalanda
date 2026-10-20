// Journal électronique des documents de vente — ADR-0023 § S25e.12, § S25e.14.
// Lecture seule (`sales.read`), restitué avec `chainValid`.
//
// Export pour les vérificateurs (ADR-0026 § 6.3) : `GET /sales/journal/export`,
// en `fiscal.manage` (Propriétaire, Directeur financier ; interdite à la
// plateforme). Un export est une extraction EN MASSE de toutes les ventes et de
// tous les clients d'une période : c'est un acte du contribuable envers
// l'administration, pas une consultation. La consultation page par page reste
// en `sales.read`.

import { Controller, Get, Inject, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { invalidRequest } from '../sales.errors.js';
import { InvoiceJournalService } from './invoice-journal.service.js';
import type { JournalPage } from './invoice.contract.js';
import { JournalExportQuerySchema, ListJournalQuerySchema } from './invoices.dto.js';
import { JournalExportService } from './journal-export.service.js';

type User = { id: string; email: string; name?: string | null };

@Controller('sales/journal')
@UseGuards(AuthGuard, PermissionsGuard)
export class JournalController {
  constructor(
    @Inject(InvoiceJournalService) private readonly journal: InvoiceJournalService,
    @Inject(JournalExportService) private readonly exports: JournalExportService,
  ) {}

  @Get()
  @RequirePermission('sales.read')
  async list(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<JournalPage> {
    const parsed = ListJournalQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.journal.list(orgId, parsed.data);
  }

  @Get('export')
  @RequirePermission('fiscal.manage')
  async export(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Query() query: unknown,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const parsed = JournalExportQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres d’export invalides.');
    const name = user.name?.trim();
    const file = await this.exports.file(orgId, parsed.data, {
      userId: user.id,
      name: name ? name : user.email,
      role: role ?? 'unknown',
    });
    const body = Buffer.from(file.body, 'utf8');
    res.setHeader('content-type', file.contentType);
    res.setHeader('content-disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('content-length', String(body.byteLength));
    res.setHeader('cache-control', 'no-store');
    res.end(body);
  }
}
