// Limite de débit des EXPORTS COMPTABLES (ADR-0049 § 9, motif d'ADR-0042). ADR-0049 — K6.
//
// Deux guards, posés APRÈS `AuthGuard` et `PermissionsGuard` (un refus de droit ne
// consomme rien) : 20 exports par heure et par utilisateur, 60 par heure et par
// organisation. Un export lit tous les livres et peut solliciter le rendu PDF partagé :
// ces plafonds bornent un clic répété ou un script, pas l'usage de l'expert-comptable.
//
// Même patron que `security/document-email-throttler.guard.ts` (stockage du
// `ThrottlerModule`, en mémoire du processus ; `@Throttle` serait lu aussi par le guard
// global par IP). 429 en français, code `ACCOUNTING_EXPORT_RATE_LIMITED`.

import { HttpException, HttpStatus, Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';

import type { AuthenticatedRequest } from '../../auth/auth.guard.js';
import { waitMinutes } from '../../security/normalization-throttler.guard.js';

export const ACCOUNTING_EXPORT_USER_THROTTLE = { ttl: 3_600_000, limit: 20 } as const;
export const ACCOUNTING_EXPORT_ORG_THROTTLE = { ttl: 3_600_000, limit: 60 } as const;
export const ACCOUNTING_EXPORT_THROTTLER_NAME = 'accounting-export';
export const ACCOUNTING_EXPORT_RATE_LIMITED = 'ACCOUNTING_EXPORT_RATE_LIMITED';

export function accountingExportRateLimitMessage(
  scope: 'organization' | 'user',
  retryAfterSeconds: number,
): string {
  const n = waitMinutes(retryAfterSeconds);
  const attente = `Réessayez dans ${n} minute${n > 1 ? 's' : ''}.`;
  return scope === 'organization'
    ? `Votre organisation a atteint la limite de ${ACCOUNTING_EXPORT_ORG_THROTTLE.limit} exports comptables en une heure. ${attente}`
    : `Vous avez atteint la limite de ${ACCOUNTING_EXPORT_USER_THROTTLE.limit} exports comptables en une heure. ${attente}`;
}

abstract class AccountingExportThrottlerGuard extends ThrottlerGuard {
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
      throttler: { name: ACCOUNTING_EXPORT_THROTTLER_NAME, ttl, limit },
      getTracker: async (req) => this.trackerOf(req as unknown as AuthenticatedRequest),
      generateKey: (_ctx, tracker) => `${ACCOUNTING_EXPORT_THROTTLER_NAME}:${tracker}`,
    });
  }

  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfterSeconds = detail.timeToBlockExpire;
    throw new HttpException(
      {
        code: ACCOUNTING_EXPORT_RATE_LIMITED,
        message: accountingExportRateLimitMessage(this.scope, retryAfterSeconds),
        details: { scope: this.scope, limit: detail.limit, retryAfterSeconds },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** 60 exports par heure et par organisation. */
@Injectable()
export class OrgAccountingExportThrottlerGuard extends AccountingExportThrottlerGuard {
  protected readonly scope = 'organization' as const;
  protected readonly quota = ACCOUNTING_EXPORT_ORG_THROTTLE;
  protected trackerOf(req: AuthenticatedRequest): string {
    return `org:${req.orgId ?? 'unknown'}`;
  }
}

/** 20 exports par heure et par utilisateur. */
@Injectable()
export class UserAccountingExportThrottlerGuard extends AccountingExportThrottlerGuard {
  protected readonly scope = 'user' as const;
  protected readonly quota = ACCOUNTING_EXPORT_USER_THROTTLE;
  protected trackerOf(req: AuthenticatedRequest): string {
    return req.user ? `user:${req.user.id}` : `ip:${req.ip ?? 'unknown'}`;
  }
}
