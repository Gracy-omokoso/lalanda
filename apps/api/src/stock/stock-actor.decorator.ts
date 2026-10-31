// Acteur d'une requête des stocks (ADR-0046 § 5). ADR-0046 — S3.
//
// Réunit l'utilisateur, le rôle (audit) et les droits EFFECTIFS résolus par
// `PermissionsGuard` (décision). Comme `@CurrentOrgPermissions()`, ne vaut que sur une
// route portant `@RequirePermission`.

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { orgPermissionsOf } from '../authz/current-org-permissions.decorator.js';
import type { StockActor } from './stock.common.js';

export const CurrentStockActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): StockActor => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const perms = orgPermissionsOf(req);
    return {
      userId: req.user?.id ?? '',
      role: perms?.role ?? 'unknown',
      perms,
    };
  },
);
