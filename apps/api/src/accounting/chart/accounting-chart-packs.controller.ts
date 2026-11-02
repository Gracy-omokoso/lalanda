// Packs de plan comptable (ADR-0049 § 2.1, § 11). ADR-0049 — K4.
//
// Organisations (lecture) :
//   GET  /accounting/chart-packs                         accounting.read
//   GET  /accounting/chart-packs/:slug/:version          accounting.read
//
// Plateforme (chargement et cycle de version, `platform_country_pack_manager` seul,
// ADR-0049 § 2.1 et § 8.1 — hors matrice organisation) :
//   POST /accounting/platform/chart-packs                         charge un YAML livré
//   POST /accounting/platform/chart-packs/:slug/:version/transition  draft → review → approved → active → retired

import {
  AccountingChartPackRefSchema,
  LoadAccountingChartPackBody,
  TransitionAccountingChartPackBody,
  type AccountingChartPackDetail,
  type AccountingChartPackSummary,
} from '@lalanda/shared/accounting';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { AuthenticatedRequest } from '../../auth/auth.guard.js';
import {
  PlatformConsoleRoute,
  RequirePermission,
  RequirePlatformRole,
} from '../../authz/authz.decorators.js';
import { AuthzService } from '../../authz/authz.service.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
// ADR-0053 — P0
import { PlatformAuthGuard } from '../../authz/platform-auth.guard.js';
import { parseParam, parseWith } from '../accounting.common.js';
import { ChartPacksService, type PlatformPackActor } from './chart-packs.service.js';

function refOf(slug: string, version: string) {
  return parseParam(AccountingChartPackRefSchema, {
    slug,
    version: /^\d{1,6}$/.test(version) ? Number(version) : version,
  });
}

@Controller('accounting/chart-packs')
@UseGuards(AuthGuard, PermissionsGuard)
export class AccountingChartPacksController {
  constructor(@Inject(ChartPacksService) private readonly packs: ChartPacksService) {}

  @Get()
  @RequirePermission('accounting.read')
  async list(): Promise<{ items: AccountingChartPackSummary[] }> {
    return { items: await this.packs.list() };
  }

  @Get(':slug/:version')
  @RequirePermission('accounting.read')
  async get(
    @Param('slug') slug: string,
    @Param('version') version: string,
  ): Promise<AccountingChartPackDetail> {
    return this.packs.detail(refOf(slug, version));
  }
}

@Controller('accounting/platform/chart-packs')
// ADR-0053 — P0 : route plateforme, sans organisation (le gestionnaire comptable et fiscal
// n'est membre d'aucun client).
@UseGuards(PlatformAuthGuard, PermissionsGuard)
@PlatformConsoleRoute()
@RequirePlatformRole('platform_country_pack_manager')
export class AccountingChartPacksPlatformController {
  constructor(
    @Inject(ChartPacksService) private readonly packs: ChartPacksService,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  private async actor(user: AuthenticatedRequest['user']): Promise<PlatformPackActor> {
    const userId = user?.id ?? '';
    return { userId, roles: (await this.authz.platformRolesOf(userId)).join(',') };
  }

  @Post()
  @HttpCode(200)
  async load(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Body() body: unknown,
  ): Promise<{ pack: AccountingChartPackDetail; created: boolean; changed: boolean }> {
    return this.packs.load(parseWith(LoadAccountingChartPackBody, body), await this.actor(user));
  }

  @Post(':slug/:version/transition')
  @HttpCode(200)
  async transition(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('slug') slug: string,
    @Param('version') version: string,
    @Body() body: unknown,
  ): Promise<AccountingChartPackDetail> {
    return this.packs.transition(
      refOf(slug, version),
      parseWith(TransitionAccountingChartPackBody, body),
      await this.actor(user),
    );
  }
}
