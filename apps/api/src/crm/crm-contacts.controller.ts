// Contacts et prospects — ADR-0035 § 4.
//
// `crm.read` pour lire ; `crm.manage` pour écrire, importer et exporter
// (extraction en masse de données personnelles : réservée à qui tient le
// fichier, et journalisée). Un contact d'une autre organisation répond 404.

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

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import type { OrgRole } from '../authz/permissions.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { ContactsService, type ContactPage, type ContactView } from './contacts.service.js';
import { crmActorOf, sendCsv } from './crm-actor.js';
import { CrmCsvService, type ImportResult } from './crm-csv.service.js';
import {
  CreateContactSchema,
  CsvImportSchema,
  ListContactsQuerySchema,
  PutContactSchema,
} from './crm.dto.js';

type User = { id: string };

@Controller('crm/contacts')
@UseGuards(AuthGuard, PermissionsGuard)
export class CrmContactsController {
  constructor(
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(CrmCsvService) private readonly csv: CrmCsvService,
  ) {}

  @Get()
  @RequirePermission('crm.read')
  async list(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<ContactPage> {
    const parsed = ListContactsQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.contacts.list(orgId, parsed.data);
  }

  @Get('export')
  @RequirePermission('crm.manage')
  async export(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    sendCsv(res, await this.csv.exportContacts(orgId, crmActorOf(user, role)));
  }

  @Post('import')
  @HttpCode(200)
  @RequirePermission('crm.manage')
  async import(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<ImportResult> {
    const parsed = CsvImportSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.csv.importContacts(
      orgId,
      parsed.data.csv,
      parsed.data.dryRun,
      crmActorOf(user, role),
    );
  }

  @Post()
  @RequirePermission('crm.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<ContactView> {
    const parsed = CreateContactSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.contacts.create(orgId, parsed.data, crmActorOf(user, role));
  }

  @Get(':contactId')
  @RequirePermission('crm.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('contactId') contactId: string,
  ): Promise<ContactView> {
    return this.contacts.get(orgId, contactId);
  }

  @Put(':contactId')
  @RequirePermission('crm.manage')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contactId') contactId: string,
    @Body() body: unknown,
  ): Promise<ContactView> {
    const parsed = PutContactSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.contacts.put(
      orgId,
      contactId,
      parsed.data.expectedRevision,
      parsed.data.contact,
      crmActorOf(user, role),
    );
  }

  @Delete(':contactId')
  @HttpCode(204)
  @RequirePermission('crm.manage')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contactId') contactId: string,
  ): Promise<void> {
    await this.contacts.remove(orgId, contactId, crmActorOf(user, role));
  }
}
