// Idea Lab et validation d'idée (ADR-0036 § 6).
//
//   GET    /idea-lab/ideas                                   project.read   liste, comparaison, grille, IA
//   POST   /idea-lab/ideas                                   canvas.update  nouvelle idée
//   GET    /idea-lab/ideas/:id                               project.read   fiche, score, expériences
//   PUT    /idea-lab/ideas/:id                               canvas.update  fiche (remplacement)
//   PUT    /idea-lab/ideas/:id/archived                      canvas.update  archiver / réactiver
//   PUT    /idea-lab/ideas/:id/ratings/:criterionId          canvas.update  note + preuve
//   DELETE /idea-lab/ideas/:id/ratings/:criterionId          canvas.update
//   POST   /idea-lab/ideas/:id/experiments                   canvas.update  expérience
//   PUT    /idea-lab/ideas/:id/experiments/:experimentId     canvas.update
//   DELETE /idea-lab/ideas/:id/experiments/:experimentId     canvas.update
//   POST   /idea-lab/ideas/:id/promote                       canvas.update  cartes vers le Canvas d'un projet
//   POST   /idea-lab/ideas/:id/assist                        canvas.update  + quota + débit IA
//   PUT    /idea-lab/settings                                organization.manage
//
// Organisation active seulement (cookie) ; une idée d'une autre organisation → 404.
// Aucune action RBAC nouvelle : ADR-0036 O4.

import { Body, Controller, Delete, Get, Inject, Param, Post, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { AiQuotaService } from '../ai/ai-quota.service.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { AuditService } from '../authz/audit.service.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../authz/current-org-permissions.decorator.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { can, NO_OVERRIDES, type OrgRole } from '../authz/permissions.js';
import type { AiQuotaStatus } from '../billing/ai-quota.js';
import { AI_THROTTLE } from '../security/throttling.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import { IDEA_ASSIST_INTENTS, MENTION_IDEA_LAB } from './idea-lab-ai.js';
import { IdeaLabAiService, type IdeaAssistView } from './idea-lab-ai.service.js';
import {
  ArchivedSchema,
  ExperimentSchema,
  IdeaFicheSchema,
  parseBody,
  PromoteSchema,
  RatingSchema,
  SettingsSchema,
} from './idea-lab.dto.js';
import {
  IdeaLabService,
  type IdeaActor,
  type IdeaListView,
  type IdeaView,
  type PromotionView,
} from './idea-lab.service.js';

export const AssistSchema = z.object({ intent: z.enum(IDEA_ASSIST_INTENTS) }).strict();

export interface IdeaLabListResponse extends IdeaListView {
  ai: {
    enabled: boolean;
    disabledBy: 'organization' | 'platform' | null;
    /** `null` si le quota n'a pas pu être lu : l'écran n'affiche alors pas de compteur. */
    quota: AiQuotaStatus | null;
    mention: string;
  };
  /** Droits de l'appelant, pour l'affichage (l'API refuse de toute façon). */
  canEdit: boolean;
  canManageAi: boolean;
}

function actorOf(user: { id: string }, role: OrgRole | undefined): IdeaActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

@Controller('idea-lab')
@UseGuards(AuthGuard, PermissionsGuard)
export class IdeaLabController {
  constructor(
    @Inject(IdeaLabService) private readonly ideas: IdeaLabService,
    @Inject(IdeaLabAiService) private readonly ai: IdeaLabAiService,
    @Inject(AiQuotaService) private readonly quota: AiQuotaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get('ideas')
  @RequirePermission('project.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
  ): Promise<IdeaLabListResponse> {
    // ADR-0041 § 9.4 (A3) : droits effectifs (titre + écart) ; repli de moindre
    // privilège sur le Lecteur sans écart.
    const { role: effective, context } = perms ?? {
      role: 'viewer' as const,
      context: NO_OVERRIDES,
    };
    const [view, disabledBy, quota] = await Promise.all([
      this.ideas.list(orgId),
      this.ai.aiDisabledBy(orgId),
      this.quota.status(orgId).catch(() => null),
    ]);
    return {
      ...view,
      ai: { enabled: disabledBy === null, disabledBy, quota, mention: MENTION_IDEA_LAB },
      canEdit: can(effective, 'canvas.update', context),
      canManageAi: can(effective, 'organization.manage', context),
    };
  }

  @Post('ideas')
  @RequirePermission('canvas.update')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<IdeaView> {
    return this.ideas.create(orgId, parseBody(IdeaFicheSchema, body), actorOf(user, role));
  }

  @Get('ideas/:id')
  @RequirePermission('project.read')
  async get(@CurrentOrgId() orgId: string, @Param('id') id: string): Promise<IdeaView> {
    return this.ideas.get(orgId, id);
  }

  @Put('ideas/:id')
  @RequirePermission('canvas.update')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<IdeaView> {
    // Portée AVANT validation : une autre organisation reçoit 404, même avec un corps faux.
    await this.ideas.get(orgId, id);
    return this.ideas.update(orgId, id, parseBody(IdeaFicheSchema, body), actorOf(user, role));
  }

  @Put('ideas/:id/archived')
  @RequirePermission('canvas.update')
  async archive(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<IdeaView> {
    const { archived } = parseBody(ArchivedSchema, body);
    return this.ideas.setArchived(orgId, id, archived, actorOf(user, role));
  }

  @Put('ideas/:id/ratings/:criterionId')
  @RequirePermission('canvas.update')
  async rate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Param('criterionId') criterionId: string,
    @Body() body: unknown,
  ): Promise<IdeaView> {
    await this.ideas.get(orgId, id);
    return this.ideas.rate(
      orgId,
      id,
      criterionId,
      parseBody(RatingSchema, body),
      actorOf(user, role),
    );
  }

  @Delete('ideas/:id/ratings/:criterionId')
  @RequirePermission('canvas.update')
  async clearRating(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Param('criterionId') criterionId: string,
  ): Promise<IdeaView> {
    return this.ideas.clearRating(orgId, id, criterionId, actorOf(user, role));
  }

  @Post('ideas/:id/experiments')
  @RequirePermission('canvas.update')
  async addExperiment(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<IdeaView> {
    await this.ideas.get(orgId, id);
    return this.ideas.addExperiment(
      orgId,
      id,
      parseBody(ExperimentSchema, body),
      actorOf(user, role),
    );
  }

  @Put('ideas/:id/experiments/:experimentId')
  @RequirePermission('canvas.update')
  async updateExperiment(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Param('experimentId') experimentId: string,
    @Body() body: unknown,
  ): Promise<IdeaView> {
    await this.ideas.get(orgId, id);
    return this.ideas.updateExperiment(
      orgId,
      id,
      experimentId,
      parseBody(ExperimentSchema, body),
      actorOf(user, role),
    );
  }

  @Delete('ideas/:id/experiments/:experimentId')
  @RequirePermission('canvas.update')
  async deleteExperiment(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Param('experimentId') experimentId: string,
  ): Promise<IdeaView> {
    return this.ideas.deleteExperiment(orgId, id, experimentId, actorOf(user, role));
  }

  @Post('ideas/:id/promote')
  @RequirePermission('canvas.update')
  async promote(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PromotionView> {
    await this.ideas.get(orgId, id);
    const { projectId } = parseBody(PromoteSchema, body);
    return this.ideas.promote(orgId, id, projectId, actorOf(user, role));
  }

  @Post('ideas/:id/assist')
  @RequirePermission('canvas.update')
  @Throttle({ default: AI_THROTTLE })
  @UseGuards(UserThrottlerGuard)
  async assist(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<IdeaAssistView> {
    // La fiche est RELUE ici : le client n'envoie aucun texte, il ne peut donc
    // ni glisser celui d'une autre organisation, ni un contenu hors fiche.
    const { ideaId, input } = await this.ideas.aiInput(orgId, id);
    const { intent } = parseBody(AssistSchema, body);
    const disabledBy = await this.ai.aiDisabledBy(orgId);
    return this.ai.assist(
      { organizationId: orgId, userId: user.id, ideaId, disabledBy },
      input,
      intent,
    );
  }

  @Put('settings')
  @RequirePermission('organization.manage')
  async putSettings(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<{ aiEnabled: boolean; disabledBy: 'organization' | 'platform' | null }> {
    const { aiEnabled } = parseBody(SettingsSchema, body);
    await this.ai.setAiEnabled(orgId, aiEnabled, user.id);
    await this.audit.record({
      organizationId: orgId,
      actorUserId: user.id,
      actorRole: role ?? 'unknown',
      action: 'idea_lab.settings.updated',
      targetType: 'organization',
      targetId: orgId,
      metadata: { aiEnabled },
    });
    const disabledBy = await this.ai.aiDisabledBy(orgId);
    return { aiEnabled: disabledBy === null, disabledBy };
  }
}
