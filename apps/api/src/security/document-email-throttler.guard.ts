// Limite de débit de l'ENVOI DES DOCUMENTS DE VENTE PAR E-MAIL (ADR-0042 § 6).
//
// Deux guards, posés APRÈS `AuthGuard` et `PermissionsGuard` (un refus de droit
// ne consomme rien) : 20 envois par heure et par utilisateur, 100 par heure et
// par organisation. Un SEUL seau par portée, commun à `POST /sales/invoices/:id/email`
// et `POST /sales/quotes/:id/email` : changer de route ne remet pas le compteur à zéro.
//
// Même patron que `normalization-throttler.guard.ts` (et pour la même raison :
// `@Throttle` serait lu aussi par le guard global par IP). Stockage du
// `ThrottlerModule`, en mémoire du processus — une seule instance d'API.

import { HttpException, HttpStatus, Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { waitMinutes } from './normalization-throttler.guard.js';
import { DOCUMENT_EMAIL_ORG_THROTTLE, DOCUMENT_EMAIL_USER_THROTTLE } from './throttling.js';

export const DOCUMENT_EMAIL_THROTTLER_NAME = 'document-email';

/** Code d'erreur du 429. */
export const DOCUMENT_EMAIL_RATE_LIMITED = 'DOCUMENT_EMAIL_RATE_LIMITED';

export function documentEmailRateLimitMessage(
  scope: 'organization' | 'user',
  retryAfterSeconds: number,
): string {
  const n = waitMinutes(retryAfterSeconds);
  const attente = `Réessayez dans ${n} minute${n > 1 ? 's' : ''}.`;
  return scope === 'organization'
    ? `Votre organisation a atteint la limite de ${DOCUMENT_EMAIL_ORG_THROTTLE.limit} ` +
        `documents envoyés par e-mail en une heure. ${attente}`
    : `Vous avez atteint la limite de ${DOCUMENT_EMAIL_USER_THROTTLE.limit} documents ` +
        `envoyés par e-mail en une heure. ${attente}`;
}

abstract class DocumentEmailThrottlerGuard extends ThrottlerGuard {
  protected abstract readonly scope: 'organization' | 'user';
  protected abstract readonly quota: { readonly ttl: number; readonly limit: number };
  protected abstract trackerOf(req: AuthenticatedRequest): string;

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const { ttl, limit } = this.quota;
    return this.handleRequest({
      context,
      limit,
      ttl,
      blockDuration: ttl,
      throttler: { name: DOCUMENT_EMAIL_THROTTLER_NAME, ttl, limit },
      getTracker: async (req) => this.trackerOf(req as unknown as AuthenticatedRequest),
      // Seau commun aux deux routes : la clé ne dépend que du demandeur.
      generateKey: (_ctx, tracker) => `${DOCUMENT_EMAIL_THROTTLER_NAME}:${tracker}`,
    });
  }

  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfterSeconds = detail.timeToBlockExpire;
    throw new HttpException(
      {
        code: DOCUMENT_EMAIL_RATE_LIMITED,
        message: documentEmailRateLimitMessage(this.scope, retryAfterSeconds),
        details: { scope: this.scope, limit: detail.limit, retryAfterSeconds },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** 100 envois par heure et par organisation. */
@Injectable()
export class OrgDocumentEmailThrottlerGuard extends DocumentEmailThrottlerGuard {
  protected readonly scope = 'organization' as const;
  protected readonly quota = DOCUMENT_EMAIL_ORG_THROTTLE;
  protected trackerOf(req: AuthenticatedRequest): string {
    return `org:${req.orgId ?? 'unknown'}`;
  }
}

/** 20 envois par heure et par utilisateur. */
@Injectable()
export class UserDocumentEmailThrottlerGuard extends DocumentEmailThrottlerGuard {
  protected readonly scope = 'user' as const;
  protected readonly quota = DOCUMENT_EMAIL_USER_THROTTLE;
  protected trackerOf(req: AuthenticatedRequest): string {
    return req.user ? `user:${req.user.id}` : `ip:${req.ip ?? 'unknown'}`;
  }
}
