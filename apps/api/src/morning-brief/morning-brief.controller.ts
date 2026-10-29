// Points d'API du brief du matin (ADR-0033 § 9).
//
//   GET  /morning-brief                faits, alertes, recommandations     analytics.read
//   POST /morning-brief/explanation    explication par l'IA, vérifiée      analytics.read + quota + débit IA
//   GET  /morning-brief/preferences    e-mail quotidien de l'appelant      analytics.read
//   PUT  /morning-brief/preferences                                        analytics.read
//   PUT  /morning-brief/settings       IA du brief pour l'organisation     organization.manage
//
// L'organisation est TOUJOURS celle de la session (`@CurrentOrgId`), jamais un
// champ du corps ou de l'URL : aucune route ne permet de demander le brief
// d'une autre organisation.

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import type { MorningBrief } from '@lalanda/engine';

import type { AiQuotaStatus } from '../billing/ai-quota.js';
import { AiQuotaService } from '../ai/ai-quota.service.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { AuditService } from '../authz/audit.service.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { can, NO_OVERRIDES, type OrgRole } from '../authz/permissions.js';
import { AI_THROTTLE } from '../security/throttling.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import { BRIEF_INTENTS, MENTION_BRIEF } from './morning-brief-ai.js';
import { MorningBriefAiService, type BriefAnswerView } from './morning-brief-ai.service.js';
import { MorningBriefService, type MorningBriefPreferences } from './morning-brief.service.js';

export const ExplanationRequestSchema = z.object({ intent: z.enum(BRIEF_INTENTS) }).strict();
export const PreferencesRequestSchema = z.object({ emailDaily: z.boolean() }).strict();
export const SettingsRequestSchema = z.object({ aiEnabled: z.boolean() }).strict();

export interface MorningBriefView {
  brief: MorningBrief;
  ai: {
    enabled: boolean;
    disabledBy: 'organization' | 'platform' | null;
    /** `null` si le quota n'a pas pu être lu : l'écran n'affiche alors pas de compteur. */
    quota: AiQuotaStatus | null;
    mention: string;
  };
  /** L'appelant peut-il activer ou désactiver l'IA du brief pour l'organisation ? */
  canManageAi: boolean;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
  }
  return parsed.data;
}

@Controller('morning-brief')
@UseGuards(AuthGuard, PermissionsGuard)
export class MorningBriefController {
  constructor(
    @Inject(MorningBriefService) private readonly service: MorningBriefService,
    @Inject(MorningBriefAiService) private readonly ai: MorningBriefAiService,
    @Inject(AiQuotaService) private readonly quota: AiQuotaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('analytics.read')
  async get(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
  ): Promise<MorningBriefView> {
    // Repli sur `viewer` : moindre privilège si la membership a changé entre le
    // guard et le handler (même position que l'espace organisation).
    const effective = role ?? 'viewer';
    const [brief, disabledBy, quota] = await Promise.all([
      this.service.build(orgId, effective, user.id),
      this.service.aiDisabledBy(orgId),
      this.quota.status(orgId).catch(() => null),
    ]);
    return {
      brief,
      ai: { enabled: disabledBy === null, disabledBy, quota, mention: MENTION_BRIEF },
      canManageAi: can(effective, 'organization.manage', NO_OVERRIDES),
    };
  }

  @Post('explanation')
  @RequirePermission('analytics.read')
  @Throttle({ default: AI_THROTTLE })
  @UseGuards(UserThrottlerGuard)
  async explanation(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<BriefAnswerView> {
    const { intent } = parse(ExplanationRequestSchema, body);
    const now = new Date();
    // Le brief est RECALCULÉ ici, pour ce rôle : le client n'envoie aucun fait,
    // il ne peut donc ni en inventer un, ni en glisser un d'une autre organisation.
    const [brief, disabledBy] = await Promise.all([
      this.service.build(orgId, role ?? 'viewer', user.id, now),
      this.service.aiDisabledBy(orgId),
    ]);
    return this.ai.answer(
      { organizationId: orgId, userId: user.id, disabledBy },
      brief,
      intent,
      now,
    );
  }

  @Get('preferences')
  @RequirePermission('analytics.read')
  async getPreferences(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
  ): Promise<MorningBriefPreferences> {
    return this.service.preferences(orgId, user.id);
  }

  @Put('preferences')
  @RequirePermission('analytics.read')
  async putPreferences(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @Body() body: unknown,
  ): Promise<MorningBriefPreferences> {
    const { emailDaily } = parse(PreferencesRequestSchema, body);
    return this.service.setEmailDaily(orgId, user.id, emailDaily);
  }

  @Put('settings')
  @RequirePermission('organization.manage')
  async putSettings(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<MorningBriefPreferences> {
    const { aiEnabled } = parse(SettingsRequestSchema, body);
    await this.service.setAiEnabled(orgId, aiEnabled, user.id);
    await this.audit.record({
      organizationId: orgId,
      actorUserId: user.id,
      actorRole: role ?? 'unknown',
      action: 'morning_brief.settings.updated',
      targetType: 'organization',
      targetId: orgId,
      metadata: { aiEnabled },
    });
    return this.service.preferences(orgId, user.id);
  }
}
