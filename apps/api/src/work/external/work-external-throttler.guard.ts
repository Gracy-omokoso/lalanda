// Limites de débit de la connexion à l'espace externe — ADR-0078 § 3.
//
// Quatre seaux (motif de `lead-form-throttler.guard.ts`) : demandes de code par adresse
// et par IP, vérifications par adresse et par IP. Les clés sont des EMPREINTES salées
// (`emailBucket`, `ipBucket`) : ni adresse ni IP en clair, même en mémoire. Comptés
// AVANT toute lecture de la base ; s'ajoutent au garde global (100 req/min par IP).
// Le nombre d'essais PAR CODE est tenu à part, en base (`attempts` du défi).

import { WORK_EXTERNAL_AUTH } from '@lalanda/shared/work';
import { HttpException, HttpStatus, Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';

import { clientIpOf } from '../../crm/lead-forms/lead-form-throttler.guard.js';
import { waitMinutes } from '../../security/normalization-throttler.guard.js';
import { emailBucket, ipBucket } from './work-external-crypto.js';

export const EXTERNAL_THROTTLER_NAME = 'external-auth';

function emailOf(req: Record<string, unknown>): string {
  const body = (req['body'] ?? {}) as Record<string, unknown>;
  return typeof body['email'] === 'string' ? body['email'].slice(0, 254) : '';
}

abstract class ExternalAuthThrottlerGuard extends ThrottlerGuard {
  protected abstract readonly limit: number;
  protected abstract readonly bucket: string;
  protected abstract trackerOf(req: Record<string, unknown>): string;

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const ttl = WORK_EXTERNAL_AUTH.windowMs;
    const limit = this.limit;
    return this.handleRequest({
      context,
      limit,
      ttl,
      blockDuration: ttl,
      throttler: { name: EXTERNAL_THROTTLER_NAME, ttl, limit },
      getTracker: async (req) => this.trackerOf(req),
      generateKey: (_ctx, tracker) => `${EXTERNAL_THROTTLER_NAME}:${this.bucket}:${tracker}`,
    });
  }

  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const n = waitMinutes(detail.timeToBlockExpire);
    throw new HttpException(
      {
        code: 'EXTERNAL_RATE_LIMITED',
        message: `Trop de tentatives. Réessayez dans ${n} minute${n > 1 ? 's' : ''}.`,
        details: { retryAfterSeconds: detail.timeToBlockExpire },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class ExternalRequestIpThrottlerGuard extends ExternalAuthThrottlerGuard {
  protected readonly limit = WORK_EXTERNAL_AUTH.requestsPerIp;
  protected readonly bucket = 'request-ip';
  protected trackerOf(req: Record<string, unknown>): string {
    return ipBucket(clientIpOf(req as { ips?: string[]; ip?: string }));
  }
}

@Injectable()
export class ExternalRequestEmailThrottlerGuard extends ExternalAuthThrottlerGuard {
  protected readonly limit = WORK_EXTERNAL_AUTH.requestsPerEmail;
  protected readonly bucket = 'request-email';
  protected trackerOf(req: Record<string, unknown>): string {
    return emailBucket(emailOf(req));
  }
}

@Injectable()
export class ExternalVerifyIpThrottlerGuard extends ExternalAuthThrottlerGuard {
  protected readonly limit = WORK_EXTERNAL_AUTH.verifiesPerIp;
  protected readonly bucket = 'verify-ip';
  protected trackerOf(req: Record<string, unknown>): string {
    return ipBucket(clientIpOf(req as { ips?: string[]; ip?: string }));
  }
}

@Injectable()
export class ExternalVerifyEmailThrottlerGuard extends ExternalAuthThrottlerGuard {
  protected readonly limit = WORK_EXTERNAL_AUTH.verifiesPerEmail;
  protected readonly bucket = 'verify-email';
  protected trackerOf(req: Record<string, unknown>): string {
    return emailBucket(emailOf(req));
  }
}
