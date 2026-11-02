// Règles pures des octrois manuels (ADR-0053 § 6.2 — lot P3). Zéro Mongoose : la
// seconde personne elle-même est jugée par `platformGrantDecision` (P0) ; ici, ce qui
// dépend seulement du document et du temps.

import type { Plan } from '../../billing/entitlements.js';
import type { PlanGrantStatus } from './plan-grant.schema.js';

/** Phase LUE d'un octroi : le statut écrit, plus ce que le temps en a fait. */
export type PlanGrantPhase = 'pending_approval' | 'scheduled' | 'active' | 'expired' | 'revoked';

export interface PlanGrantTimeline {
  readonly status: PlanGrantStatus;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
}

export function planGrantPhase(grant: PlanGrantTimeline, now: Date): PlanGrantPhase {
  if (grant.status === 'revoked') return 'revoked';
  if (grant.status === 'pending_approval') return 'pending_approval';
  if (grant.endsAt && grant.endsAt.getTime() <= now.getTime()) return 'expired';
  if (grant.startsAt.getTime() > now.getTime()) return 'scheduled';
  return 'active';
}

/**
 * Un octroi « ouvert » empêche d'en créer un second pour la même organisation : une
 * demande en attente, un octroi programmé ou en vigueur. Un seul octroi à la fois —
 * l'opérateur retire l'ancien avant d'en poser un autre, geste motivé et visible.
 */
export function isPlanGrantOpen(grant: PlanGrantTimeline, now: Date): boolean {
  const phase = planGrantPhase(grant, now);
  return phase === 'pending_approval' || phase === 'scheduled' || phase === 'active';
}

export type PlanGrantPeriodDecision =
  | { readonly ok: true; readonly startsAt: Date; readonly endsAt: Date | null }
  | { readonly ok: false; readonly code: 'GRANT_PLAN_INVALID' | 'GRANT_PERIOD_INVALID' };

/**
 * Offre et période d'un octroi. `free` n'est pas un octroi (revenir au gratuit, c'est
 * retirer l'octroi) ; la fin, si elle est donnée, suit le début et n'est pas passée.
 */
export function planGrantPeriod(input: {
  readonly plan: Plan;
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly now: Date;
}): PlanGrantPeriodDecision {
  if (input.plan === 'free') return { ok: false, code: 'GRANT_PLAN_INVALID' };
  const startsAt = input.startsAt ? new Date(input.startsAt) : input.now;
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (Number.isNaN(startsAt.getTime())) return { ok: false, code: 'GRANT_PERIOD_INVALID' };
  if (endsAt !== null) {
    if (Number.isNaN(endsAt.getTime())) return { ok: false, code: 'GRANT_PERIOD_INVALID' };
    if (endsAt.getTime() <= startsAt.getTime() || endsAt.getTime() <= input.now.getTime()) {
      return { ok: false, code: 'GRANT_PERIOD_INVALID' };
    }
  }
  return { ok: true, startsAt, endsAt };
}
