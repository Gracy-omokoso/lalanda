// Reprise de l'existant (ADR-0049 § 3.2, § 11). ADR-0049 — K7.
//
//   GET  /accounting/opening/proposal       accounting.read   (proposition, rien n'est enregistré)
//   GET  /accounting/opening                accounting.read   (état de la reprise, écarts)
//   POST /accounting/opening                accounting.post   (saisie en brouillon, journal `AN`)
//   POST /accounting/opening/:id/validate   accounting.post   (ⓢ, manualEntryDecision)
//
// Le nom du contrôleur ne commence ni par `Accounting` ni par `Bookkeeping` : les blocs K4
// et K5 de `routes-coverage.test.ts` énumèrent ces préfixes à l'égalité stricte.

import {
  CreateAccountingOpeningBody,
  ValidateAccountingOpeningBody,
  type AccountingOpeningProposalView,
  type AccountingOpeningStatusView,
} from '@lalanda/shared/accounting';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { CurrentAccountingActor, parseWith, type AccountingActor } from '../accounting.common.js';
import { CutoverOpeningService } from './cutover-opening.service.js';

@Controller('accounting/opening')
@UseGuards(AuthGuard, PermissionsGuard)
export class CutoverOpeningController {
  constructor(@Inject(CutoverOpeningService) private readonly opening: CutoverOpeningService) {}

  @Get('proposal')
  @RequirePermission('accounting.read')
  async proposal(@CurrentOrgId() orgId: string): Promise<AccountingOpeningProposalView> {
    return this.opening.proposal(orgId);
  }

  @Get()
  @RequirePermission('accounting.read')
  async status(@CurrentOrgId() orgId: string): Promise<AccountingOpeningStatusView> {
    return this.opening.status(orgId);
  }

  @Post()
  @RequirePermission('accounting.post')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Body() body: unknown,
  ): Promise<AccountingOpeningStatusView> {
    return this.opening.create(orgId, parseWith(CreateAccountingOpeningBody, body), actor);
  }

  @Post(':id/validate')
  @HttpCode(200)
  @RequirePermission('accounting.post')
  async validate(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AccountingOpeningStatusView> {
    return this.opening.validate(orgId, id, parseWith(ValidateAccountingOpeningBody, body), actor);
  }
}
