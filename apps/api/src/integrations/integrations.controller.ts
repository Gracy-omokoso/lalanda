// ─────────────────────────────────────────────────────────────────────────────
// ROUTES `/admin/integrations` — ADR-0013 §4
//
// Cinq routes, pas une de plus. Ce qui N'EXISTE PAS ici est aussi important que
// ce qui y est :
//   - pas de `GET …/reveal`;
//   - pas de paramètre `?includeValues`;
//   - pas de mode debug.
// « En ajouter un est un changement d'ADR. » Le test anti-fuite
// (`no-secret-leak.test.ts`) sérialise la réponse de CHACUNE de ces routes, y
// compris leurs corps d'erreur, et échoue si une valeur en clair s'y trouve.
//
// Toutes exigent : session valide, `platform_super_admin`, et — pour les
// écritures — une ré-authentification de moins de dix minutes.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { RequirePlatformRole } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { INTEGRATION_WRITE_THROTTLE } from '../security/throttling.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import {
  ReauthSchema,
  UpdateIntegrationSchema,
  type UpdateIntegrationInput,
} from './integrations.dto.js';
import {
  IntegrationsService,
  type ActorContext,
  type IntegrationView,
} from './integrations.service.js';
import { isIntegrationProvider, type IntegrationProvider } from './providers.js';
import { ReauthService } from './reauth.service.js';

@Controller('admin/integrations')
@UseGuards(AuthGuard, PermissionsGuard)
// Le rôle est déclaré AU NIVEAU DU CONTRÔLEUR : une route ajoutée demain hérite
// de la contrainte sans que personne n'ait à y penser. `getAllAndOverride` du
// guard remonte au contrôleur quand la méthode ne déclare rien.
@RequirePlatformRole('platform_super_admin')
export class IntegrationsController {
  constructor(
    @Inject(IntegrationsService) private readonly integrations: IntegrationsService,
    @Inject(ReauthService) private readonly reauth: ReauthService,
  ) {}

  /** Liste les cinq fournisseurs, configurés ou non. Vue de lecture uniquement. */
  @Get()
  async list(): Promise<{ integrations: IntegrationView[] }> {
    return { integrations: await this.integrations.list() };
  }

  @Get(':provider')
  async detail(@Param('provider') provider: string): Promise<IntegrationView> {
    return this.integrations.get(assertProvider(provider));
  }

  /**
   * Crée ou met à jour `config` et/ou des secrets.
   *
   * Sémantique de remplacement (ADR-0013 §4) : un secret absent du corps est
   * laissé inchangé, `null` le supprime, une chaîne le remplace.
   */
  @Put(':provider')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: INTEGRATION_WRITE_THROTTLE })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('provider') provider: string,
    @Body() body: unknown,
    @Query('force') force?: string,
  ): Promise<IntegrationView> {
    const target = assertProvider(provider);
    await this.assertReauth(req);
    const parsed = UpdateIntegrationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        // `parsed.error` n'est PAS renvoyé tel quel : Zod recopie la valeur reçue
        // dans certains messages, ce qui remettrait le secret dans la réponse.
        message: 'Corps de requête invalide.',
        fields: parsed.error.issues.map((i) => i.path.join('.')),
      });
    }
    return this.integrations.update(
      target,
      parsed.data as UpdateIntegrationInput,
      actorOf(req),
      force === 'true',
    );
  }

  /** Test de connexion sur les valeurs déjà stockées. Aucune écriture de secret. */
  @Post(':provider/test')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: INTEGRATION_WRITE_THROTTLE })
  async test(
    @Req() req: AuthenticatedRequest,
    @Param('provider') provider: string,
  ): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    const target = assertProvider(provider);
    await this.assertReauth(req);
    return this.integrations.testStored(target, actorOf(req));
  }

  @Delete(':provider/secrets/:name')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: INTEGRATION_WRITE_THROTTLE })
  async deleteSecret(
    @Req() req: AuthenticatedRequest,
    @Param('provider') provider: string,
    @Param('name') name: string,
  ): Promise<IntegrationView> {
    const target = assertProvider(provider);
    await this.assertReauth(req);
    return this.integrations.deleteSecret(target, name, actorOf(req));
  }

  private async assertReauth(req: AuthenticatedRequest): Promise<void> {
    await this.reauth.assertRecent(req.user!.id, req.headers.cookie);
  }
}

/**
 * Ré-authentification, hors du contrôleur d'intégrations : elle ouvre une fenêtre
 * pour l'ensemble de `/admin`, pas pour un fournisseur.
 */
@Controller('admin/reauth')
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePlatformRole('platform_super_admin')
export class ReauthController {
  constructor(@Inject(ReauthService) private readonly reauth: ReauthService) {}

  /** État de la fenêtre courante — l'interface affiche le temps restant. */
  @Get()
  async status(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ active: boolean; expiresAt: string | null }> {
    return this.reauth.statusOf(req.user!.id, req.headers.cookie);
  }

  @Post()
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: INTEGRATION_WRITE_THROTTLE })
  async confirm(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ active: true; expiresAt: string }> {
    const parsed = ReauthSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Mot de passe requis.' });
    }
    const { expiresAt } = await this.reauth.confirm({
      userId: req.user!.id,
      headers: new Headers(req.headers as Record<string, string>),
      cookieHeader: req.headers.cookie,
      password: parsed.data.password,
    });
    return { active: true, expiresAt: expiresAt.toISOString() };
  }
}

function assertProvider(value: string): IntegrationProvider {
  if (!isIntegrationProvider(value)) {
    throw new BadRequestException({
      code: 'UNKNOWN_PROVIDER',
      message: `Fournisseur inconnu : « ${value} ».`,
    });
  }
  return value;
}

function actorOf(req: AuthenticatedRequest): ActorContext {
  return {
    userId: req.user!.id,
    // Le rôle est connu : le guard vient de le vérifier. On l'inscrit en dur
    // plutôt que de relire la base — l'audit doit porter le rôle SOUS LEQUEL
    // l'action a été autorisée, pas celui détenu au moment de la lecture.
    platformRole: 'platform_super_admin',
    ip: req.ip ?? null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  };
}
