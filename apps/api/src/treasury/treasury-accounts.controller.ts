// Comptes, mouvements, prévision et réglages — ADR-0034 § 4, § 7 et § 8.
//
//   GET  /treasury/accounts                 comptes et soldes du jour (moteur)
//   GET  /treasury/accounts/:id             un compte
//   POST /treasury/accounts                 créer (treasury.manage)
//   PUT  /treasury/accounts/:id             modifier (révision attendue)
//   GET  /treasury/movements                grand livre unifié
//   POST /treasury/transfers                virement interne
//   POST /treasury/movements                autre entrée ou sortie
//   POST /treasury/movements/:id/cancel     annuler (motif)
//   GET  /treasury/forecast?currency=USD    prévision 7/30/90/180 jours (moteur)
//   GET  /treasury/settings                 minimum de trésorerie, hypothèses
//   PUT  /treasury/settings                 (treasury.manage)

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { TreasuryForecast } from '@lalanda/engine';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import type { OrgRole } from '../authz/permissions.js';
import { invalidRequest } from '../sales/sales.errors.js';
import {
  TreasuryAccountsService,
  type AccountsPage,
  type LedgerEntry,
  type TreasuryAccountView,
} from './treasury-accounts.service.js';
import { TreasuryMovementsService, type MovementView } from './treasury-movements.service.js';
import { TreasuryPlanningService, type SettingsView } from './treasury-planning.service.js';
import type { TreasuryActor } from './treasury.common.js';
import {
  CancelSchema,
  CreateAccountSchema,
  ForecastQuerySchema,
  ListMovementsQuerySchema,
  OtherMovementSchema,
  PutAccountSchema,
  PutSettingsSchema,
  TransferSchema,
} from './treasury.dto.js';

function actorOf(user: { id: string }, role: OrgRole | undefined): TreasuryActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

@Controller('treasury')
@UseGuards(AuthGuard, PermissionsGuard)
export class TreasuryAccountsController {
  constructor(
    @Inject(TreasuryAccountsService) private readonly accounts: TreasuryAccountsService,
    @Inject(TreasuryMovementsService) private readonly movements: TreasuryMovementsService,
    @Inject(TreasuryPlanningService) private readonly planning: TreasuryPlanningService,
  ) {}

  @Get('accounts')
  @RequirePermission('treasury.read')
  async list(@CurrentOrgId() orgId: string): Promise<AccountsPage> {
    return this.accounts.list(orgId);
  }

  @Get('accounts/:accountId')
  @RequirePermission('treasury.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('accountId') accountId: string,
  ): Promise<TreasuryAccountView> {
    return this.accounts.get(orgId, accountId);
  }

  @Post('accounts')
  @RequirePermission('treasury.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<TreasuryAccountView> {
    const parsed = CreateAccountSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.accounts.create(orgId, parsed.data, actorOf(user, role));
  }

  @Put('accounts/:accountId')
  @RequirePermission('treasury.manage')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
  ): Promise<TreasuryAccountView> {
    const parsed = PutAccountSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.accounts.put(orgId, accountId, parsed.data, actorOf(user, role));
  }

  @Get('movements')
  @RequirePermission('treasury.read')
  async ledger(
    @CurrentOrgId() orgId: string,
    @Query() query: unknown,
  ): Promise<{ items: LedgerEntry[]; truncated: boolean }> {
    const parsed = ListMovementsQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    return this.movements.ledger(orgId, parsed.data);
  }

  @Post('transfers')
  @RequirePermission('treasury.manage')
  async transfer(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<MovementView> {
    const parsed = TransferSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.movements.transfer(orgId, parsed.data, actorOf(user, role));
  }

  @Post('movements')
  @RequirePermission('treasury.manage')
  async other(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<MovementView> {
    const parsed = OtherMovementSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.movements.other(orgId, parsed.data, actorOf(user, role));
  }

  @Post('movements/:movementId/cancel')
  @HttpCode(200)
  @RequirePermission('treasury.manage')
  async cancel(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('movementId') movementId: string,
    @Body() body: unknown,
  ): Promise<MovementView> {
    const parsed = CancelSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.movements.cancel(orgId, movementId, parsed.data.reason, actorOf(user, role));
  }

  @Get('forecast')
  @RequirePermission('treasury.read')
  async forecast(
    @CurrentOrgId() orgId: string,
    @Query() query: unknown,
  ): Promise<TreasuryForecast> {
    const parsed = ForecastQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Devise attendue : CDF ou USD.');
    return this.planning.forecast(orgId, parsed.data.currency);
  }

  @Get('settings')
  @RequirePermission('treasury.read')
  async settings(@CurrentOrgId() orgId: string): Promise<SettingsView> {
    return this.planning.getSettings(orgId);
  }

  @Put('settings')
  @RequirePermission('treasury.manage')
  async putSettings(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<SettingsView> {
    const parsed = PutSettingsSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.planning.putSettings(orgId, parsed.data, actorOf(user, role));
  }
}
