// Rôle d'organisation résolu par `PermissionsGuard`. Ne fonctionne QUE sur une
// route portant `@RequirePermission` — sans exigence déclarée, le guard ne résout
// aucun rôle et le décorateur renvoie `undefined`.

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import type { OrgRole } from './permissions.js';

export const CurrentOrgRole = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrgRole | undefined => {
    return ctx.switchToHttp().getRequest<AuthenticatedRequest>().orgRole;
  },
);
