// Endpoints du Business Model Canvas (S18d — docs/05).
//
//   GET /projects/:id/canvas           → canvas courant (blocs vides + version 0 si jamais sauvegardé)
//   PUT /projects/:id/canvas           → remplacement complet, version incrémentée + révision
//   GET /projects/:id/canvas/revisions → 20 dernières révisions (snapshot, auteur, date)
//
// Isolation : toutes les routes passent par `projects.findScoped(id, orgId)` — un
// projet d'une autre org renvoie 404 (jamais 403, même convention que plans/).

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { ProjectsService } from '../projects/projects.service.js';
import { PutCanvasSchema } from './canvas.dto.js';
import {
  emptyCanvasBlocks,
  type CanvasBlocks,
  type CanvasDocument,
  type CanvasRevisionDocument,
} from './canvas.schema.js';
import { CanvasService } from './canvas.service.js';

export interface CanvasView {
  projectId: string;
  version: number;
  blocs: CanvasBlocks;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface CanvasRevisionView {
  version: number;
  blocs: CanvasBlocks;
  savedBy: string;
  savedAt: string;
}

@Controller('projects')
@UseGuards(AuthGuard, PermissionsGuard)
export class CanvasController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(CanvasService) private readonly canvas: CanvasService,
  ) {}

  @Get(':id/canvas')
  @RequirePermission('project.read')
  async get(@CurrentOrgId() orgId: string, @Param('id') id: string): Promise<CanvasView> {
    const project = await this.projects.findScoped(id, orgId);
    const doc = await this.canvas.find(orgId, String(project._id));
    if (!doc) {
      // Jamais sauvegardé : état initial éditable, pas un 404 — l'UI part d'un canvas vide.
      return {
        projectId: String(project._id),
        version: 0,
        blocs: emptyCanvasBlocks(),
        updatedBy: null,
        updatedAt: null,
      };
    }
    return toView(doc);
  }

  @Put(':id/canvas')
  @RequirePermission('canvas.update')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CanvasView> {
    // Scope AVANT validation : un appelant d'une autre org doit recevoir 404,
    // même avec un corps malformé. L'ordre inverse lui répondrait 400 et
    // confirmerait au passage l'existence du projet.
    const project = await this.projects.findScoped(id, orgId);
    const parsed = PutCanvasSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    const doc = await this.canvas.replace(orgId, String(project._id), user.id, parsed.data);
    return toView(doc);
  }

  @Get(':id/canvas/revisions')
  @RequirePermission('project.read')
  async revisions(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
  ): Promise<{ revisions: CanvasRevisionView[] }> {
    const project = await this.projects.findScoped(id, orgId);
    const docs = await this.canvas.listRevisions(orgId, String(project._id));
    return {
      revisions: docs.map((r: CanvasRevisionDocument) => ({
        version: r.version,
        blocs: r.blocs,
        savedBy: r.savedBy,
        savedAt: r.createdAt.toISOString(),
      })),
    };
  }
}

function toView(doc: CanvasDocument): CanvasView {
  return {
    projectId: doc.projectId,
    version: doc.version,
    blocs: doc.blocs,
    updatedBy: doc.updatedBy,
    updatedAt: doc.updatedAt.toISOString(),
  };
}
