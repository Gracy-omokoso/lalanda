// Décorateurs de paramètre pour accéder à l'utilisateur et l'organisation courants.
// Doivent être utilisés en tandem avec AuthGuard qui remplit `req.user` et `req.orgId`.

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest } from './auth.guard.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedRequest['user'] => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.user;
  },
);

export const CurrentOrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.orgId) {
      throw new Error(
        'CurrentOrgId utilisé sans AuthGuard actif — décoration invalide côté contrôleur.',
      );
    }
    return req.orgId;
  },
);
