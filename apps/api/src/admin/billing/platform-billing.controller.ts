// ─────────────────────────────────────────────────────────────────────────────
// ROUTES `/admin/billing/**` (ADR-0053 § 6.2, § 7 — lot P3)
//
// Remplacent `/payments/manual/*` et `/payments/maintenance/sweep` (désormais `410`),
// derrière la garde de CONSOLE : `PlatformAuthGuard` (aucune organisation résolue) puis
// `PermissionsGuard`, qui juge l'action plateforme de chaque route contre la matrice du
// § 5.2. Toute écriture motivée exige la ré-authentification de dix minutes (§ 2.4).
//
// Écart de matrice assumé (décision ouverte n° 7, défaut appliqué) : `platform_admin`
// ne confirme plus un dépôt manuel (`platform.billing.confirm` : finance et
// super-administrateur seuls) ; `platform_billing` ouvre enfin la console.
// ─────────────────────────────────────────────────────────────────────────────

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  ApprovePlanGrantInputSchema,
  ConsoleConfirmManualPaymentInputSchema,
  ConsoleRejectManualPaymentInputSchema,
  PlanGrantInputSchema,
  RevokePlanGrantInputSchema,
} from '@lalanda/shared/platform';

import type { AuthenticatedRequest } from '../../auth/auth.guard.js';
import { PlatformConsoleRoute, RequirePlatformAction } from '../../authz/authz.decorators.js';
import { AuthzService } from '../../authz/authz.service.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { PlatformAuthGuard } from '../../authz/platform-auth.guard.js';
import { RequireRecentReauth } from '../../integrations/reauth.guard.js';
import type { AdminActor } from '../admin.service.js';
import { invalidBody } from '../admin.dto.js';
import {
  PlatformBillingService,
  type AdminManualPaymentView,
  type AdminPlanGrantView,
  type AdminSubscriptionView,
} from './platform-billing.service.js';

@Controller('admin/billing')
@UseGuards(PlatformAuthGuard, PermissionsGuard)
@PlatformConsoleRoute()
@RequirePlatformAction('platform.billing.read')
export class PlatformBillingController {
  constructor(
    @Inject(PlatformBillingService) private readonly billing: PlatformBillingService,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  /** Acteur du journal plateforme : rôles RELUS, jamais déduits de la route (F3). */
  private async actorOf(req: AuthenticatedRequest): Promise<AdminActor> {
    const roles = await this.authz.platformRolesOf(req.user!.id);
    return { userId: req.user!.id, platformRole: roles.join(',') || 'aucun' };
  }

  // ── Lecture ────────────────────────────────────────────────────────────────

  @Get('subscriptions')
  @RequirePlatformAction('platform.billing.read')
  async subscriptions(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<{ subscriptions: AdminSubscriptionView[] }> {
    return {
      subscriptions: await this.billing.listSubscriptions({ status, limit: toInt(limit) }),
    };
  }

  @Get('manual-payments')
  @RequirePlatformAction('platform.billing.read')
  async manualPayments(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<{ requests: AdminManualPaymentView[] }> {
    return { requests: await this.billing.listManualPayments({ status, limit: toInt(limit) }) };
  }

  @Get('grants')
  @RequirePlatformAction('platform.billing.read')
  async grants(
    @Query('organizationId') organizationId?: string,
    @Query('limit') limit?: string,
  ): Promise<{ grants: AdminPlanGrantView[] }> {
    return { grants: await this.billing.listGrants({ organizationId, limit: toInt(limit) }) };
  }

  // ── Paiements manuels ──────────────────────────────────────────────────────

  @Post('manual-payments/:reference/confirm')
  @RequirePlatformAction('platform.billing.confirm')
  @RequireRecentReauth()
  @HttpCode(200)
  async confirm(
    @Req() req: AuthenticatedRequest,
    @Param('reference') reference: string,
    @Body() body: unknown,
  ): Promise<{ confirmed: true; organizationId: string; plan: string }> {
    const parsed = ConsoleConfirmManualPaymentInputSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw invalidBody(parsed.error, 'Note obligatoire : référence de l’opération reçue.');
    }
    return this.billing.confirmManualPayment(reference, parsed.data, await this.actorOf(req));
  }

  @Post('manual-payments/:reference/reject')
  @RequirePlatformAction('platform.billing.confirm')
  @RequireRecentReauth()
  @HttpCode(200)
  async reject(
    @Req() req: AuthenticatedRequest,
    @Param('reference') reference: string,
    @Body() body: unknown,
  ): Promise<{ rejected: true; organizationId: string }> {
    const parsed = ConsoleRejectManualPaymentInputSchema.safeParse(body ?? {});
    if (!parsed.success) throw invalidBody(parsed.error, 'Motif du refus obligatoire.');
    return this.billing.rejectManualPayment(
      reference,
      { note: parsed.data.reason, clientMessage: parsed.data.clientMessage },
      await this.actorOf(req),
    );
  }

  /** Balayage d'exploitation : sans motif ni ré-authentification (§ 7), journalisé. */
  @Post('sweep')
  @RequirePlatformAction('platform.billing.confirm')
  @HttpCode(200)
  async sweep(@Req() req: AuthenticatedRequest): Promise<{ scanned: number; changed: number }> {
    return this.billing.sweep(await this.actorOf(req));
  }

  // ── Octrois manuels ────────────────────────────────────────────────────────

  @Post('grants')
  @RequirePlatformAction('platform.billing.grant')
  @RequireRecentReauth()
  async createGrant(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<AdminPlanGrantView> {
    const parsed = PlanGrantInputSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw invalidBody(parsed.error, 'Organisation, offre, catégorie, message client et note.');
    }
    return this.billing.createGrant(parsed.data, await this.actorOf(req));
  }

  /** Seconde personne (§ 5.3). Écart au § 7, qui ne nomme pas cette route : voir ADR. */
  @Post('grants/:id/approve')
  @RequirePlatformAction('platform.billing.grant')
  @RequireRecentReauth()
  @HttpCode(200)
  async approveGrant(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminPlanGrantView> {
    const parsed = ApprovePlanGrantInputSchema.safeParse(body ?? {});
    if (!parsed.success) throw invalidBody(parsed.error, 'Note interne trop longue.');
    return this.billing.approveGrant(id, parsed.data, await this.actorOf(req));
  }

  @Delete('grants/:id')
  @RequirePlatformAction('platform.billing.grant')
  @RequireRecentReauth()
  async revokeGrant(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminPlanGrantView> {
    const parsed = RevokePlanGrantInputSchema.safeParse(body ?? {});
    if (!parsed.success) throw invalidBody(parsed.error, 'Motif et message client requis.');
    return this.billing.revokeGrant(id, parsed.data, await this.actorOf(req));
  }
}

function toInt(raw: string | undefined): number | undefined {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? n : undefined;
}
