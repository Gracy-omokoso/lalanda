// Import d'un fichier de tâches — ADR-0062 § 5.
//
//   GET  /work/import/template.xlsx        work.read   modèle (onglets Guide et Tâches)
//   GET  /work/import/template.csv         work.read   modèle CSV (« ; », UTF-8 avec BOM)
//   POST /work/import/preview?projectId=   work.update aperçu, rien n'est écrit
//   POST /work/import/projects?name=…      work.manage nouveau projet depuis le fichier
//   POST /work/projects/:projectId/import  work.update tâches du fichier dans le projet
//
// Le fichier est le CORPS BRUT de la requête (2 Mo au plus, compté pendant la
// lecture), son nom en en-tête `X-File-Name` (encodé URI, informatif). Le format
// est déduit du contenu. `skipInvalid=true` confirme l'import des seules lignes
// valides quand l'aperçu signale des erreurs. Organisation active seulement ;
// un projet d'une autre organisation répond 404.

import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  WORK_PLAN_LIMITS,
  WorkPlanProjectSchema,
  type WorkImportPreview,
  type WorkPlanApplyResult,
} from '@lalanda/shared/work';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { readRequestBody } from '../account/request-body.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { RequireFeature } from '../billing/feature.guard.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import { WorkIdPipe, isWorkId, workActorOf } from './work.common.js';
import { WorkImportService } from './work-import.service.js';
import { buildImportTemplateCsv, buildImportTemplateXlsx } from './work-import.template.js';

type User = { id: string };

/** Envois de fichiers par heure et par utilisateur (aperçus compris). */
export const IMPORT_UPLOADS_PER_HOUR = 60;

async function fileOf(req: Request): Promise<{ body: Buffer; fileName: string | null }> {
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
  const raw = req.headers['x-file-name'];
  let fileName: string | null = null;
  if (typeof raw === 'string' && raw !== '') {
    try {
      fileName = decodeURIComponent(raw).slice(0, 200);
    } catch {
      fileName = null;
    }
  }
  return { body: read.body, fileName };
}

const flag = z.enum(['true', 'false']).optional();
const blankToNull = (v: unknown): unknown => (v === '' ? null : v);

/** Paramètres du projet à créer (chaînes de requête). */
const NewProjectQuery = z
  .object({
    name: z.string(),
    kind: z.string().optional(),
    description: z.string().optional(),
    ownerUserId: z.string().optional(),
    startDate: z.string().optional(),
    dueDate: z.string().optional(),
    skipInvalid: flag,
  })
  .strict();

@Controller('work')
@RequireFeature('run_work') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class WorkImportController {
  constructor(@Inject(WorkImportService) private readonly imports: WorkImportService) {}

  @Get('import/template.xlsx')
  @RequirePermission('work.read')
  async templateXlsx(@Res() res: Response): Promise<void> {
    const body = await buildImportTemplateXlsx();
    res
      .status(200)
      .set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="modele-import-projet.xlsx"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(body);
  }

  @Get('import/template.csv')
  @RequirePermission('work.read')
  templateCsv(@Res() res: Response): void {
    res
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="modele-import-projet.csv"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(buildImportTemplateCsv());
  }

  @Post('import/preview')
  @HttpCode(200)
  @RequirePermission('work.update')
  @Throttle({ default: { ttl: 3_600_000, limit: IMPORT_UPLOADS_PER_HOUR } })
  @UseGuards(UserThrottlerGuard)
  async preview(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query('projectId') projectId: string | undefined,
    @Req() req: Request,
  ): Promise<WorkImportPreview> {
    const target = projectId ? projectId.toLowerCase() : null;
    if (target !== null && !isWorkId(target)) {
      throw new BadRequestException({ code: 'WORK_ID_INVALID', message: 'Projet invalide.' });
    }
    const { body, fileName } = await fileOf(req);
    const r = await this.imports.preview(orgId, body, fileName, target, workActorOf(user, perms));
    return r.preview;
  }

  @Post('import/projects')
  @HttpCode(201)
  @RequirePermission('work.manage')
  @Throttle({ default: { ttl: 3_600_000, limit: IMPORT_UPLOADS_PER_HOUR } })
  @UseGuards(UserThrottlerGuard)
  async importProject(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
    @Req() req: Request,
  ): Promise<WorkPlanApplyResult> {
    const q = NewProjectQuery.safeParse(query);
    if (!q.success) invalidRequest(q.error, 'Paramètres du projet invalides.');
    const project = WorkPlanProjectSchema.safeParse({
      name: q.data.name,
      kind: q.data.kind ?? 'internal',
      description: q.data.description,
      ownerUserId: blankToNull(q.data.ownerUserId),
      startDate: blankToNull(q.data.startDate),
      dueDate: blankToNull(q.data.dueDate),
    });
    if (!project.success) invalidRequest(project.error, 'Paramètres du projet invalides.');
    const { body, fileName } = await fileOf(req);
    return this.imports.importNewProject(
      orgId,
      body,
      fileName,
      project.data,
      q.data.skipInvalid === 'true',
      workActorOf(user, perms),
    );
  }

  @Post('projects/:projectId/import')
  @HttpCode(201)
  @RequirePermission('work.update')
  @Throttle({ default: { ttl: 3_600_000, limit: IMPORT_UPLOADS_PER_HOUR } })
  @UseGuards(UserThrottlerGuard)
  async importTasks(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('projectId', WorkIdPipe) projectId: string,
    @Query('skipInvalid') skipInvalid: string | undefined,
    @Req() req: Request,
  ): Promise<WorkPlanApplyResult> {
    const { body, fileName } = await fileOf(req);
    return this.imports.importIntoProject(
      orgId,
      projectId,
      body,
      fileName,
      skipInvalid === 'true',
      workActorOf(user, perms),
    );
  }
}
