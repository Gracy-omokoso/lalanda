// Échéancier et abonnements — ADR-0050 § 3, § 5.3. ADR-0050 — V5.
//
//   GET  /sales/contracts/:id/schedule                   sales.read — préparées, à préparer,
//                                                        à venir, bloquées (`?from=&to=`)
//   POST /sales/contracts/:id/occurrences/:key/prepare   sales.read + sales.manage —
//                                                        BROUILLON seulement (`key` : date
//                                                        AAAA-MM-JJ ou `item:<ref>`)
//
// L'émission reste sous `sales.invoice` (routes existantes des factures). Un contrat
// d'une autre organisation répond 404.

import {
  SALES_ENGAGEMENT_INVOICE_TYPES,
  SalesContractCalendarDay,
} from '@lalanda/shared/sales-contracts';
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
import { z } from 'zod';

import { AuthGuard } from '../../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../../auth/current-user.decorator.js';
import { RequirePermission } from '../../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../../authz/permissions.guard.js';
import type { OrgRole } from '../../../authz/permissions.js';
import {
  contractsActorOf,
  contractsNotFound,
  parseContractsBody,
  type ContractsUser,
} from '../common/contracts.common.js';
import { OccurrenceKeySchema } from './sales-subscriptions-model.js';
import {
  SalesSubscriptionsService,
  type PreparedOccurrence,
  type SalesContractScheduleView,
} from './sales-subscriptions.service.js';
import { RequireFeature } from '../../../billing/feature.guard.js';

const ScheduleQuerySchema = z
  .object({ from: SalesContractCalendarDay.optional(), to: SalesContractCalendarDay.optional() })
  .strict();

/** Corps de « Préparer maintenant » : type e-DEF du brouillon, `FV` par défaut. */
const PrepareOccurrenceSchema = z
  .object({
    type: z
      .enum(SALES_ENGAGEMENT_INVOICE_TYPES, { message: 'Type attendu : FV ou EV.' })
      .default('FV'),
  })
  .strict();

@Controller('sales/contracts')
@RequireFeature('sales_contracts') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class SalesSubscriptionsController {
  constructor(
    @Inject(SalesSubscriptionsService) private readonly subscriptions: SalesSubscriptionsService,
  ) {}

  @Get(':contractId/schedule')
  @RequirePermission('sales.read')
  async schedule(
    @CurrentOrgId() orgId: string,
    @Param('contractId') contractId: string,
    @Query() query: unknown,
  ): Promise<SalesContractScheduleView> {
    const parsed = parseContractsBody(ScheduleQuerySchema, query);
    return this.subscriptions.schedule(orgId, contractId, parsed);
  }

  @Post(':contractId/occurrences/:key/prepare')
  @HttpCode(200)
  @RequirePermission('sales.read', 'sales.manage')
  async prepare(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Param('key') key: string,
    @Body() body: unknown,
  ): Promise<PreparedOccurrence> {
    if (!OccurrenceKeySchema.safeParse(key).success) {
      contractsNotFound('OCCURRENCE_NOT_FOUND', 'Cette échéance n’existe pas dans le contrat.');
    }
    const input = parseContractsBody(PrepareOccurrenceSchema, body);
    return this.subscriptions.prepareNow(
      orgId,
      contractId,
      key,
      input.type,
      contractsActorOf(user, role),
    );
  }
}
