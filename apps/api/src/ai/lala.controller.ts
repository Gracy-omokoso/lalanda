// Points d'API de l'assistant Lala (S24a).
//
//   POST /ai/interpretations   — la lecture attachée à chaque résultat
//   POST /ai/lala/messages     — l'échange ouvert depuis une interprétation
//
// Même protection que `/ai/corrective-actions` (S16a) : authentification
// obligatoire, permission `analytics.read`, et quota technique AI_THROTTLE
// appliqué par IP (guard global) ET par utilisateur (`UserThrottlerGuard`).
//
// ── COUTURE POUR LE QUOTA D'OFFRE (chantier « offres », en parallèle) ────────
//
// Le quota de messages Lala par mois selon l'abonnement N'EST PAS implémenté
// ici — il appartient au chantier offres. Deux points d'accroche lui sont
// laissés, et rien d'autre ne bouge :
//
//  1. **Le garde.** Chaque méthode déclare sa pile de guards dans cet ordre :
//     `AuthGuard` → `PermissionsGuard` (au niveau du contrôleur), puis
//     `UserThrottlerGuard` (au niveau de la méthode). Un `AiQuotaGuard` s'ajoute
//     à la suite du `@UseGuards` de la méthode : il s'exécute donc APRÈS
//     l'authentification, avec `req.user` et `req.orgId` déjà résolus, et
//     AVANT le service — c'est-à-dire avant tout appel facturé. Refuser tôt,
//     c'est refuser sans consommer.
//  2. **Le compteur.** `AiUsageService.record` est déjà appelé après la réponse
//     avec `{ organizationId, userId, action, source }`. Les actions portent des
//     noms STABLES — `ai.interpretations` et `ai.lala_chat` — pour qu'un quota
//     mensuel puisse les compter sans dépendre d'une chaîne écrite au hasard.
//     `source` distingue déjà un appel réellement facturé (`llm`) d'un repli
//     déterministe (`fallback`) : un utilisateur dont l'IA est indisponible ne
//     doit pas voir son quota entamé.
//
// Le comptage reste APRÈS la réponse du service, comme dans
// `ai-actions.controller.ts`, et pour la même raison : c'est le seul moment où
// l'on sait si l'appel a été facturé.

import { BadRequestException, Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AccountService } from '../account/account.service.js';
import type { SupportedLocale } from '../account/account.dto.js';
import { AiUsageService } from '../admin/ai-usage.service.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { AI_THROTTLE } from '../security/throttling.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import {
  ChatRequestSchema,
  InterpretationsRequestSchema,
  type ChatResponse,
  type InterpretationsResponse,
} from './lala.dto.js';
import { LalaService } from './lala.service.js';

/** Noms d'action du journal de consommation — STABLES, voir la couture ci-dessus. */
export const ACTION_INTERPRETATIONS = 'ai.interpretations';
export const ACTION_CHAT = 'ai.lala_chat';

@Controller('ai')
@UseGuards(AuthGuard, PermissionsGuard)
export class LalaController {
  constructor(
    @Inject(LalaService) private readonly service: LalaService,
    @Inject(AiUsageService) private readonly usage: AiUsageService,
    @Inject(AccountService) private readonly account: AccountService,
  ) {}

  @Post('interpretations')
  @RequirePermission('analytics.read')
  @Throttle({ default: AI_THROTTLE })
  @UseGuards(UserThrottlerGuard)
  async interpretations(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<InterpretationsResponse> {
    const parsed = InterpretationsRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    const locale = await this.locale(req);
    const result = await this.service.interpretations(parsed.data, locale);
    await this.compte(req, ACTION_INTERPRETATIONS, result.source);
    return result;
  }

  @Post('lala/messages')
  @RequirePermission('analytics.read')
  @Throttle({ default: AI_THROTTLE })
  @UseGuards(UserThrottlerGuard)
  async chat(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<ChatResponse> {
    const parsed = ChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    const locale = await this.locale(req);
    const result = await this.service.chat(parsed.data, locale);
    await this.compte(req, ACTION_CHAT, result.source);
    return result;
  }

  /**
   * Langue de réponse de Lala.
   *
   * Lue dans les préférences de l'utilisateur, JAMAIS dans le corps de la
   * requête : la langue d'une personne n'est pas un paramètre que son navigateur
   * négocie appel par appel. Une lecture qui échoue ne doit pas empêcher de
   * répondre — on retombe alors sur la langue par défaut, comme
   * `AccountService` le fait déjà pour un compte sans préférences.
   */
  private async locale(req: AuthenticatedRequest): Promise<SupportedLocale | undefined> {
    const userId = req.user?.id;
    if (!userId) return undefined;
    try {
      const prefs = await this.account.getPreferences(userId);
      return prefs.locale;
    } catch {
      return undefined;
    }
  }

  private async compte(
    req: AuthenticatedRequest,
    action: string,
    source: 'llm' | 'fallback',
  ): Promise<void> {
    await this.usage.record({
      organizationId: req.orgId ?? 'inconnue',
      userId: req.user?.id ?? 'inconnu',
      action,
      source,
    });
  }
}
