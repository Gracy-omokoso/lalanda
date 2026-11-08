// Tableaux de bord des écrans Trésorerie — ADR-0071 § 2.
//
//   GET /treasury/expenses/stats?month=   treasury.read   (même droit que la liste)
//   GET /treasury/accounts/stats          treasury.read   (même droit que les comptes)
//
// Contrôleur à part, enregistré AVANT ceux des dépenses et des comptes : `stats`
// n'est jamais pris pour un identifiant (`expenses/:expenseId`, `accounts/:accountId`).

import {
  AccountStatsQuerySchema,
  ExpenseStatsQuerySchema,
  type AccountStats,
  type ExpenseStats,
} from '@lalanda/shared/treasury';
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { RequireFeature } from '../billing/feature.guard.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { TreasuryStatsService } from './treasury-stats.service.js';

@Controller('treasury')
@RequireFeature('treasury') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class TreasuryStatsController {
  constructor(@Inject(TreasuryStatsService) private readonly stats: TreasuryStatsService) {}

  @Get('expenses/stats')
  @RequirePermission('treasury.read')
  async expenses(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<ExpenseStats> {
    const parsed = ExpenseStatsQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres du tableau de bord invalides.');
    return this.stats.expenseStats(orgId, parsed.data);
  }

  @Get('accounts/stats')
  @RequirePermission('treasury.read')
  async accounts(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<AccountStats> {
    const parsed = AccountStatsQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres du tableau de bord invalides.');
    return this.stats.accountStats(orgId, parsed.data);
  }
}
