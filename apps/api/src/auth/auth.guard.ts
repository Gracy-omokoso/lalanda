// Guard qui extrait la session better-auth depuis les cookies de la requête
// et attache `req.user` + `req.orgId`. 401 si non authentifié, 403 si aucune org.

import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';

import { OrganizationsService } from '../organizations/organizations.service.js';
import { getAuth } from './auth.js';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string; name?: string | null };
  orgId?: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  // @Inject explicite — évite de dépendre de `emitDecoratorMetadata` (non émis par vitest).
  constructor(@Inject(OrganizationsService) private readonly orgs: OrganizationsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: new Headers(req.headers as Record<string, string>),
    });
    if (!session?.user) {
      throw new UnauthorizedException({ code: 'NOT_AUTHENTICATED' });
    }

    req.user = {
      id: String(session.user.id),
      email: session.user.email,
      name: session.user.name ?? null,
    };

    const primaryOrg = await this.orgs.findPrimaryOrgForUser(req.user.id);
    if (!primaryOrg) {
      throw new ForbiddenException({ code: 'NO_ORGANIZATION' });
    }
    req.orgId = primaryOrg.id;

    return true;
  }
}
