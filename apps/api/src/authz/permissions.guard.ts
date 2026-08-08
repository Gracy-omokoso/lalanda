// Guard d'autorisation (S20a, ADR-0012 §8). S'exécute APRÈS `AuthGuard`, qui a
// rempli `req.user` et `req.orgId` — d'où l'ordre imposé
// `@UseGuards(AuthGuard, PermissionsGuard)`.
//
// Une route sans `@RequirePermission` ni `@RequirePlatformRole` passe : ce guard
// n'ajoute aucune exigence implicite, il applique celles qui sont déclarées. Le
// « refus par défaut » est garanti ailleurs, par le test de couverture des routes
// (`routes-coverage.test.ts`) qui fait échouer la CI sur toute route sensible non
// annotée. Un guard qui refuserait tout par lui-même casserait `/health` et les
// routes pré-organisation (inscription, acceptation d'invitation).

import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { AuthzService, forbidden } from './authz.service.js';
import { REQUIRED_PERMISSIONS_KEY, REQUIRED_PLATFORM_ROLES_KEY } from './authz.decorators.js';
import {
  canAll,
  canAnyPlatform,
  firstDeniedAction,
  type Action,
  type PlatformRole,
} from './permissions.js';

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
      // Les actions sur les données CLIENTES restent barrées par `canPlatform()`,
      // qui exige un accès délégué — voir `canAnyPlatform` ci-dessous.
      if (actions?.length && !actions.every((a) => canAnyPlatform(held, a))) {
        throw new ForbiddenException(forbidden(actions.join('+'), held.join(',')));
      }
      return true;
    }

    // Organisation concernée : celle NOMMÉE DANS LA ROUTE si elle en nomme une
    // (`/organizations/:orgId/…`), sinon l'organisation active du cookie. Sans
    // cela, un membre d'une org A pourrait viser `/organizations/B/members` et
    // être évalué contre son rôle dans A.
    const orgId = this.targetOrgId(req);
    if (!orgId) throw new ForbiddenException({ code: 'NO_ORGANIZATION' });

    const resolved = await this.authz.resolveOrgRole(userId, orgId);
    if (!resolved) {
      // Non-membre de l'organisation visée. 404 et NON 403 : un 403 confirmerait
      // l'existence de l'organisation à un tiers (ADR-0011 Contrat 4, ADR-0012 §8).
      // Le 403 est réservé au rôle insuffisant DANS SA PROPRE organisation.
      throw new NotFoundException({ code: 'ORG_NOT_FOUND' });
    }

    if (!canAll(resolved.role, actions!, resolved.context)) {
      throw new ForbiddenException(
        forbidden(firstDeniedAction(resolved.role, actions!, resolved.context)!, resolved.role),
      );
    }

    // Mémorisés pour les contrôleurs (journalisation d'audit, vues filtrées) —
    // évite une seconde lecture de la membership.
    req.orgRole = resolved.role;
    req.orgRoleContext = resolved.context;
    req.targetOrgId = orgId;
    return true;
  }

  /**
   * `:orgId` de la route s'il existe, sinon l'organisation active.
   *
   * Le nom `orgId` est la convention du projet (`invitations.controller.ts`,
   * `billing.controller.ts`). Une route qui nommerait son paramètre autrement
   * retomberait sur l'organisation active — d'où le test de couverture qui
   * vérifie que tout paramètre d'organisation s'appelle bien `orgId`.
   */
  private targetOrgId(req: AuthenticatedRequest): string | undefined {
    const fromPath = (req.params as Record<string, string> | undefined)?.['orgId'];
    if (typeof fromPath === 'string' && fromPath.length > 0) return fromPath;
    return req.orgId;
  }
}
