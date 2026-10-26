// Pont RUN → BUILD — ADR-0031 § 3 et § 4.
//
//   GET  /sales/actuals-bridge              → réglage et état            (sales.read)
//   GET  /sales/actuals-bridge/candidates   → projets et lignes proposables (actuals.import + sales.read)
//   PUT  /sales/actuals-bridge              → activer, régler, désactiver (actuals.import + sales.read)
//   POST /sales/actuals-bridge/sync         → synchroniser ou simuler    (actuals.import + sales.read)
//
// Écrire le réalisé est un import (`actuals.import`) ; lire les ventes exige
// `sales.read`. Les deux sont demandées ensemble.

import { isCalendarMonth } from '@lalanda/engine';
import { Body, Controller, Get, HttpCode, Inject, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import {
  RunBridgeService,
  type BridgeCandidate,
  type BridgeView,
  type SyncReport,
} from './run-bridge.service.js';

const SettingsSchema = z
  .object({
    enabled: z.boolean(),
    projectId: z
      .string()
      .regex(/^[0-9a-f]{24}$/i)
      .nullable(),
    revenueLineId: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .max(64)
      .nullable(),
    exerciseStart: z
      .string()
      .refine((v) => isCalendarMonth(v), { message: 'Mois attendu au format AAAA-MM.' })
      .nullable(),
  })
  .strict();

const SyncSchema = z.object({ dryRun: z.boolean().default(false) }).strict();

@Controller('sales/actuals-bridge')
@UseGuards(AuthGuard, PermissionsGuard)
export class RunBridgeController {
  constructor(@Inject(RunBridgeService) private readonly bridge: RunBridgeService) {}

  @Get()
  @RequirePermission('sales.read')
  async view(@CurrentOrgId() orgId: string): Promise<BridgeView> {
    return this.bridge.view(orgId);
  }

  @Get('candidates')
  @RequirePermission('actuals.import', 'sales.read')
  async candidates(@CurrentOrgId() orgId: string): Promise<{ items: BridgeCandidate[] }> {
    return { items: await this.bridge.candidates(orgId) };
  }

  @Put()
  @RequirePermission('actuals.import', 'sales.read')
  async configure(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<BridgeView> {
    const parsed = SettingsSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.bridge.configure(orgId, parsed.data, { userId: user.id, role: role ?? 'unknown' });
  }

  @Post('sync')
  @HttpCode(200)
  @RequirePermission('actuals.import', 'sales.read')
  async sync(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<SyncReport> {
    const parsed = SyncSchema.safeParse(body ?? {});
    if (!parsed.success) invalidRequest(parsed.error);
    return this.bridge.sync(orgId, parsed.data.dryRun, {
      userId: user.id,
      role: role ?? 'unknown',
    });
  }
}
