// Débit de la page publique de vérification — ADR-0069 § 4.
//
// Deux seaux, comptés AVANT toute lecture de la base : par EMPREINTE d'IP
// (HMAC, l'adresse n'est jamais conservée, même en mémoire) et par jeton. Même
// patron que le formulaire public de prospects (ADR-0048 § 6).

import { createHmac, hkdfSync } from 'node:crypto';

import { HttpException, HttpStatus, Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';

export const PUBLIC_CARD_THROTTLER_NAME = 'public-card';
/** 30 vérifications par minute et par empreinte d'IP. */
export const PUBLIC_CARD_IP_THROTTLE = { ttl: 60_000, limit: 30 } as const;
/** 60 vérifications par minute et par jeton. */
export const PUBLIC_CARD_TOKEN_THROTTLE = { ttl: 60_000, limit: 60 } as const;

function ipHash(ip: string | undefined): string {
  const racine = process.env['AUTH_SECRET'];
  if (!racine) throw new Error('AUTH_SECRET absente : vérification des cartes indisponible.');
  const key = Buffer.from(hkdfSync('sha256', racine, 'lalanda/public-card-ip', 'v1', 32));
  return createHmac('sha256', key)
    .update(ip && ip.length > 0 ? ip : 'unknown')
    .digest('hex')
    .slice(0, 32);
}

abstract class PublicCardThrottlerGuard extends ThrottlerGuard {
  protected abstract readonly quota: { readonly ttl: number; readonly limit: number };
  protected abstract trackerOf(req: Record<string, unknown>): string;

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const { ttl, limit } = this.quota;
    return this.handleRequest({
      context,
      limit,
      ttl,
      blockDuration: ttl,
      throttler: { name: PUBLIC_CARD_THROTTLER_NAME, ttl, limit },
      getTracker: async (req) => this.trackerOf(req),
      generateKey: (_ctx, tracker) => `${PUBLIC_CARD_THROTTLER_NAME}:${tracker}`,
    });
  }

  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new HttpException(
      {
        code: 'CARD_VERIFY_RATE_LIMITED',
        message: 'Trop de vérifications. Réessayez dans une minute.',
        details: { retryAfterSeconds: detail.timeToBlockExpire },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class PublicCardIpThrottlerGuard extends PublicCardThrottlerGuard {
  protected readonly quota = PUBLIC_CARD_IP_THROTTLE;
  protected trackerOf(req: Record<string, unknown>): string {
    const { ips, ip } = req as { ips?: string[]; ip?: string };
    return `ip:${ipHash(ips?.length ? ips[0] : ip)}`;
  }
}

@Injectable()
export class PublicCardTokenThrottlerGuard extends PublicCardThrottlerGuard {
  protected readonly quota = PUBLIC_CARD_TOKEN_THROTTLE;
  protected trackerOf(req: Record<string, unknown>): string {
    const params = (req['params'] ?? {}) as Record<string, unknown>;
    const token = typeof params['token'] === 'string' ? params['token'].slice(0, 32) : 'unknown';
    return `token:${token}`;
  }
}
