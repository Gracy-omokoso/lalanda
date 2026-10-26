// Routes de la normalisation DGI — ADR-0024 § 9.1.
//
// | Route                                                     | Permission      | Ré-auth | Quota               |
// | POST /sales/invoices/:id/normalization/retry              | sales.invoice   |         | normalisation (org + utilisateur) |
// | POST /sales/invoices/:id/normalization/check              | sales.invoice   |         | normalisation (utilisateur) |
// | POST /sales/invoices/:id/normalization/declare-not-normalized | fiscal.manage | oui   | écriture intégration |
// | GET  /sales/invoices/:id/dgi-exchanges                    | sales.read      |         | global              |
//
// Organisation active seulement ; un document d'une autre organisation répond
// 404. Un refus de la DGI n'est pas une erreur HTTP : 200 avec l'état obtenu.

import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { RequireRecentReauth } from '../../integrations/reauth.guard.js';
import {
  OrgNormalizationThrottlerGuard,
  UserNormalizationThrottlerGuard,
} from '../../security/normalization-throttler.guard.js';
import { INTEGRATION_WRITE_THROTTLE } from '../../security/throttling.js';
import { UserThrottlerGuard } from '../../security/user-throttler.guard.js';
import { invalidRequest } from '../sales.errors.js';
import type { DgiExchangePage, InvoiceView } from '../invoices/invoice.contract.js';
import type { InvoiceActor } from '../invoices/invoice.types.js';
import { NormalizationRoutesService } from './normalization-routes.service.js';

type User = { id: string; email: string; name?: string | null };

function actorOf(user: User, role: OrgRole | undefined): InvoiceActor {
  const name = user.name?.trim();
  return { userId: user.id, name: name ? name : user.email, role: role ?? 'unknown' };
}

/** `DeclareNotNormalizedBody` (ADR-0024 § 9.1) : motif de 20 à 500 caractères. */
export const DeclareNotNormalizedSchema = z
  .object({ reason: z.string().trim().min(20).max(500) })
  .strict();

@Controller('sales')
@UseGuards(AuthGuard, PermissionsGuard)
export class NormalizationController {
  constructor(
    @Inject(NormalizationRoutesService) private readonly routes: NormalizationRoutesService,
  ) {}

  @Post('invoices/:invoiceId/normalization/retry')
  @HttpCode(200)
  @RequirePermission('sales.invoice')
  @UseGuards(OrgNormalizationThrottlerGuard, UserNormalizationThrottlerGuard)
  async retry(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('invoiceId') invoiceId: string,
  ): Promise<InvoiceView> {
    return this.routes.retry(orgId, invoiceId, actorOf(user, role));
  }

  @Post('invoices/:invoiceId/normalization/check')
  @HttpCode(200)
  @RequirePermission('sales.invoice')
  @UseGuards(UserNormalizationThrottlerGuard)
  async check(
    @CurrentOrgId() orgId: string,
    @Param('invoiceId') invoiceId: string,
  ): Promise<InvoiceView> {
    return this.routes.check(orgId, invoiceId);
  }

  @Post('invoices/:invoiceId/normalization/declare-not-normalized')
  @HttpCode(200)
  @RequirePermission('fiscal.manage')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: INTEGRATION_WRITE_THROTTLE })
  @RequireRecentReauth()
  async declareNotNormalized(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown,
  ): Promise<InvoiceView> {
    const parsed = DeclareNotNormalizedSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Un motif de 20 à 500 caractères est exigé.');
    return this.routes.declareNotNormalized(
      orgId,
      invoiceId,
      parsed.data.reason,
      actorOf(user, role),
    );
  }

  @Get('invoices/:invoiceId/dgi-exchanges')
  @RequirePermission('sales.read')
  async dgiExchanges(
    @CurrentOrgId() orgId: string,
    @Param('invoiceId') invoiceId: string,
  ): Promise<DgiExchangePage> {
    return this.routes.exchanges(orgId, invoiceId);
  }
}
