// Limite de débit de la NORMALISATION des factures (ADR-0024 § 6, amendement du
// 21 oct. 2026).
//
// Deux seaux, deux guards, posés APRÈS `AuthGuard` (qui renseigne `req.user` et
// `req.orgId`) :
//
// - `OrgNormalizationThrottlerGuard` : 60 envois par heure et par ORGANISATION,
//   seau COMMUN à `POST …/normalize` et `POST …/normalization/retry` (les deux
//   envoient une facture à la DGI avec le jeton du contribuable). Plusieurs
//   caissiers d'une même entreprise partagent ce plafond ;
// - `UserNormalizationThrottlerGuard` : 60 par heure et par UTILISATEUR, par
//   route (`normalize`, `retry`, `check`) — le quota historique d'ADR-0024 § 6.
//
// Pourquoi pas `@Throttle({ default: … })` : ce décorateur est lu aussi par le
// guard global par IP, qui appliquerait alors 60 par heure à toute l'adresse —
// un cabinet comptable qui sert plusieurs organisations derrière un même NAT se
// bloquerait lui-même. Ces guards portent leur limite en propre et laissent le
// guard global à sa règle (100 par minute et par IP).
//
// Stockage : celui du `ThrottlerModule` (mémoire du processus, une seule
// instance d'API en production — pas de Redis à ce jour). Plusieurs instances
// multiplieraient le plafond par leur nombre : à revoir avec un stockage
// partagé le jour où l'API se réplique.
//
// La campagne d'homologation (`apps/api/src/edef/homologation/**`) appelle
// `InvoiceFreezingService.normalize` directement, sans HTTP : elle n'est pas
// comptée.

import { HttpException, HttpStatus, Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { INVOICE_NORMALIZE_ORG_THROTTLE, INVOICE_NORMALIZE_THROTTLE } from './throttling.js';

/** Nom du seau, distinct de `default` : jamais confondu avec le quota global. */
export const NORMALIZATION_THROTTLER_NAME = 'normalization';

/** Code d'erreur du 429 (`INVOICE_ERROR_CODES[429]`). */
export const NORMALIZATION_RATE_LIMITED = 'NORMALIZATION_RATE_LIMITED';

/** Minutes d'attente annoncées, arrondies au-dessus (au moins une). */
export function waitMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

/** Message français du 429, selon le seau atteint. */
export function rateLimitMessage(
  scope: 'organization' | 'user',
  retryAfterSeconds: number,
): string {
  const n = waitMinutes(retryAfterSeconds);
  const attente = `Réessayez dans ${n} minute${n > 1 ? 's' : ''}.`;
  return scope === 'organization'
    ? `Votre organisation a atteint la limite de ${INVOICE_NORMALIZE_ORG_THROTTLE.limit} ` +
        `normalisations par heure auprès de la DGI. ${attente}`
    : `Vous avez atteint la limite de ${INVOICE_NORMALIZE_THROTTLE.limit} demandes de ` +
        `normalisation par heure. ${attente}`;
}

abstract class NormalizationThrottlerGuard extends ThrottlerGuard {
  protected abstract readonly scope: 'organization' | 'user';
  protected abstract readonly quota: { readonly ttl: number; readonly limit: number };

  /** Clé du demandeur (`org:…`, `user:…`). */
  protected abstract trackerOf(req: AuthenticatedRequest): string;

  /** Clé de stockage : par défaut propre à la route (classe + méthode). */
  protected keyOf(context: ExecutionContext, tracker: string): string {
    return `${NORMALIZATION_THROTTLER_NAME}:${context.getClass().name}.${context.getHandler().name}:${tracker}`;
  }

  // Les options du module ne sont pas lues : la limite est celle du guard.
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const { ttl, limit } = this.quota;
    return this.handleRequest({
      context,
      limit,
      ttl,
      blockDuration: ttl,
      throttler: { name: NORMALIZATION_THROTTLER_NAME, ttl, limit },
      getTracker: async (req) => this.trackerOf(req as unknown as AuthenticatedRequest),
      generateKey: (ctx, tracker) => this.keyOf(ctx, tracker),
    });
  }

  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfterSeconds = detail.timeToBlockExpire;
    throw new HttpException(
      {
        code: NORMALIZATION_RATE_LIMITED,
        message: rateLimitMessage(this.scope, retryAfterSeconds),
        details: { scope: this.scope, limit: detail.limit, retryAfterSeconds },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** 60 envois par heure et par organisation, seau commun à `normalize` et `retry`. */
@Injectable()
export class OrgNormalizationThrottlerGuard extends NormalizationThrottlerGuard {
  protected readonly scope = 'organization' as const;
  protected readonly quota = INVOICE_NORMALIZE_ORG_THROTTLE;

  protected trackerOf(req: AuthenticatedRequest): string {
    // Sans organisation (impossible derrière AuthGuard), tous partagent un seau
    // plutôt que d'échapper à la limite — même règle que les autres trackers.
    return `org:${req.orgId ?? 'unknown'}`;
  }

  // Un seul seau par organisation, quelle que soit la route.
  protected override keyOf(_context: ExecutionContext, tracker: string): string {
    return `${NORMALIZATION_THROTTLER_NAME}:submit:${tracker}`;
  }
}

/** 60 par heure et par utilisateur, par route (`normalize`, `retry`, `check`). */
@Injectable()
export class UserNormalizationThrottlerGuard extends NormalizationThrottlerGuard {
  protected readonly scope = 'user' as const;
  protected readonly quota = INVOICE_NORMALIZE_THROTTLE;

  protected trackerOf(req: AuthenticatedRequest): string {
    return req.user ? `user:${req.user.id}` : `ip:${req.ip ?? 'unknown'}`;
  }
}
