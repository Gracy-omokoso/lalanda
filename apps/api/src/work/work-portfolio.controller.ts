// Accueil des projets (portefeuille) — ADR-0058.
//
//   GET /work/portfolio?scope=mine|all|archived   work.read
//
// Organisation active de la session, jamais d'une requête. Une organisation ne
// voit que ses projets ; les chiffres portent sur ses projets non archivés.

import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { WorkPortfolioQuery, type WorkPortfolioView } from '@lalanda/shared/work';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { workActorOf } from './work.common.js';
import { RequireFeature } from '../billing/feature.guard.js';
import { WorkVisibilityGuard } from './work-visibility.guard.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { WorkPortfolioService } from './work-portfolio.service.js';

type User = { id: string };

@Controller('work/portfolio')
@RequireFeature('run_work') // ADR-0053 — P4, comme les autres routes du module
@UseGuards(AuthGuard, PermissionsGuard, WorkVisibilityGuard)
export class WorkPortfolioController {
  constructor(@Inject(WorkPortfolioService) private readonly portfolio: WorkPortfolioService) {}

  @Get()
  @RequirePermission('work.read')
  async get(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
  ): Promise<WorkPortfolioView> {
    const parsed = WorkPortfolioQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de l’accueil invalides.');
    return this.portfolio.portfolio(orgId, workActorOf(user, perms), parsed.data);
  }
}
