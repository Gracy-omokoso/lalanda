// Catalogue d'articles — ADR-0022 § S25c.5.
//
// `sales.read` pour lire, `sales.manage` pour écrire (§ S25c.1). Un article
// d'une autre organisation répond 404. Prix et taxe spécifique sont des
// chaînes décimales dans les deux sens.

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
  CatalogItemsService,
  type CatalogItemPage,
  type CatalogItemView,
} from './catalog-items.service.js';
import type { SalesActor } from './customers.service.js';
import {
  CreateCatalogItemSchema,
  ListCatalogItemsQuerySchema,
  PutCatalogItemSchema,
} from './sales.dto.js';
import { invalidRequest } from './sales.errors.js';

function actorOf(user: { id: string }, role: OrgRole | undefined): SalesActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

@Controller('sales/catalog-items')
@UseGuards(AuthGuard, PermissionsGuard)
export class CatalogItemsController {
  constructor(@Inject(CatalogItemsService) private readonly items: CatalogItemsService) {}

  @Get()
  @RequirePermission('sales.read')
  async list(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<CatalogItemPage> {
    const parsed = ListCatalogItemsQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.items.list(orgId, parsed.data);
  }

  @Post()
  @RequirePermission('sales.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<CatalogItemView> {
    const parsed = CreateCatalogItemSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.items.create(orgId, parsed.data, actorOf(user, role));
  }

  @Get(':itemId')
  @RequirePermission('sales.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('itemId') itemId: string,
  ): Promise<CatalogItemView> {
    return this.items.get(orgId, itemId);
  }

  @Put(':itemId')
  @RequirePermission('sales.manage')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ): Promise<CatalogItemView> {
    const parsed = PutCatalogItemSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.items.put(
      orgId,
      itemId,
      parsed.data.expectedRevision,
      parsed.data.item,
      actorOf(user, role),
    );
  }

  @Post(':itemId/deactivate')
  @HttpCode(200)
  @RequirePermission('sales.manage')
  async deactivate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('itemId') itemId: string,
  ): Promise<CatalogItemView> {
    return this.items.setActive(orgId, itemId, false, actorOf(user, role));
  }

  @Post(':itemId/reactivate')
  @HttpCode(200)
  @RequirePermission('sales.manage')
  async reactivate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('itemId') itemId: string,
  ): Promise<CatalogItemView> {
    return this.items.setActive(orgId, itemId, true, actorOf(user, role));
  }

  @Delete(':itemId')
  @HttpCode(204)
  @RequirePermission('sales.manage')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('itemId') itemId: string,
  ): Promise<void> {
    await this.items.remove(orgId, itemId, actorOf(user, role));
  }
}
