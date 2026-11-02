// Décorateurs d'autorisation (S20a). Ils ne font que POSER des métadonnées :
// toute la décision vit dans `PermissionsGuard` + `permissions.ts`.

import { SetMetadata, applyDecorators, type CustomDecorator } from '@nestjs/common';

import type { Action, PlatformRole } from './permissions.js';
// ADR-0053 — P0
import { platformActionHolders, type PlatformAction } from './platform-actions.js';

export const REQUIRED_PERMISSIONS_KEY = 'lalanda:required_permissions';
export const REQUIRED_PLATFORM_ROLES_KEY = 'lalanda:required_platform_roles';

/**
 * Exige une ou plusieurs actions granulaires sur l'organisation active.
 *
 * Sémantique **conjonctive** : `@RequirePermission('period.close', 'plan.approve')`
 * exige les DEUX (cas de la réouverture de période, docs/12 § Règles critiques).
 * Pour un « l'un ou l'autre », déclarer deux routes — un OU implicite masque
 * toujours une règle métier.
 *
 * Refus → `403 { code: 'FORBIDDEN', action, role }`.
 */
export function RequirePermission(...actions: [Action, ...Action[]]): CustomDecorator<string> {
  return SetMetadata(REQUIRED_PERMISSIONS_KEY, actions);
}

/**
 * Exige un rôle PLATEFORME (indépendant de toute appartenance à une organisation).
 * Sémantique **disjonctive** : détenir l'un des rôles listés suffit.
 * Destiné aux routes `/admin` à venir.
 *
 * Refus → `403 { code: 'FORBIDDEN', action, role }` où `action` est la liste des
 * rôles exigés et `role` les rôles plateforme réellement détenus.
 */
export function RequirePlatformRole(
  ...roles: [PlatformRole, ...PlatformRole[]]
): CustomDecorator<string> {
  return SetMetadata(REQUIRED_PLATFORM_ROLES_KEY, roles);
}

// ── ADR-0053 — P0 : console Lalanda ──────────────────────────────────────────

export const REQUIRED_PLATFORM_ACTIONS_KEY = 'lalanda:required_platform_actions';
export const PLATFORM_CONSOLE_ROUTE_KEY = 'lalanda:platform_console_route';

/**
 * Exige une action PLATEFORME (ADR-0053 § 5.1), jugée par `PermissionsGuard` contre
 * `PLATFORM_ACTION_MATRIX`. Jamais d'action d'organisation ici, jamais de rôle
 * d'organisation : un membre, Propriétaire compris, sans rôle plateforme reçoit 403.
 *
 * Pose AUSSI la liste des rôles détenteurs (`REQUIRED_PLATFORM_ROLES_KEY`), dérivée de la
 * matrice : pendant la version de transition où `@RequirePlatformRole` reste accepté, une
 * route déclarée par action se lit exactement comme une route déclarée par rôles (test de
 * couverture, `PermissionsGuard`), sans seconde source de vérité. Posé sur une méthode, il
 * remplace le plancher de rôles du contrôleur pour cette route.
 */
export function RequirePlatformAction(action: PlatformAction): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(REQUIRED_PLATFORM_ACTIONS_KEY, [action]),
    SetMetadata(REQUIRED_PLATFORM_ROLES_KEY, platformActionHolders(action)),
  );
}

/**
 * Marque explicitement une route (ou un contrôleur) de la CONSOLE : la seule qui puisse
 * passer par `PlatformAuthGuard`, garde qui n'exige aucune organisation. Sans ce marqueur,
 * `PlatformAuthGuard` refuse (`403 PLATFORM_ROUTE_REQUIRED`) : une route d'organisation ne
 * devient jamais accessible sans organisation par erreur de câblage.
 */
export function PlatformConsoleRoute(): CustomDecorator<string> {
  return SetMetadata(PLATFORM_CONSOLE_ROUTE_KEY, true);
}

// ── ADR-0053 — P2 : session de console de 12 heures d'inactivité ───────────────

export const CONSOLE_IDLE_EXEMPT_KEY = 'lalanda:console_idle_exempt';

/**
 * Exempte une route de console du contrôle d'inactivité de 12 heures (§ 2.4) : la SEULE
 * à en porter est la ré-authentification (`/admin/reauth`), qui rouvre la console après
 * une inactivité — sans elle, une session de console expirée ne se rouvrirait jamais.
 */
export function AllowIdleConsoleSession(): CustomDecorator<string> {
  return SetMetadata(CONSOLE_IDLE_EXEMPT_KEY, true);
}

// ── ADR-0053 — P8 : double authentification de la console ────────────────────

export const PLATFORM_TWO_FACTOR_EXEMPT_KEY = 'lalanda:platform_two_factor_exempt';

/**
 * Exemption du contrôle de double authentification de `PlatformAuthGuard` :
 *   - `'enrollment'` : route ouverte à un opérateur NON enrôlé (lecture de son état,
 *     enrôlement lui-même, `/me/platform-access`) — sans elle, aucun chemin d'enrôlement ;
 *   - `'verification'` : route ouverte à un opérateur enrôlé dont la session n'est pas
 *     encore vérifiée — la SEULE est `/admin/reauth`, qui la vérifie.
 * Toute autre route de console exige un opérateur enrôlé ET une session vérifiée.
 */
export function AllowPlatformTwoFactorPending(
  level: 'enrollment' | 'verification',
): CustomDecorator<string> {
  return SetMetadata(PLATFORM_TWO_FACTOR_EXEMPT_KEY, level);
}
