// Dettes et paiements fournisseurs — ADR-0044 § 3.6. ADR-0044 — P5.
//
//   GET  /purchases/payables?asOf=&supplierId=        purchase.read — échéancier par devise
//   GET  /purchases/payments?supplierId=&from=&to=&cursor=
//                                                     purchase.read + treasury.read
//   GET  /purchases/payments/:id                      purchase.read + treasury.read
//   POST /purchases/payments                          payables.pay — crée les dépenses
//   POST /purchases/payments/from-expense             payables.pay + treasury.manage
//   POST /purchases/payments/:id/cancel { reason }    payables.pay — annule ses dépenses
//   GET  /purchases/duplicates?supplierId=            purchase.read + treasury.read
//
// Un paiement d'une autre organisation répond 404. Le nombre de doublons de
// l'échéancier n'est servi qu'à qui détient AUSSI `treasury.read` (droits EFFECTIFS).

import {
  CancelSupplierPaymentBody,
  CreateSupplierPaymentBody,
  ListSupplierPaymentsQuery,
  PayablesQuery,
  PurchaseDuplicatesQuery,
  SupplierPaymentFromExpenseBody,
  type PayablesView,
  type PurchaseDuplicatesView,
  type SupplierPaymentPage,
  type SupplierPaymentView,
} from '@lalanda/shared/purchases';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

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
import { parseBody, type PurchaseActor } from '../invoices/purchase-p4.common.js';
import { SupplierPaymentsService } from './supplier-payments.service.js';

type User = { id: string };

function actorOf(user: User, role: OrgRole | undefined): PurchaseActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

@Controller('purchases')
@UseGuards(AuthGuard, PermissionsGuard)
export class SupplierPaymentsController {
  constructor(
    @Inject(SupplierPaymentsService) private readonly payments: SupplierPaymentsService,
  ) {}

  @Get('payables')
  @RequirePermission('purchase.read')
  async payables(
    @CurrentOrgId() orgId: string,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
  ): Promise<PayablesView> {
    const parsed = PayablesQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de l’échéancier invalides.');
    // Droits effectifs ; sans eux (accès délégué), moindre privilège : rien de plus.
    const withDuplicates = perms ? can(perms.role, 'treasury.read', perms.context) : false;
    return this.payments.payables(orgId, parsed.data, { withDuplicates });
  }

  @Get('duplicates')
  @RequirePermission('purchase.read', 'treasury.read')
  async duplicates(
    @CurrentOrgId() orgId: string,
    @Query() query: unknown,
  ): Promise<PurchaseDuplicatesView> {
    const parsed = PurchaseDuplicatesQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    return this.payments.duplicates(orgId, parsed.data);
  }

  @Get('payments')
  @RequirePermission('purchase.read', 'treasury.read')
  async list(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<SupplierPaymentPage> {
    const parsed = ListSupplierPaymentsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.payments.list(orgId, parsed.data);
  }

  @Post('payments')
  @RequirePermission('payables.pay')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<SupplierPaymentView> {
    const input = parseBody(CreateSupplierPaymentBody, body);
    return this.payments.create(orgId, input, actorOf(user, role));
  }

  // Déclarée AVANT `:paymentId` : sinon « from-expense » serait lu comme un identifiant.
  @Post('payments/from-expense')
  @RequirePermission('payables.pay', 'treasury.manage')
  async fromExpense(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<SupplierPaymentView> {
    const input = parseBody(SupplierPaymentFromExpenseBody, body);
    return this.payments.fromExpense(orgId, input, actorOf(user, role));
  }

  @Get('payments/:paymentId')
  @RequirePermission('purchase.read', 'treasury.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('paymentId') paymentId: string,
  ): Promise<SupplierPaymentView> {
    return this.payments.get(orgId, paymentId);
  }

  @Post('payments/:paymentId/cancel')
  @HttpCode(200)
  @RequirePermission('payables.pay')
  async cancel(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('paymentId') paymentId: string,
    @Body() body: unknown,
  ): Promise<SupplierPaymentView> {
    const input = parseBody(CancelSupplierPaymentBody, body);
    return this.payments.cancel(
      orgId,
      paymentId,
      input.reason,
      input.expectedRevision,
      actorOf(user, role),
    );
  }
}
