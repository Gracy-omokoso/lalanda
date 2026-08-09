// Décorateurs d'autorisation (S20a). Ils ne font que POSER des métadonnées :
// toute la décision vit dans `PermissionsGuard` + `permissions.ts`.

import { SetMetadata, type CustomDecorator } from '@nestjs/common';

import type { Action, PlatformRole } from './permissions.js';

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
