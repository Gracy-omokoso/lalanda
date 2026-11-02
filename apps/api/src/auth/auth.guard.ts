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
// ADR-0053 — P2
import { InjectConnection } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import type { Connection } from 'mongoose';

import type { OrgPermissionContext, OrgRole } from '../authz/permissions.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { getAuth } from './auth.js';

const ACTIVE_ORG_COOKIE = 'active_org_id';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string; name?: string | null };
  orgId?: string;
  /** Rôle d'organisation résolu par `PermissionsGuard` (S20a) — voir `authz/`. */
  orgRole?: OrgRole;
  /**
   * Contexte de décision du membership, idem : droit de clôture (case ⚙) et, depuis
   * ADR-0041, écart du membre (`grants`, `revokes`). À passer à `can()` avec le rôle.
   */
  orgRoleContext?: OrgPermissionContext;
  /**
   * Organisation réellement évaluée par `PermissionsGuard` : le `:orgId` de la
   * route s'il en porte un, sinon l'organisation active. Distinct de `orgId`,
   * qui reste toujours l'organisation active du cookie.
   */
  targetOrgId?: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  // @Inject explicite — évite de dépendre de `emitDecoratorMetadata` (non émis par vitest).
  constructor(
    @Inject(OrganizationsService) private readonly orgs: OrganizationsService,
    // ADR-0053 — P2 : lecture de `user.disabledAt` (blocage effectif, F5).
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: new Headers(req.headers as Record<string, string>),
    });
    if (!session?.user) {
      throw new UnauthorizedException({ code: 'NOT_AUTHENTICATED' });
    }

    // ── ADR-0053 — P2 : un compte BLOQUÉ n'utilise plus aucune session (F5) ──────
    // Seul un `disabledAt` posé refuse : un compte sans le champ, ou à `null`, passe.
    // Message générique (§ 6.1) : ni qui a bloqué, ni pourquoi.
    if (await isAccountBlocked(this.connection, String(session.user.id))) {
      throw new ForbiddenException({ code: 'ACCOUNT_BLOCKED', message: ACCOUNT_BLOCKED_MESSAGE });
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

// ── ADR-0053 — P2 : blocage effectif ─────────────────────────────────────────

/** Message générique d'un compte bloqué : ne dit ni qui, ni pourquoi (§ 6.1). */
export const ACCOUNT_BLOCKED_MESSAGE = 'Votre compte est bloqué. Contactez le support.';

/**
 * `user.disabledAt` est-il posé ? Champ hors schéma better-auth, lu par le driver natif.
 * Base injoignable : on laisse la lecture de session (déjà faite) trancher, comme avant ;
 * c'est le seul cas où le blocage n'est pas relu.
 */
export async function isAccountBlocked(connection: Connection, userId: string): Promise<boolean> {
  const db = connection.db;
  if (!db) return false;
  const _id = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
  const user = await db
    .collection<{ _id: ObjectId | string; disabledAt?: Date | null }>('user')
    .findOne({ _id }, { projection: { disabledAt: 1 } });
  return user?.disabledAt != null;
}
