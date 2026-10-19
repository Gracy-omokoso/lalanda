// Journal électronique des documents de vente — ADR-0023 § S25e.12, § S25e.14.
// Lecture seule (`sales.read`), restitué avec `chainValid`.

import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { invalidRequest } from '../sales.errors.js';
import { InvoiceJournalService } from './invoice-journal.service.js';
import type { JournalPage } from './invoice.contract.js';
import { ListJournalQuerySchema } from './invoices.dto.js';

@Controller('sales/journal')
@UseGuards(AuthGuard, PermissionsGuard)
export class JournalController {
  constructor(@Inject(InvoiceJournalService) private readonly journal: InvoiceJournalService) {}

  @Get()
  @RequirePermission('sales.read')
  async list(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<JournalPage> {
    const parsed = ListJournalQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.journal.list(orgId, parsed.data);
  }
}
