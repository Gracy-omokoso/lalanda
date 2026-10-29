// ADR-0041 § 9.3 — droits d'organisation de l'appelant résolus par `PermissionsGuard` :
// son rôle (titre) ET son contexte (droit de clôture, ajouts, retraits). C'est ce couple
// qui DÉCIDE (`can(role, action, context)`) ; `@CurrentOrgRole()` reste pour l'audit et
// l'affichage, plus jamais pour décider.
//
// Comme `@CurrentOrgRole()`, ne fonctionne QUE sur une route portant
// `@RequirePermission` : sans exigence déclarée, le guard ne résout rien et le
// décorateur renvoie `undefined`.

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import type { OrgPermissionContext, OrgRole } from './permissions.js';

export interface CurrentOrgPermissionsValue {
  role: OrgRole;
  context: OrgPermissionContext;
}

export function orgPermissionsOf(
  req: AuthenticatedRequest,
): CurrentOrgPermissionsValue | undefined {
  if (req.orgRole === undefined) return undefined;
  return { role: req.orgRole, context: req.orgRoleContext ?? {} };
}

export const CurrentOrgPermissions = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentOrgPermissionsValue | undefined =>
    orgPermissionsOf(ctx.switchToHttp().getRequest<AuthenticatedRequest>()),
);
