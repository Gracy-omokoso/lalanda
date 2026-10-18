// Facture normalisée et points de vente e-MCF — ADR-0021 §3, §4.1 et §10.
//
// Toutes les routes : `fiscal.manage`, organisation active. Un point de vente
// d'une autre organisation répond 404 `POINT_OF_SALE_NOT_FOUND`, jamais 403.
//
// Ré-authentification (ADR-0021 §8) : les écritures sensibles — jeton,
// activation, désactivation, environnement, retrait — exigent une fenêtre de
// moins de 10 minutes liée à la session (même mécanisme qu'ADR-0013 §5), posée
// par `@RequireRecentReauth()`. Le garde passe AVANT la validation du corps :
// sans fenêtre, `401 REAUTH_REQUIRED` avant tout 400. L'interface lit alors
// `GET /me/reauth` (mot de passe ou reconnexion Google) et rejoue une fois.
//
// Quotas : « écriture intégration » (10/h/utilisateur) sur les écritures
// sensibles, « test DGI » (30/h/utilisateur) sur ce qui sollicite la DGI sans
// rien écrire de sensible.

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { CurrentOrgId } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { RequireRecentReauth } from '../integrations/reauth.guard.js';
import { EDEF_TEST_THROTTLE, INTEGRATION_WRITE_THROTTLE } from '../security/throttling.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import type { FiscalActor } from './fiscal-profile.service.js';
import {
  ActivateSchema,
  ChangeEnvironmentSchema,
  CreatePointOfSaleSchema,
  DeactivateSchema,
  DisablePointOfSaleSchema,
  PatchPointOfSaleSchema,
  ReplaceTokenSchema,
} from './fiscal.dto.js';
import { invalidRequest } from './fiscal.errors.js';
import {
  NormalizedInvoicingService,
  type NormalizedInvoicingView,
} from './normalized-invoicing.service.js';
import { PointsOfSaleService, type PointOfSaleView } from './points-of-sale.service.js';
import { ReferenceDataService, type ReferenceDataView } from './reference-data.service.js';

@Controller('organizations/current/normalized-invoicing')
@UseGuards(AuthGuard, PermissionsGuard)
export class NormalizedInvoicingController {
  constructor(
    @Inject(NormalizedInvoicingService) private readonly invoicing: NormalizedInvoicingService,
    @Inject(PointsOfSaleService) private readonly pointsOfSale: PointsOfSaleService,
    @Inject(ReferenceDataService) private readonly referenceData: ReferenceDataService,
  ) {}

  @Get()
  @RequirePermission('fiscal.manage')
  async get(@CurrentOrgId() orgId: string): Promise<NormalizedInvoicingView> {
    return this.invoicing.view(orgId);
  }

  @Post('activate')
  @HttpCode(200)
  @RequirePermission('fiscal.manage')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: INTEGRATION_WRITE_THROTTLE })
  @RequireRecentReauth()
  async activate(
    @Req() req: AuthenticatedRequest,
    @CurrentOrgId() orgId: string,
    @Body() body: unknown,
  ): Promise<NormalizedInvoicingView> {
    const parsed = ActivateSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.invoicing.activate(orgId, parsed.data.environment, actorOf(req));
  }

  @Post('deactivate')
  @HttpCode(200)
  @RequirePermission('fiscal.manage')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: INTEGRATION_WRITE_THROTTLE })
  @RequireRecentReauth()
  async deactivate(
    @Req() req: AuthenticatedRequest,
    @CurrentOrgId() orgId: string,
    @Body() body: unknown,
  ): Promise<NormalizedInvoicingView> {
    const parsed = DeactivateSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Un motif de 20 à 500 caractères est exigé.');
    return this.invoicing.deactivate(orgId, parsed.data.reason, {
      ...actorOf(req),
      name: req.user?.name ?? null,
    });
  }

  @Post('environment')
  @HttpCode(200)
  @RequirePermission('fiscal.manage')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: INTEGRATION_WRITE_THROTTLE })
  @RequireRecentReauth()
  async environment(
    @Req() req: AuthenticatedRequest,
    @CurrentOrgId() orgId: string,
    @Body() body: unknown,
  ): Promise<NormalizedInvoicingView> {
    const parsed = ChangeEnvironmentSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.invoicing.changeEnvironment(
      orgId,
      parsed.data.environment,
      parsed.data.reason ?? null,
      actorOf(req),
    );
  }

  @Post('points-of-sale')
  @RequirePermission('fiscal.manage')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: INTEGRATION_WRITE_THROTTLE })
  @RequireRecentReauth()
  async createPointOfSale(
    @Req() req: AuthenticatedRequest,
    @CurrentOrgId() orgId: string,
    @Body() body: unknown,
  ): Promise<PointOfSaleView> {
    const parsed = CreatePointOfSaleSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.pointsOfSale.create(
      orgId,
      {
        label: parsed.data.label,
        environment: parsed.data.environment,
        expectedNim: parsed.data.expectedNim ?? null,
        token: parsed.data.token,
      },
      actorOf(req),
    );
  }

  @Patch('points-of-sale/:posId')
  @RequirePermission('fiscal.manage')
  async patchPointOfSale(
    @Req() req: AuthenticatedRequest,
    @CurrentOrgId() orgId: string,
    @Param('posId') posId: string,
    @Body() body: unknown,
  ): Promise<PointOfSaleView> {
    const parsed = PatchPointOfSaleSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.pointsOfSale.patch(orgId, posId, parsed.data, actorOf(req));
  }

  @Put('points-of-sale/:posId/token')
  @RequirePermission('fiscal.manage')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: INTEGRATION_WRITE_THROTTLE })
  @RequireRecentReauth()
  async replaceToken(
    @Req() req: AuthenticatedRequest,
    @CurrentOrgId() orgId: string,
    @Param('posId') posId: string,
    @Body() body: unknown,
  ): Promise<PointOfSaleView> {
    const parsed = ReplaceTokenSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.pointsOfSale.replaceToken(orgId, posId, parsed.data.token, actorOf(req));
  }

  @Post('points-of-sale/:posId/test')
  @HttpCode(200)
  @RequirePermission('fiscal.manage')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: EDEF_TEST_THROTTLE })
  async testPointOfSale(
    @CurrentOrgId() orgId: string,
    @Param('posId') posId: string,
  ): Promise<PointOfSaleView> {
    return this.pointsOfSale.test(orgId, posId);
  }

  @Post('points-of-sale/:posId/disable')
  @HttpCode(200)
  @RequirePermission('fiscal.manage')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: INTEGRATION_WRITE_THROTTLE })
  @RequireRecentReauth()
  async disablePointOfSale(
    @Req() req: AuthenticatedRequest,
    @CurrentOrgId() orgId: string,
    @Param('posId') posId: string,
    @Body() body: unknown,
  ): Promise<PointOfSaleView> {
    const parsed = DisablePointOfSaleSchema.safeParse(body ?? {});
    if (!parsed.success) invalidRequest(parsed.error);
    return this.pointsOfSale.disable(orgId, posId, parsed.data.reason ?? null, actorOf(req));
  }

  @Get('points-of-sale/:posId/reference-data')
  @RequirePermission('fiscal.manage')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: EDEF_TEST_THROTTLE })
  async referenceDataOf(
    @CurrentOrgId() orgId: string,
    @Param('posId') posId: string,
  ): Promise<ReferenceDataView> {
    return this.referenceData.read(orgId, posId);
  }
}

function actorOf(req: AuthenticatedRequest): FiscalActor {
  // Le rôle est celui que `PermissionsGuard` vient de vérifier : l'audit porte le
  // rôle SOUS LEQUEL l'action a été autorisée.
  return { userId: req.user!.id, role: req.orgRole ?? 'unknown' };
}
