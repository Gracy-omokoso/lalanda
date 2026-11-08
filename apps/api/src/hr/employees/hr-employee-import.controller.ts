// Import du personnel existant — ADR-0068 § 4.
//
//   GET  /hr/employees/import/template.csv                 hr.read    modèle (« ; », BOM)
//   POST /hr/employees/import/preview?createDepartments=   hr.manage  aperçu, rien n'est écrit
//   POST /hr/employees/import/apply?invite=&skipInvalid=&createDepartments=
//                                                          hr.manage  crée les lignes valides
//   (modèle .xlsx : `HrEmployeeImportTemplateController`, amendement du 8 nov. 2026)
//
// Le fichier est le CORPS BRUT (2 Mo au plus), comme l'import des projets (ADR-0062).
// `invite=true` invite les lignes qui ont un e-mail ; sans `members.invite` (droits
// effectifs), rien n'est envoyé et chaque ligne le dit.

import { WORK_PLAN_LIMITS } from '@lalanda/shared/work';
import type { EmployeeImportPreview, EmployeeImportResult } from '@lalanda/shared/hr';
import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { readRequestBody } from '../../account/request-body.js';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../../authz/current-org-permissions.decorator.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { can, type OrgRole } from '../../authz/permissions.js';
import { RequireFeature } from '../../billing/feature.guard.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { UserThrottlerGuard } from '../../security/user-throttler.guard.js';
import { ImportFileError } from '../../work/work-import.parser.js';
import {
  HrEmployeeImportService,
  buildEmployeeImportTemplateCsv,
} from './hr-employee-import.service.js';

const flag = z.enum(['true', 'false']).optional();
const ApplyQuery = z.object({ invite: flag, skipInvalid: flag, createDepartments: flag }).strict();
// Amendement du 8 nov. 2026 : créer les services inconnus du fichier.
const PreviewQuery = z.object({ createDepartments: flag }).strict();

async function fileOf(req: Request): Promise<Buffer> {
  const read = await readRequestBody(req, WORK_PLAN_LIMITS.importFileMaxBytes);
  if (!read.ok) {
    if (read.reason === 'TOO_LARGE') {
      throw new HttpException(
        { code: 'IMPORT_FILE_TOO_LARGE', message: 'Le fichier dépasse 2 Mo.' },
        413,
      );
    }
    throw new BadRequestException({ code: 'UPLOAD_ABORTED', message: 'Envoi interrompu.' });
  }
  return read.body;
}

function fileError(err: unknown): never {
  if (err instanceof ImportFileError) {
    throw new BadRequestException({ code: err.code, message: err.message });
  }
  throw err;
}

@Controller('hr/employees/import')
@RequireFeature('hr')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrEmployeeImportController {
  constructor(@Inject(HrEmployeeImportService) private readonly imports: HrEmployeeImportService) {}

  @Get('template.csv')
  @RequirePermission('hr.read')
  template(@Res() res: Response): void {
    res
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="modele-import-collaborateurs.csv"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(buildEmployeeImportTemplateCsv());
  }

  @Post('preview')
  @HttpCode(200)
  @Throttle({ default: { ttl: 3_600_000, limit: 60 } })
  @UseGuards(UserThrottlerGuard)
  @RequirePermission('hr.manage')
  async preview(
    @CurrentOrgId() orgId: string,
    @Query() query: unknown,
    @Req() req: Request,
  ): Promise<EmployeeImportPreview> {
    const parsed = PreviewQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    const body = await fileOf(req);
    try {
      return await this.imports.preview(orgId, body, {
        createDepartments: parsed.data.createDepartments === 'true',
      });
    } catch (err) {
      fileError(err);
    }
  }

  @Post('apply')
  @HttpCode(201)
  @Throttle({ default: { ttl: 3_600_000, limit: 60 } })
  @UseGuards(UserThrottlerGuard)
  @RequirePermission('hr.manage')
  async apply(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string; name?: string | null },
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
    @Req() req: Request,
  ): Promise<EmployeeImportResult> {
    const parsed = ApplyQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    const body = await fileOf(req);
    let out: Awaited<ReturnType<HrEmployeeImportService['apply']>>;
    try {
      out = await this.imports.apply(
        orgId,
        body,
        {
          invite: parsed.data.invite === 'true',
          skipInvalid: parsed.data.skipInvalid === 'true',
          createDepartments: parsed.data.createDepartments === 'true',
        },
        {
          userId: user.id,
          role: role ?? 'unknown',
          name: user.name ?? null,
          canInvite: perms ? can(perms.role, 'members.invite', perms.context) : false,
        },
      );
    } catch (err) {
      fileError(err);
    }
    if ('blocked' in out) {
      throw new ConflictException({
        code: 'IMPORT_HAS_ERRORS',
        message:
          'Des lignes sont en erreur : corrigez-les, ou confirmez l’import des seules lignes valides.',
        details: { preview: out.blocked },
      });
    }
    return out;
  }
}
