// Modèle d'import du personnel au format .xlsx — ADR-0068, amendement du 8 nov. 2026.
//
//   GET /hr/employees/import/template.xlsx   hr.read   onglets « Guide » et « Collaborateurs »
//
// Contrôleur à part du lot 1 (même préfixe) : `exceljs`, déjà dépendance de l'API.

import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { AuthGuard } from '../../auth/auth.guard.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { RequireFeature } from '../../billing/feature.guard.js';
import { buildEmployeeImportTemplateXlsx } from './hr-employee-import.service.js';

@Controller('hr/employees/import')
@RequireFeature('hr')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrEmployeeImportTemplateController {
  @Get('template.xlsx')
  @RequirePermission('hr.read')
  async templateXlsx(@Res() res: Response): Promise<void> {
    const body = await buildEmployeeImportTemplateXlsx();
    res
      .status(200)
      .set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="modele-import-collaborateurs.xlsx"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(body);
  }
}
