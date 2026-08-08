// Guard d'autorisation (S20a). S'exécute APRÈS `AuthGuard`, qui a rempli
// `req.user` et `req.orgId` — d'où l'ordre imposé `@UseGuards(AuthGuard, PermissionsGuard)`.
//
// Une route sans `@RequirePermission` ni `@RequirePlatformRole` passe : ce guard
// n'ajoute pas d'exigence implicite, il applique celles qui sont déclarées.

import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { AuthzService, forbidden } from './authz.service.js';
import {
  REQUIRED_PERMISSIONS_KEY,
  REQUIRED_PLATFORM_ROLES_KEY,
} from './authz.decorators.js';
import { canAll, firstDeniedAction, type Action, type PlatformRole } from './permissions.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  // @Inject explicites — vitest n'émet pas `emitDecoratorMetadata`.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();

    const platformRoles = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(
      REQUIRED_PLATFORM_ROLES_KEY,
      [handler, controller],
    );
    const actions = this.reflector.getAllAndOverride<Action[] | undefined>(
      REQUIRED_PERMISSIONS_KEY,
      [handler, controller],
    );

    if (!platformRoles?.length && !actions?.length) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = req.user?.id;
    if (!userId) {
      // Signature d'une erreur de câblage : PermissionsGuard sans AuthGuard devant.
      throw new UnauthorizedException({ code: 'NOT_AUTHENTICATED' });
    }

    if (platformRoles?.length) {
      const held = await this.authz.platformRolesOf(userId);
      const granted = platformRoles.some((r) => held.includes(r));
      if (!granted) {
        throw new ForbiddenException(
          forbidden(platformRoles.join('|'), held.length > 0 ? held.join(',') : null),
        );
      }
      // Un rôle plateforme suffit : on n'exige pas en plus une appartenance à l'org.
      return true;
    }

    const orgId = req.orgId;
    if (!orgId) throw new ForbiddenException({ code: 'NO_ORGANIZATION' });

    const role = await this.authz.roleOf(userId, orgId);
    if (!role) {
      // Non-membre : AuthGuard n'aurait pas dû poser cet orgId. Refus explicite.
      throw new ForbiddenException(forbidden(actions![0]!, null));
    }

    if (!canAll(role, actions!)) {
      throw new ForbiddenException(forbidden(firstDeniedAction(role, actions!)!, role));
    }

    // Mémorisé pour les contrôleurs (journalisation d'audit, vues filtrées) —
    // évite une seconde lecture de la membership.
    req.orgRole = role;
    return true;
  }
}
