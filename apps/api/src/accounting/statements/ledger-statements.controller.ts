// Projets d'états (ADR-0049 § 10, § 11). ADR-0049 — K6.
//
//   GET /accounting/statements/:kind?year=&month=   accounting.read
//
// `kind` ∈ `balance-sheet`, `income-statement`, `cash-flow`. Chaque réponse porte
// `status: "draft_unverified"`, `disclaimer` et `reserves` ; `cash-flow` →
// `409 STATEMENT_NOT_AVAILABLE` tant que la question E8 n'est pas tranchée.

import {
  AccountingStatementKindSchema,
  AccountingStatementQuery,
  type AccountingStatementView,
} from '@lalanda/shared/accounting';
import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { parseParam, parseWith } from '../accounting.common.js';
import { AccountingStatementsService } from './accounting-statements.service.js';

@Controller('accounting/statements')
@UseGuards(AuthGuard, PermissionsGuard)
export class LedgerStatementsController {
  constructor(
    @Inject(AccountingStatementsService) private readonly statements: AccountingStatementsService,
  ) {}

  @Get(':kind')
  @RequirePermission('accounting.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('kind') kind: string,
    @Query() query: unknown,
  ): Promise<AccountingStatementView> {
    return this.statements.get(
      orgId,
      parseParam(AccountingStatementKindSchema, kind),
      parseWith(AccountingStatementQuery, query),
    );
  }
}
