// Guard qui extrait la session better-auth depuis les cookies de la requête
// et attache `req.user` + `req.orgId`. 401 si non authentifié, 403 si aucune org.
//
// Résolution de l'org active :
// 1. Cookie `active_org_id` présent + user est membre → cette org.
// 2. Sinon → org primaire (owner d'abord, puis membership la plus ancienne).
// 3. Aucune org → 403 (jamais atteint en prod car auto-provision à l'inscription).

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

const ACTIVE_ORG_COOKIE = 'active_org_id';

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

    // Cookie `active_org_id` prioritaire, mais on vérifie que l'utilisateur en est membre
    // (sinon on ignore silencieusement pour ne pas révéler l'existence d'orgs externes).
    const requestedOrgId = extractCookie(req.headers.cookie, ACTIVE_ORG_COOKIE);
    if (requestedOrgId) {
      const isMember = await this.orgs.isMember(req.user.id, requestedOrgId);
      if (isMember) {
        req.orgId = requestedOrgId;
        return true;
      }
    }

    const primaryOrg = await this.orgs.findPrimaryOrgForUser(req.user.id);
    if (!primaryOrg) {
      throw new ForbiddenException({ code: 'NO_ORGANIZATION' });
    }
    req.orgId = primaryOrg.id;

    return true;
  }
}

/** Parse un cookie du header `Cookie: a=b; c=d`. */
function extractCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('=') ?? '') || undefined;
  }
  return undefined;
}
