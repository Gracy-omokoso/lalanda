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
import { MfaGateService } from '../mfa/mfa-gate.service.js';
import { AuthzService, forbidden } from './authz.service.js';
import { REQUIRED_PERMISSIONS_KEY, REQUIRED_PLATFORM_ROLES_KEY } from './authz.decorators.js';
import {
  canAll,
  canAnyPlatform,
  firstDeniedAction,
  platformRolesRequireMfa,
  type Action,
  type PlatformRole,
} from './permissions.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  // @Inject explicites — vitest n'émet pas `emitDecoratorMetadata`.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(MfaGateService) private readonly mfa: MfaGateService,
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
      // ── SECOND FACTEUR (S22h — docs/17 § Identité) ─────────────────────────
      //
      // Ce bloc est le POINT D'APPLICATION UNIQUE de l'exigence de MFA
      // plateforme, et il l'est de façon démontrable : `routes-coverage.test.ts`
      // fait échouer la CI dès qu'une route `/admin` ne déclare aucun rôle
      // plateforme, et toute route qui en déclare un passe forcément ici. Il n'y
      // a donc pas de route plateforme atteignable qui contourne ce contrôle —
      // propriété qu'un contrôle réparti dans les contrôleurs n'aurait pas.
      //
      // La question « ce rôle exige-t-il un facteur ? » n'est pas tranchée ici :
      // elle est lue dans `permissions.ts` (ADR-0012 §8, « aucun `if (role ===
      // …)` hors de permissions.ts »). Ce garde ne fait que l'appliquer.
      //
      // Placé APRÈS la vérification de rôle, et c'est délibéré : quelqu'un sans
      // rôle plateforme doit recevoir « rôle insuffisant » et non « activez le
      // MFA », qui lui apprendrait qu'un second facteur le rapprocherait de
      // `/admin` — ce qui est faux, et ce qui divulgue la forme du contrôle.
      if (platformRolesRequireMfa(held)) {
        const state = await this.mfa.stateOf(userId, req.headers.cookie);
        if (state !== 'satisfied') {
          throw new ForbiddenException(mfaRequired(state, held));
        }
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

/**
 * Corps du refus pour second facteur manquant.
 *
 * Deux codes distincts pour deux situations distinctes — l'interface doit
 * proposer « configurez une application d'authentification » dans un cas et
 * « saisissez votre code » dans l'autre. Un code unique obligerait le client à
 * redemander l'état au serveur pour savoir quoi afficher, c'est-à-dire à
 * reconstruire la distinction que le serveur vient de faire.
 *
 * `403` et non `401` : l'appelant EST authentifié, sa session est valide et son
 * rôle est reconnu. Ce qui manque est une condition d'exercice de ce rôle. Un
 * `401` inviterait les clients HTTP à retenter une connexion, ce qui ne résout
 * rien, et brouillerait le diagnostic avec les vraies expirations de session.
 * (La ré-authentification par mot de passe d'ADR-0013 §5 répond `401
 * REAUTH_REQUIRED` : elle, réclame bien une preuve d'authentification refaite.)
 */
export function mfaRequired(
  state: 'enrollment_required' | 'step_up_required',
  held: readonly PlatformRole[],
): {
  code: 'MFA_ENROLLMENT_REQUIRED' | 'MFA_STEP_UP_REQUIRED';
  message: string;
  roles: string[];
} {
  const roles = [...held];
  if (state === 'enrollment_required') {
    return {
      code: 'MFA_ENROLLMENT_REQUIRED',
      message:
        'Les rôles plateforme exigent une authentification à deux facteurs. ' +
        'Activez-la depuis Compte › Sécurité pour accéder à cet espace.',
      roles,
    };
  }
  return {
    code: 'MFA_STEP_UP_REQUIRED',
    message:
      'Saisissez le code de votre application d’authentification pour ouvrir ' +
      'l’espace plateforme sur cette session.',
    roles,
  };
}
