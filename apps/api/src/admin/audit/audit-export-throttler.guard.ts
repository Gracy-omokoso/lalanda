// Limite de débit de l'export du journal plateforme (ADR-0053 § 6.5 — lot P5).
//
// Posé APRÈS `PlatformAuthGuard` et `PermissionsGuard` (un refus de droit ne consomme
// rien) : 10 exports par heure et par opérateur. Même patron que
// `accounting/exports/export-throttler.guard.ts` (stockage du `ThrottlerModule`, en
// mémoire du processus). 429 en français, code `PLATFORM_AUDIT_EXPORT_RATE_LIMITED`.

import { HttpException, HttpStatus, Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';

import {
  PLATFORM_AUDIT_EXPORT_RATE_LIMITED,
  PLATFORM_AUDIT_LIMITS,
} from '@lalanda/shared/platform';

import type { AuthenticatedRequest } from '../../auth/auth.guard.js';
import { waitMinutes } from '../../security/normalization-throttler.guard.js';

export const PLATFORM_AUDIT_EXPORT_THROTTLE = {
  ttl: 3_600_000,
  limit: PLATFORM_AUDIT_LIMITS.exportPerHour,
} as const;
const NOM = 'platform-audit-export';

@Injectable()
export class PlatformAuditExportThrottlerGuard extends ThrottlerGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const { ttl, limit } = PLATFORM_AUDIT_EXPORT_THROTTLE;
    return this.handleRequest({
      context,
      limit,
      ttl,
      blockDuration: ttl,
      throttler: { name: NOM, ttl, limit },
      getTracker: async (req) => {
        const { user, ip } = req as unknown as AuthenticatedRequest;
        return user ? `user:${user.id}` : `ip:${ip ?? 'unknown'}`;
      },
      generateKey: (_ctx, tracker) => `${NOM}:${tracker}`,
    });
  }

  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const n = waitMinutes(detail.timeToBlockExpire);
    throw new HttpException(
      {
        code: PLATFORM_AUDIT_EXPORT_RATE_LIMITED,
        message: `Vous avez atteint la limite de ${PLATFORM_AUDIT_EXPORT_THROTTLE.limit} exports du journal en une heure. Réessayez dans ${n} minute${n > 1 ? 's' : ''}.`,
        details: { limit: detail.limit, retryAfterSeconds: detail.timeToBlockExpire },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
