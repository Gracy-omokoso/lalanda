// Documents de vente — ADR-0023 § S25e.14.
//
// `sales.read` pour lire, `sales.manage` pour les brouillons, les avoirs en
// brouillon et la reprise en brouillon, `sales.invoice` pour émettre et
// normaliser (engage le contribuable ; interdite à la plateforme). Organisation
// active seulement ; un document d'une autre organisation répond 404.
//
// La liste des points de vente proposables (`GET /sales/points-of-sale`,
// ADR-0026 écart C6) est en `sales.read` : elle ne montre ni jeton ni état
// technique (la gestion des points de vente reste en `fiscal.manage`).

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
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import {
  OrgNormalizationThrottlerGuard,
  UserNormalizationThrottlerGuard,
} from '../../security/normalization-throttler.guard.js';
import { invalidRequest } from '../sales.errors.js';
import { CreditNotesService } from './credit-notes.service.js';
import { ExchangeRateReferenceService } from './exchange-rate-reference.service.js';
import { InvoiceDraftsService } from './invoice-drafts.service.js';
import { InvoiceFreezingService } from './invoice-freezing.service.js';
import type {
  ExchangeRateReference,
  InvoicePage,
  InvoiceView,
  SelectablePointsOfSale,
} from './invoice.contract.js';
import type { InvoiceActor } from './invoice.types.js';
import {
  BackToDraftSchema,
  CreateCreditNoteSchema,
  CreateInvoiceSchema,
  IssueInvoiceSchema,
  ListInvoicesQuerySchema,
  NormalizeInvoiceSchema,
  PutInvoiceSchema,
} from './invoices.dto.js';

type User = { id: string; email: string; name?: string | null };

function actorOf(user: User, role: OrgRole | undefined): InvoiceActor {
  const name = user.name?.trim();
  return { userId: user.id, name: name ? name : user.email, role: role ?? 'unknown' };
}

@Controller('sales')
@UseGuards(AuthGuard, PermissionsGuard)
export class InvoicesController {
  constructor(
    @Inject(InvoiceDraftsService) private readonly drafts: InvoiceDraftsService,
    @Inject(InvoiceFreezingService) private readonly freezing: InvoiceFreezingService,
    @Inject(CreditNotesService) private readonly creditNotes: CreditNotesService,
    @Inject(ExchangeRateReferenceService) private readonly exchange: ExchangeRateReferenceService,
  ) {}

  @Get('invoices')
  @RequirePermission('sales.read')
  async list(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<InvoicePage> {
    const parsed = ListInvoicesQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.drafts.list(orgId, parsed.data);
  }

  @Post('invoices')
  @RequirePermission('sales.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<InvoiceView> {
    const parsed = CreateInvoiceSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.drafts.create(orgId, parsed.data, actorOf(user, role));
  }

  @Get('invoices/:invoiceId')
  @RequirePermission('sales.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('invoiceId') invoiceId: string,
  ): Promise<InvoiceView> {
    return this.drafts.view(orgId, invoiceId);
  }

  @Put('invoices/:invoiceId')
  @RequirePermission('sales.manage')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown,
  ): Promise<InvoiceView> {
    const parsed = PutInvoiceSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.drafts.put(
      orgId,
      invoiceId,
      parsed.data.expectedRevision,
      parsed.data.draft,
      actorOf(user, role),
    );
  }

  @Delete('invoices/:invoiceId')
  @HttpCode(204)
  @RequirePermission('sales.manage')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('invoiceId') invoiceId: string,
  ): Promise<void> {
    await this.drafts.remove(orgId, invoiceId, actorOf(user, role));
  }

  @Post('invoices/:invoiceId/credit-notes')
  @RequirePermission('sales.manage')
  async createCreditNote(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown,
  ): Promise<InvoiceView> {
    const parsed = CreateCreditNoteSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.creditNotes.createFromOrigin(orgId, invoiceId, parsed.data, actorOf(user, role));
  }

  @Post('invoices/:invoiceId/issue')
  @HttpCode(200)
  @RequirePermission('sales.invoice')
  async issue(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown,
  ): Promise<InvoiceView> {
    const parsed = IssueInvoiceSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.freezing.issue(orgId, invoiceId, parsed.data.expectedRevision, actorOf(user, role));
  }

  @Post('invoices/:invoiceId/normalize')
  @HttpCode(200)
  @RequirePermission('sales.invoice')
  // ADR-0024 § 6 : 60 envois par heure et par organisation (seau commun avec
  // `normalization/retry`) et 60 par heure et par utilisateur ; 429 en français.
  @UseGuards(OrgNormalizationThrottlerGuard, UserNormalizationThrottlerGuard)
  async normalize(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown,
  ): Promise<InvoiceView> {
    const parsed = NormalizeInvoiceSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.freezing.normalize(
      orgId,
      invoiceId,
      parsed.data.expectedRevision,
      parsed.data.exchangeRate,
      actorOf(user, role),
    );
  }

  @Post('invoices/:invoiceId/back-to-draft')
  @HttpCode(200)
  @RequirePermission('sales.manage')
  async backToDraft(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown,
  ): Promise<InvoiceView> {
    const parsed = BackToDraftSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.freezing.backToDraft(
      orgId,
      invoiceId,
      parsed.data.expectedRevision,
      actorOf(user, role),
    );
  }

  /** ADR-0026, écart C6 : points de vente proposables dans l'éditeur. */
  @Get('points-of-sale')
  @RequirePermission('sales.read')
  async pointsOfSale(@CurrentOrgId() orgId: string): Promise<SelectablePointsOfSale> {
    return this.drafts.selectablePointsOfSale(orgId);
  }

  @Get('exchange-rate-reference')
  @RequirePermission('sales.read')
  async exchangeRateReference(@CurrentOrgId() orgId: string): Promise<ExchangeRateReference> {
    return this.exchange.view(orgId);
  }
}
