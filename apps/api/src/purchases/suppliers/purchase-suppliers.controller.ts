// Fournisseurs — ADR-0044 § 3.1. ADR-0044 — P2.
//
//   GET    /purchases/suppliers?q=&active=&cursor=&limit=          purchase.read
//   POST   /purchases/suppliers                                    purchase.manage
//   GET    /purchases/suppliers/migration-report                   purchase.manage
//   GET    /purchases/suppliers/:id                                purchase.read
//   PUT    /purchases/suppliers/:id                                purchase.manage
//   POST   /purchases/suppliers/:id/archive · /restore             purchase.manage
//   DELETE /purchases/suppliers/:id                                purchase.manage
//   POST   /purchases/suppliers/:id/merge                          purchase.manage
//   POST   /purchases/suppliers/:id/payment-methods                purchase.manage
//   PUT    /purchases/suppliers/:id/payment-methods/:methodId      purchase.manage
//   DELETE /purchases/suppliers/:id/payment-methods/:methodId      purchase.manage
//   POST   /purchases/suppliers/:id/payment-methods/:methodId/reveal   payables.pay
//
// Une fiche d'une autre organisation répond 404. Le reste dû par devise n'est
// servi dans la liste que si l'appelant détient AUSSI `treasury.read` (droits
// EFFECTIFS, ADR-0041 § 9.3). `reveal` : audit strict, 30 par heure et par
// utilisateur. La fiche 360° (`GET …/:id/overview`) appartient au lot P6.

import {
  CreateSupplierBody,
  CreateSupplierPaymentMethodBody,
  ListSuppliersQuery,
  MergeSupplierBody,
  SupplierRevisionBody,
  UpdateSupplierBody,
  UpdateSupplierPaymentMethodBody,
  type SupplierMigrationReportView,
  type SupplierPage,
  type SupplierPaymentMethodRevealView,
  type SupplierView,
  type SupplierWriteResult,
} from '@lalanda/shared/purchases';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../../authz/current-org-permissions.decorator.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { can, type OrgRole } from '../../authz/permissions.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { UserThrottlerGuard } from '../../security/user-throttler.guard.js';
import {
  SuppliersService,
  type SupplierActor,
  type SupplierMergeResult,
} from './suppliers.service.js';

type User = { id: string };

/** Débit de `reveal` (§ 2.1.1) : 30 lectures en clair par heure et par utilisateur. */
export const SUPPLIER_REVEAL_THROTTLE = { ttl: 3_600_000, limit: 30 } as const;

function actorOf(user: User, role: OrgRole | undefined): SupplierActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

@Controller('purchases/suppliers')
@UseGuards(AuthGuard, PermissionsGuard)
export class PurchaseSuppliersController {
  constructor(@Inject(SuppliersService) private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermission('purchase.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
  ): Promise<SupplierPage> {
    const parsed = ListSuppliersQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    // Droits effectifs ; sans eux (accès délégué), moindre privilège : pas de montant.
    const withRemaining = perms ? can(perms.role, 'treasury.read', perms.context) : false;
    return this.suppliers.list(orgId, parsed.data, { withRemaining });
  }

  @Post()
  @RequirePermission('purchase.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<SupplierWriteResult> {
    const parsed = CreateSupplierBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.suppliers.create(orgId, parsed.data, actorOf(user, role));
  }

  // Déclarée AVANT `:supplierId` : sinon « migration-report » serait lu comme un identifiant.
  @Get('migration-report')
  @RequirePermission('purchase.manage')
  async migrationReport(
    @CurrentOrgId() orgId: string,
  ): Promise<SupplierMigrationReportView & { id: string; ranAt: string }> {
    const report = await this.suppliers.migrationReport(orgId);
    if (!report) {
      throw new NotFoundException({
        code: 'SUPPLIER_MIGRATION_REPORT_NOT_FOUND',
        message: 'Aucun rapport de migration des fournisseurs pour cette organisation.',
      });
    }
    return report;
  }

  @Get(':supplierId')
  @RequirePermission('purchase.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('supplierId') supplierId: string,
  ): Promise<SupplierView> {
    return this.suppliers.get(orgId, supplierId);
  }

  @Put(':supplierId')
  @RequirePermission('purchase.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('supplierId') supplierId: string,
    @Body() body: unknown,
  ): Promise<SupplierWriteResult> {
    const parsed = UpdateSupplierBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.suppliers.update(orgId, supplierId, parsed.data, actorOf(user, role));
  }

  @Post(':supplierId/archive')
  @HttpCode(200)
  @RequirePermission('purchase.manage')
  async archive(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('supplierId') supplierId: string,
    @Body() body: unknown,
  ): Promise<SupplierView> {
    const parsed = SupplierRevisionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.suppliers.setActive(
      orgId,
      supplierId,
      false,
      parsed.data.expectedRevision,
      actorOf(user, role),
    );
  }

  @Post(':supplierId/restore')
  @HttpCode(200)
  @RequirePermission('purchase.manage')
  async restore(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('supplierId') supplierId: string,
    @Body() body: unknown,
  ): Promise<SupplierView> {
    const parsed = SupplierRevisionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.suppliers.setActive(
      orgId,
      supplierId,
      true,
      parsed.data.expectedRevision,
      actorOf(user, role),
    );
  }

  @Delete(':supplierId')
  @HttpCode(204)
  @RequirePermission('purchase.manage')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('supplierId') supplierId: string,
  ): Promise<void> {
    await this.suppliers.remove(orgId, supplierId, actorOf(user, role));
  }

  @Post(':supplierId/merge')
  @HttpCode(200)
  @RequirePermission('purchase.manage')
  async merge(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('supplierId') supplierId: string,
    @Body() body: unknown,
  ): Promise<SupplierMergeResult> {
    const parsed = MergeSupplierBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.suppliers.merge(
      orgId,
      supplierId,
      parsed.data.targetSupplierId,
      parsed.data.expectedRevision,
      actorOf(user, role),
    );
  }

  @Post(':supplierId/payment-methods')
  @RequirePermission('purchase.manage')
  async addPaymentMethod(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('supplierId') supplierId: string,
    @Body() body: unknown,
  ): Promise<SupplierWriteResult> {
    const parsed = CreateSupplierPaymentMethodBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.suppliers.addPaymentMethod(orgId, supplierId, parsed.data, actorOf(user, role));
  }

  @Put(':supplierId/payment-methods/:methodId')
  @RequirePermission('purchase.manage')
  async updatePaymentMethod(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('supplierId') supplierId: string,
    @Param('methodId') methodId: string,
    @Body() body: unknown,
  ): Promise<SupplierWriteResult> {
    const parsed = UpdateSupplierPaymentMethodBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.suppliers.updatePaymentMethod(
      orgId,
      supplierId,
      methodId,
      parsed.data,
      actorOf(user, role),
    );
  }

  @Delete(':supplierId/payment-methods/:methodId')
  @HttpCode(200)
  @RequirePermission('purchase.manage')
  async removePaymentMethod(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('supplierId') supplierId: string,
    @Param('methodId') methodId: string,
    @Body() body: unknown,
  ): Promise<SupplierWriteResult> {
    const parsed = SupplierRevisionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.suppliers.removePaymentMethod(
      orgId,
      supplierId,
      methodId,
      parsed.data.expectedRevision,
      actorOf(user, role),
    );
  }

  @Post(':supplierId/payment-methods/:methodId/reveal')
  @HttpCode(200)
  @RequirePermission('payables.pay')
  @Throttle({ default: SUPPLIER_REVEAL_THROTTLE })
  @UseGuards(UserThrottlerGuard)
  async reveal(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('supplierId') supplierId: string,
    @Param('methodId') methodId: string,
  ): Promise<SupplierPaymentMethodRevealView> {
    return this.suppliers.reveal(orgId, supplierId, methodId, actorOf(user, role));
  }
}
