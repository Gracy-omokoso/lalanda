// Report des dépenses vers le réalisé et rapprochement — ADR-0034 § 5, § 6 et § 8.
//
//   GET  /treasury/actuals-bridge          configuration (treasury.read)
//   PUT  /treasury/actuals-bridge          projet, exercice, correspondance (actuals.import + treasury.read)
//   POST /treasury/actuals-bridge/sync     synchronisation idempotente, `dryRun` possible (idem)
//   GET  /treasury/reconciliation?year=N   réalisé vs prévu expliqué (treasury.read + analytics.read)

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
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
import { invalidRequest } from '../sales/sales.errors.js';
import {
  TreasuryPlanningService,
  type BridgeView,
  type ReconciliationView,
  type SyncReport,
} from './treasury-planning.service.js';
import { PutBridgeSchema, ReconciliationQuerySchema, SyncSchema } from './treasury.dto.js';

@Controller('treasury')
@UseGuards(AuthGuard, PermissionsGuard)
export class TreasuryActualsController {
  constructor(
    @Inject(TreasuryPlanningService) private readonly planning: TreasuryPlanningService,
  ) {}

  @Get('actuals-bridge')
  @RequirePermission('treasury.read')
  async getBridge(@CurrentOrgId() orgId: string): Promise<BridgeView> {
    return this.planning.getBridge(orgId);
  }

  @Put('actuals-bridge')
  @RequirePermission('actuals.import', 'treasury.read')
  async putBridge(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<BridgeView> {
    const parsed = PutBridgeSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.planning.putBridge(orgId, parsed.data, {
      userId: user.id,
      role: role ?? 'unknown',
    });
  }

  @Post('actuals-bridge/sync')
  @HttpCode(200)
  @RequirePermission('actuals.import', 'treasury.read')
  async sync(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<SyncReport> {
    const parsed = SyncSchema.safeParse(body ?? {});
    if (!parsed.success) invalidRequest(parsed.error);
    return this.planning.sync(orgId, parsed.data.dryRun, {
      userId: user.id,
      role: role ?? 'unknown',
    });
  }

  @Get('reconciliation')
  @RequirePermission('treasury.read', 'analytics.read')
  async reconciliation(
    @CurrentOrgId() orgId: string,
    @Query() query: unknown,
  ): Promise<ReconciliationView> {
    const parsed = ReconciliationQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Exercice attendu : 1 à 5.');
    return this.planning.reconciliation(orgId, parsed.data.year);
  }
}
