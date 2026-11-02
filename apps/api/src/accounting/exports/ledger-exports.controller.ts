// Exports pour l'expert-comptable (ADR-0049 § 9, § 11). ADR-0049 — K6.
//
//   POST /accounting/exports            accounting.export   (audit strict, limite de débit)
//   GET  /accounting/exports            accounting.read     (journal, empreintes)
//   GET  /accounting/exports/:id/file   accounting.export   (fichier, tant qu'il est conservé)
//
// Les guards de débit sont posés APRÈS `AuthGuard` et `PermissionsGuard` : un refus de
// droit ne consomme pas le quota.

import {
  CreateAccountingExportBody,
  type AccountingExportView,
  type AccountingPage,
} from '@lalanda/shared/accounting';
import { Body, Controller, Get, Inject, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { CurrentAccountingActor, parseWith, type AccountingActor } from '../accounting.common.js';
import { AccountingExportsService } from './accounting-exports.service.js';
import {
  OrgAccountingExportThrottlerGuard,
  UserAccountingExportThrottlerGuard,
} from './export-throttler.guard.js';
import { RequireFeature } from '../../billing/feature.guard.js';

@Controller('accounting/exports')
@RequireFeature('accounting') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class LedgerExportsController {
  constructor(
    @Inject(AccountingExportsService) private readonly exportsService: AccountingExportsService,
  ) {}

  @Post()
  @RequirePermission('accounting.export')
  @UseGuards(UserAccountingExportThrottlerGuard, OrgAccountingExportThrottlerGuard)
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Body() body: unknown,
  ): Promise<AccountingExportView> {
    return this.exportsService.create(orgId, parseWith(CreateAccountingExportBody, body), actor);
  }

  @Get()
  @RequirePermission('accounting.read')
  async list(@CurrentOrgId() orgId: string): Promise<AccountingPage<AccountingExportView>> {
    return this.exportsService.list(orgId);
  }

  @Get(':id/file')
  @RequirePermission('accounting.export')
  async file(
    @CurrentOrgId() orgId: string,
    @CurrentAccountingActor() actor: AccountingActor,
    @Param('id') id: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const { meta, data } = await this.exportsService.file(orgId, id, actor);
    res.setHeader('Content-Type', meta.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${meta.fileName.replace(/[^\w.-]/g, '_')}"`,
    );
    res.setHeader('X-Content-SHA256', meta.sha256);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).end(data);
  }
}
