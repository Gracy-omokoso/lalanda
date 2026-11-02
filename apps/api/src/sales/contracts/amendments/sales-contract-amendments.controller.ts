// Avenants — ADR-0050 § 3. ADR-0050 — V3.
//
//   GET  /sales/contracts/:id/amendments                    sales.read
//   GET  /sales/contracts/:id/amendments/:aid               sales.read
//   POST /sales/contracts/:id/amendments                    sales.contract (contrat signé)
//   PUT  /sales/contracts/:id/amendments/:aid               sales.contract (brouillon)
//   POST /sales/contracts/:id/amendments/:aid/submit        sales.contract
//   POST /sales/contracts/:id/amendments/:aid/cancel        sales.contract (motif)
//   POST /sales/contracts/:id/amendments/:aid/signature     sales.contract — copie signée exigée
//   POST /sales/contracts/:id/amendments/:aid/approve       sales.contract.approve (ⓢ)
//   POST /sales/contracts/:id/amendments/:aid/reject        sales.contract.approve (ⓢ)
//
// Les copies d'un avenant se téléversent par `POST /sales/contracts/:id/files?amendmentId=`.
// Un contrat ou un avenant d'une autre organisation répond 404.

import {
  SalesContractAmendmentSchema,
  SalesContractApproveSchema,
  SalesContractReasonSchema,
  SalesContractRejectSchema,
  SalesContractRevisionSchema,
  SalesContractSignatureSchema,
} from '@lalanda/shared/sales-contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../../auth/current-user.decorator.js';
import { RequirePermission } from '../../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../../authz/permissions.guard.js';
import type { OrgRole } from '../../../authz/permissions.js';
import { invalidRequestOf } from '../../sales.errors.js';
import {
  contractsActorOf,
  parseContractsBody,
  type ContractsUser,
} from '../common/contracts.common.js';
import {
  SalesContractAmendmentsService,
  type SalesContractAmendmentBody,
  type SalesContractAmendmentView,
} from './sales-contract-amendments.service.js';
import { RequireFeature } from '../../../billing/feature.guard.js';

function amendmentBody(body: unknown): SalesContractAmendmentBody {
  return parseContractsBody(SalesContractAmendmentSchema, body) as SalesContractAmendmentBody;
}

@Controller('sales/contracts/:contractId/amendments')
@RequireFeature('sales_contracts') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class SalesContractAmendmentsController {
  constructor(
    @Inject(SalesContractAmendmentsService)
    private readonly amendments: SalesContractAmendmentsService,
  ) {}

  @Get()
  @RequirePermission('sales.read')
  async list(
    @CurrentOrgId() orgId: string,
    @Param('contractId') contractId: string,
  ): Promise<{ items: SalesContractAmendmentView[] }> {
    return { items: await this.amendments.list(orgId, contractId) };
  }

  @Get(':amendmentId')
  @RequirePermission('sales.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('contractId') contractId: string,
    @Param('amendmentId') amendmentId: string,
  ): Promise<SalesContractAmendmentView> {
    return this.amendments.view(orgId, contractId, amendmentId);
  }

  @Post()
  @RequirePermission('sales.contract')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Body() body: unknown,
  ): Promise<SalesContractAmendmentView> {
    const input = amendmentBody(body);
    return this.amendments.create(orgId, contractId, input, contractsActorOf(user, role));
  }

  @Put(':amendmentId')
  @RequirePermission('sales.contract')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Param('amendmentId') amendmentId: string,
    @Body() body: unknown,
  ): Promise<SalesContractAmendmentView> {
    const input = amendmentBody(body);
    if (input.expectedRevision === undefined) {
      invalidRequestOf([
        { path: 'expectedRevision', code: 'FIELD_REQUIRED', message: 'Révision attendue.' },
      ]);
    }
    return this.amendments.put(
      orgId,
      contractId,
      amendmentId,
      { ...input, expectedRevision: input.expectedRevision },
      contractsActorOf(user, role),
    );
  }

  @Post(':amendmentId/submit')
  @HttpCode(200)
  @RequirePermission('sales.contract')
  async submit(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Param('amendmentId') amendmentId: string,
    @Body() body: unknown,
  ): Promise<SalesContractAmendmentView> {
    const input = parseContractsBody(SalesContractRevisionSchema, body);
    return this.amendments.submit(
      orgId,
      contractId,
      amendmentId,
      input.expectedRevision,
      contractsActorOf(user, role),
    );
  }

  @Post(':amendmentId/cancel')
  @HttpCode(200)
  @RequirePermission('sales.contract')
  async cancel(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Param('amendmentId') amendmentId: string,
    @Body() body: unknown,
  ): Promise<SalesContractAmendmentView> {
    const input = parseContractsBody(SalesContractReasonSchema, body);
    return this.amendments.cancel(
      orgId,
      contractId,
      amendmentId,
      input.expectedRevision,
      input.reason,
      contractsActorOf(user, role),
    );
  }

  @Post(':amendmentId/signature')
  @HttpCode(200)
  @RequirePermission('sales.contract')
  async signature(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Param('amendmentId') amendmentId: string,
    @Body() body: unknown,
  ): Promise<SalesContractAmendmentView> {
    const input = parseContractsBody(SalesContractSignatureSchema, body);
    return this.amendments.declareSignature(
      orgId,
      contractId,
      amendmentId,
      input,
      contractsActorOf(user, role),
    );
  }

  @Post(':amendmentId/approve')
  @HttpCode(200)
  @RequirePermission('sales.contract.approve')
  async approve(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Param('amendmentId') amendmentId: string,
    @Body() body: unknown,
  ): Promise<SalesContractAmendmentView> {
    const input = parseContractsBody(SalesContractApproveSchema, body);
    return this.amendments.decide(
      orgId,
      contractId,
      amendmentId,
      input.expectedRevision,
      'approved',
      input.comment,
      contractsActorOf(user, role),
    );
  }

  @Post(':amendmentId/reject')
  @HttpCode(200)
  @RequirePermission('sales.contract.approve')
  async reject(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Param('amendmentId') amendmentId: string,
    @Body() body: unknown,
  ): Promise<SalesContractAmendmentView> {
    const input = parseContractsBody(SalesContractRejectSchema, body);
    return this.amendments.decide(
      orgId,
      contractId,
      amendmentId,
      input.expectedRevision,
      'rejected',
      input.comment,
      contractsActorOf(user, role),
    );
  }
}
