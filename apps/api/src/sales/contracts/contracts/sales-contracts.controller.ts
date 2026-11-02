// Contrats clients — ADR-0050 § 3. ADR-0050 — V3.
//
//   GET    /sales/contracts                       sales.read (filtre `billingKind=recurring` :
//                                                 abonnements)
//   GET    /sales/contracts/:id                   sales.read (`?on=AAAA-MM-JJ` : conditions
//                                                 en vigueur à cette date)
//   POST   /sales/contracts                       sales.contract
//   PUT    /sales/contracts/:id                   sales.contract (brouillon)
//   DELETE /sales/contracts/:id                   sales.contract (brouillon v1 jamais soumis)
//   POST   /sales/contracts/:id/submit            sales.contract
//   POST   /sales/contracts/:id/new-version       sales.contract
//   POST   /sales/contracts/:id/cancel            sales.contract (motif)
//   POST   /sales/contracts/:id/signature         sales.contract — signature DÉCLARÉE,
//                                                 copie PDF signée exigée
//   POST   /sales/contracts/:id/files             sales.contract — corps BINAIRE, PDF ≤ 10 Mio
//                                                 (`?kind=draft_copy|signed_copy&amendmentId=`)
//   GET    /sales/contracts/:id/files/:fileId     sales.read — téléchargement inerte
//   POST   /sales/contracts/:id/approve           sales.contract.approve (ⓢ)
//   POST   /sales/contracts/:id/reject            sales.contract.approve (ⓢ)
//   POST   /sales/contracts/:id/renewals          sales.contract.approve — CONSTATER
//   POST   /sales/contracts/:id/terminate         sales.contract.approve
//
// Un contrat d'une autre organisation répond 404.

import {
  SalesContractApproveSchema,
  SalesContractCalendarDay,
  SalesContractReasonSchema,
  SalesContractRejectSchema,
  SalesContractRevisionSchema,
  SalesContractSignatureSchema,
  SalesContractTerminateSchema,
} from '@lalanda/shared/sales-contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { AuthGuard } from '../../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../../auth/current-user.decorator.js';
import { RequirePermission } from '../../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../../authz/permissions.guard.js';
import type { OrgRole } from '../../../authz/permissions.js';
import { storageFailure } from '../../../purchases/attachments/purchase-attachments.js';
import { UserThrottlerGuard } from '../../../security/user-throttler.guard.js';
import { invalidRequest } from '../../sales.errors.js';
import {
  contractsActorOf,
  parseContractsBody,
  type ContractsUser,
} from '../common/contracts.common.js';
import {
  readSalesContractPdf,
  sendSalesContractFile,
  type SalesContractFileView,
} from '../files/sales-contract-files.service.js';
import {
  CreateSalesContractSchema,
  ListSalesContractsQuerySchema,
  PutSalesContractSchema,
  SalesContractFileQuerySchema,
} from './sales-contracts.dto.js';
import {
  SalesContractsService,
  type SalesContractPage,
  type SalesContractView,
  type SalesContractWithWarnings,
} from './sales-contracts.service.js';

/** Téléversements par utilisateur et par heure (motif des pièces des achats). */
const UPLOADS_PER_HOUR = 30;

const ViewQuerySchema = z.object({ on: SalesContractCalendarDay.optional() }).strict();

@Controller('sales/contracts')
@UseGuards(AuthGuard, PermissionsGuard)
export class SalesContractsController {
  constructor(@Inject(SalesContractsService) private readonly contracts: SalesContractsService) {}

  @Get()
  @RequirePermission('sales.read')
  async list(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<SalesContractPage> {
    const parsed = ListSalesContractsQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.contracts.list(orgId, parsed.data);
  }

  @Post()
  @RequirePermission('sales.contract')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<SalesContractView> {
    const input = parseContractsBody(CreateSalesContractSchema, body);
    return this.contracts.create(orgId, input, contractsActorOf(user, role));
  }

  @Get(':contractId')
  @RequirePermission('sales.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('contractId') contractId: string,
    @Query() query: unknown,
  ): Promise<SalesContractView> {
    const parsed = ViewQuerySchema.safeParse(query ?? {});
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    return this.contracts.view(orgId, contractId, parsed.data.on);
  }

  @Put(':contractId')
  @RequirePermission('sales.contract')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Body() body: unknown,
  ): Promise<SalesContractView> {
    const input = parseContractsBody(PutSalesContractSchema, body);
    return this.contracts.put(
      orgId,
      contractId,
      input.expectedRevision,
      input.contract,
      contractsActorOf(user, role),
    );
  }

  @Delete(':contractId')
  @HttpCode(204)
  @RequirePermission('sales.contract')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
  ): Promise<void> {
    await this.contracts.remove(orgId, contractId, contractsActorOf(user, role));
  }

  @Post(':contractId/submit')
  @HttpCode(200)
  @RequirePermission('sales.contract')
  async submit(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Body() body: unknown,
  ): Promise<SalesContractView> {
    const input = parseContractsBody(SalesContractRevisionSchema, body);
    return this.contracts.submit(
      orgId,
      contractId,
      input.expectedRevision,
      contractsActorOf(user, role),
    );
  }

  @Post(':contractId/new-version')
  @HttpCode(200)
  @RequirePermission('sales.contract')
  async newVersion(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Body() body: unknown,
  ): Promise<SalesContractView> {
    const input = parseContractsBody(SalesContractRevisionSchema, body);
    return this.contracts.newVersion(
      orgId,
      contractId,
      input.expectedRevision,
      contractsActorOf(user, role),
    );
  }

  @Post(':contractId/cancel')
  @HttpCode(200)
  @RequirePermission('sales.contract')
  async cancel(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Body() body: unknown,
  ): Promise<SalesContractView> {
    const input = parseContractsBody(SalesContractReasonSchema, body);
    return this.contracts.cancel(
      orgId,
      contractId,
      input.expectedRevision,
      input.reason,
      contractsActorOf(user, role),
    );
  }

  @Post(':contractId/signature')
  @HttpCode(200)
  @RequirePermission('sales.contract')
  async signature(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Body() body: unknown,
  ): Promise<SalesContractView> {
    const input = parseContractsBody(SalesContractSignatureSchema, body);
    return this.contracts.declareSignature(orgId, contractId, input, contractsActorOf(user, role));
  }

  @Post(':contractId/approve')
  @HttpCode(200)
  @RequirePermission('sales.contract.approve')
  async approve(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Body() body: unknown,
  ): Promise<SalesContractView> {
    const input = parseContractsBody(SalesContractApproveSchema, body);
    return this.contracts.approve(
      orgId,
      contractId,
      input.expectedRevision,
      input.comment,
      contractsActorOf(user, role),
    );
  }

  @Post(':contractId/reject')
  @HttpCode(200)
  @RequirePermission('sales.contract.approve')
  async reject(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Body() body: unknown,
  ): Promise<SalesContractView> {
    const input = parseContractsBody(SalesContractRejectSchema, body);
    return this.contracts.reject(
      orgId,
      contractId,
      input.expectedRevision,
      input.comment,
      contractsActorOf(user, role),
    );
  }

  @Post(':contractId/renewals')
  @HttpCode(200)
  @RequirePermission('sales.contract.approve')
  async recordRenewal(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Body() body: unknown,
  ): Promise<SalesContractView> {
    const input = parseContractsBody(SalesContractRevisionSchema, body);
    return this.contracts.recordRenewal(
      orgId,
      contractId,
      input.expectedRevision,
      contractsActorOf(user, role),
    );
  }

  @Post(':contractId/terminate')
  @HttpCode(200)
  @RequirePermission('sales.contract.approve')
  async terminate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Body() body: unknown,
  ): Promise<SalesContractWithWarnings> {
    const input = parseContractsBody(SalesContractTerminateSchema, body);
    return this.contracts.terminate(orgId, contractId, input, contractsActorOf(user, role));
  }

  @Post(':contractId/files')
  @HttpCode(201)
  @RequirePermission('sales.contract')
  @Throttle({ default: { ttl: 3_600_000, limit: UPLOADS_PER_HOUR } })
  @UseGuards(UserThrottlerGuard)
  async addFile(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('contractId') contractId: string,
    @Query() query: unknown,
    @Req() req: Request,
  ): Promise<SalesContractFileView> {
    const parsed = SalesContractFileQuerySchema.safeParse(query ?? {});
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de la pièce invalides.');
    await this.contracts.assertFileAttachable(orgId, contractId, parsed.data);
    const bytes = await readSalesContractPdf(req);
    try {
      return await this.contracts.addFile(
        orgId,
        contractId,
        parsed.data,
        bytes,
        req.headers['x-file-name'],
        contractsActorOf(user, role),
      );
    } catch (cause) {
      throw storageFailure(cause);
    }
  }

  @Get(':contractId/files/:fileId')
  @RequirePermission('sales.read')
  async file(
    @CurrentOrgId() orgId: string,
    @Param('contractId') contractId: string,
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ): Promise<void> {
    let found;
    try {
      found = await this.contracts.readFile(orgId, contractId, fileId);
    } catch (cause) {
      throw storageFailure(cause);
    }
    sendSalesContractFile(res, found.meta, found.body);
  }
}
