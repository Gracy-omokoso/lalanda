// Limite de débit des soumissions publiques — ADR-0048 § 6.
//
// Deux seaux : par IP CLIENTE (toutes pages réunies) et par FORMULAIRE (jeton).
// La clé du seau par IP est l'EMPREINTE salée de l'adresse, jamais l'adresse :
// même en mémoire, aucune IP en clair n'est conservée (§ 7). Compté AVANT toute
// lecture de la base. Même patron que `document-email-throttler.guard.ts`
// (`@Throttle` serait lu aussi par le garde global par IP).

import { HttpException, HttpStatus, Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';

import { waitMinutes } from '../../security/normalization-throttler.guard.js';
import { LEAD_FORM_FORM_THROTTLE, LEAD_FORM_IP_THROTTLE } from '../../security/throttling.js';
import { leadFormIpHash } from './lead-form-crypto.js';

export const LEAD_FORM_THROTTLER_NAME = 'lead-form';

/** Adresse cliente réelle (chaîne de confiance S22f), comme le garde global. */
export function clientIpOf(req: { ips?: string[]; ip?: string }): string | undefined {
  return req.ips?.length ? req.ips[0] : req.ip;
}

abstract class LeadFormThrottlerGuard extends ThrottlerGuard {
  protected abstract readonly quota: { readonly ttl: number; readonly limit: number };
  protected abstract trackerOf(req: Record<string, unknown>): string;

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const { ttl, limit } = this.quota;
    return this.handleRequest({
      context,
      limit,
      ttl,
      blockDuration: ttl,
      throttler: { name: LEAD_FORM_THROTTLER_NAME, ttl, limit },
      getTracker: async (req) => this.trackerOf(req),
      generateKey: (_ctx, tracker) => `${LEAD_FORM_THROTTLER_NAME}:${tracker}`,
    });
  }

  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const n = waitMinutes(detail.timeToBlockExpire);
    throw new HttpException(
      {
        code: 'LEAD_FORM_RATE_LIMITED',
        message: `Trop de demandes envoyées. Réessayez dans ${n} minute${n > 1 ? 's' : ''}.`,
        details: { retryAfterSeconds: detail.timeToBlockExpire },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** 5 envois par 10 minutes et par empreinte d'IP. */
@Injectable()
export class LeadFormIpThrottlerGuard extends LeadFormThrottlerGuard {
  protected readonly quota = LEAD_FORM_IP_THROTTLE;
  protected trackerOf(req: Record<string, unknown>): string {
    return `ip:${leadFormIpHash(clientIpOf(req as { ips?: string[]; ip?: string }))}`;
  }
}

/** 60 envois par heure et par formulaire. */
@Injectable()
export class LeadFormFormThrottlerGuard extends LeadFormThrottlerGuard {
  protected readonly quota = LEAD_FORM_FORM_THROTTLE;
  protected trackerOf(req: Record<string, unknown>): string {
    const params = (req['params'] ?? {}) as Record<string, unknown>;
    const token = typeof params['token'] === 'string' ? params['token'].slice(0, 64) : 'unknown';
    return `form:${token}`;
  }
}
