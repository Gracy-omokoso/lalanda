// Fichier clients — ADR-0022 § S25c.5.
//
// `sales.read` pour lire, `sales.manage` pour écrire (§ S25c.1). Organisation
// active seulement : aucun identifiant d'organisation n'est accepté dans l'URL
// ou le corps. Un client d'une autre organisation répond 404.

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

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import type { OrgRole } from '../authz/permissions.js';
import {
  CustomersService,
  type CustomerPage,
  type CustomerView,
  type SalesActor,
} from './customers.service.js';
import { CreateCustomerSchema, ListCustomersQuerySchema, PutCustomerSchema } from './sales.dto.js';
import { invalidRequest } from './sales.errors.js';

function actorOf(user: { id: string }, role: OrgRole | undefined): SalesActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

@Controller('sales/customers')
@UseGuards(AuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(@Inject(CustomersService) private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('sales.read')
  async list(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<CustomerPage> {
    const parsed = ListCustomersQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.customers.list(orgId, parsed.data);
  }

  @Post()
  @RequirePermission('sales.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<CustomerView> {
    const parsed = CreateCustomerSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.customers.create(orgId, parsed.data, actorOf(user, role));
  }

  @Get(':customerId')
  @RequirePermission('sales.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('customerId') customerId: string,
  ): Promise<CustomerView> {
    return this.customers.get(orgId, customerId);
  }

  @Put(':customerId')
  @RequirePermission('sales.manage')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('customerId') customerId: string,
    @Body() body: unknown,
  ): Promise<CustomerView> {
    const parsed = PutCustomerSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.customers.put(
      orgId,
      customerId,
      parsed.data.expectedRevision,
      parsed.data.customer,
      actorOf(user, role),
    );
  }

  @Post(':customerId/deactivate')
  @HttpCode(200)
  @RequirePermission('sales.manage')
  async deactivate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('customerId') customerId: string,
  ): Promise<CustomerView> {
    return this.customers.setActive(orgId, customerId, false, actorOf(user, role));
  }

  @Post(':customerId/reactivate')
  @HttpCode(200)
  @RequirePermission('sales.manage')
  async reactivate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('customerId') customerId: string,
  ): Promise<CustomerView> {
    return this.customers.setActive(orgId, customerId, true, actorOf(user, role));
  }

  @Delete(':customerId')
  @HttpCode(204)
  @RequirePermission('sales.manage')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('customerId') customerId: string,
  ): Promise<void> {
    await this.customers.remove(orgId, customerId, actorOf(user, role));
  }
}
