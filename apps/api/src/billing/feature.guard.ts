// ─────────────────────────────────────────────────────────────────────────────
// GARDE DES FONCTIONNALITÉS PAR OFFRE (ADR-0053 § 6.3 — lot P4)
//
// `@RequireFeature('crm')` sur un contrôleur pose la clé ET ajoute `FeatureGuard` à
// la liste de ses gardes. Une ligne par contrôleur, placée AU-DESSUS de
// `@UseGuards(AuthGuard, PermissionsGuard)` : les décorateurs de classe s'appliquent
// de bas en haut et `UseGuards` AJOUTE à la liste, donc la garde s'exécute APRÈS
// `PermissionsGuard` (ordre imposé par l'ADR, vérifié par `feature.guard.test.ts`).
//
// ── Ce que la garde refuse, et ce qu'elle laisse ─────────────────────────────
//
// - Lecture (`GET`, `HEAD`, `OPTIONS`) : toujours permise. Une limite porte sur les
//   gestes futurs, jamais sur le patrimoine (docs/13).
// - Fonctionnalité ouverte à TOUTES les offres (la grille actuelle, entièrement
//   ouverte) : permise sans aucune lecture en base. C'est ce qui garantit qu'après ce
//   lot chaque organisation garde exactement son accès.
// - Sinon : offre effective de l'organisation évaluée, puis dérogation active ; refus
//   `403 FEATURE_NOT_IN_PLAN` avec l'offre minimale.
//
// ── Câblage ──────────────────────────────────────────────────────────────────
//
// `FeatureAccessService` vient de `FeaturesModule` (@Global). Il est `@Optional` pour
// qu'un module de test monté sans lui démarre ; mais une case FERMÉE sans service est
// une erreur de câblage, et la garde REFUSE alors (jamais d'ouverture par défaut).
// ─────────────────────────────────────────────────────────────────────────────

import {
  applyDecorators,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Optional,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { isFeatureGatedMethod, PLAN_CATALOG, type FeatureKey } from '@lalanda/shared/pricing';

import { FeatureAccessService } from '../admin/features/feature-access.service.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';

export const REQUIRED_FEATURE_KEY = 'lalanda:required_feature';

@Injectable()
export class FeatureGuard implements CanActivate {
  // @Inject explicites — vitest n'émet pas `emitDecoratorMetadata`.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Optional()
    @Inject(FeatureAccessService)
    private readonly features?: FeatureAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<FeatureKey | undefined>(REQUIRED_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!isFeatureGatedMethod(req.method)) return true;

    if (!this.features) {
      throw new InternalServerErrorException({
        code: 'FEATURE_GUARD_MISWIRED',
        message: 'Garde des fonctionnalités sans service : refus par sécurité.',
      });
    }
    if (this.features.isOpenEverywhere(feature)) return true;

    const orgId = req.targetOrgId ?? req.orgId;
    if (!req.user || !orgId) {
      // `AuthGuard` et `PermissionsGuard` doivent précéder : refus, jamais de passage.
      throw new UnauthorizedException({ code: 'NOT_AUTHENTICATED' });
    }
    const decision = await this.features.decide(orgId, feature);
    if (decision.allowed) return true;
    throw new ForbiddenException({
      code: decision.code,
      feature,
      minimalPlan: decision.minimalPlan,
      message:
        decision.minimalPlan === null
          ? 'Cette fonctionnalité n’est comprise dans aucune offre.'
          : `Cette fonctionnalité est disponible avec l’offre ${PLAN_CATALOG[decision.minimalPlan].name}.`,
    });
  }
}

/**
 * Soumet les ÉCRITURES du contrôleur (ou de la route) à la fonctionnalité `key` du
 * catalogue `FEATURES`. À poser au-dessus de `@UseGuards(AuthGuard, PermissionsGuard)`.
 */
export function RequireFeature(key: FeatureKey): ClassDecorator & MethodDecorator {
  return applyDecorators(SetMetadata(REQUIRED_FEATURE_KEY, key), UseGuards(FeatureGuard));
}
