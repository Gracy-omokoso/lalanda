// Événements de sécurité agrégés de la console (ADR-0053 § 6.5 — lot P5). Fonctions pures.
//
// ── Ce qu'on retient d'une réponse : sa NATURE, et le jour ───────────────────
//
// `classifySecurityResponse` lit la méthode, le chemin, le statut et le code métier d'une
// réponse déjà envoyée, et rend une nature ou `null`. Le compteur ne garde ensuite que
// `{ jour, nature } → nombre` : ni compte, ni adresse, ni chemin, ni organisation. Une
// réponse d'organisation n'est comptée que pour `ACCOUNT_BLOCKED` (une session ouverte
// avant le blocage, refusée ensuite) — jamais pour ce qu'elle contenait.

import {
  PLATFORM_AUDIT_LIMITS,
  PLATFORM_SECURITY_EVENT_KINDS,
  PLATFORM_SECURITY_EVENTS,
  type PlatformSecurityEventKind,
  type PlatformSecuritySummaryView,
} from '@lalanda/shared/platform';

/** Natures relevées sur les réponses (les autres viennent du journal plateforme). */
export type SecurityCounterKind = Extract<
  PlatformSecurityEventKind,
  | 'blocked_session_refused'
  | 'console_forbidden'
  | 'console_rate_limited'
  | 'reauth_succeeded'
  | 'reauth_failed'
  | 'reauth_required'
  | 'gesture_refused'
>;

/** Refus de séparation des tâches (§ 5.3) : le geste est refusé, pas le droit. */
const GESTES_REFUSES = new Set([
  'PLATFORM_SELF_DEALING',
  'SELF_GRANT_FORBIDDEN',
  'SELF_DEMOTION_FORBIDDEN',
  'SELF_DISABLE_FORBIDDEN',
  'SELF_APPROVAL_FORBIDDEN',
]);

/** Les deux routes qui ouvrent une fenêtre de ré-authentification (ADR-0013 § 5). */
const REAUTH = /^\/(?:admin|me)\/reauth\/?$/;
const CONSOLE = /^\/admin(?:\/|$)/;

export interface ObservedResponse {
  method: string;
  /** Chemin SANS chaîne de requête. */
  path: string;
  status: number;
  /** `code` du corps JSON, s'il y en a un. */
  code?: string | null;
}

export function classifySecurityResponse(r: ObservedResponse): SecurityCounterKind | null {
  const code = r.code ?? null;
  // Partout : une session antérieure au blocage, refusée (§ 6.1, F5).
  if (r.status === 403 && code === 'ACCOUNT_BLOCKED') return 'blocked_session_refused';

  if (REAUTH.test(r.path) && r.method.toUpperCase() === 'POST') {
    if (r.status >= 200 && r.status < 300) return 'reauth_succeeded';
    if (r.status === 401 || r.status === 403) return 'reauth_failed';
    return null;
  }

  if (!CONSOLE.test(r.path)) return null;
  if (r.status === 401 && code === 'REAUTH_REQUIRED') return 'reauth_required';
  if (r.status === 403) return 'console_forbidden';
  if (r.status === 409 && code !== null && GESTES_REFUSES.has(code)) return 'gesture_refused';
  if (r.status === 429) return 'console_rate_limited';
  return null;
}

// ── Période ────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** Jour UTC `AAAA-MM-JJ`. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type SecurityPeriod =
  { ok: true; from: string; to: string; start: Date; end: Date } | { ok: false; message: string };

/**
 * Jours inclus `[from, to]`. Par défaut, les 30 derniers jours jusqu'à aujourd'hui ; au
 * plus 92 jours ; `from` après `to` ou un `to` dans le futur lointain sont refusés.
 */
export function securityPeriod(
  from: string | undefined,
  to: string | undefined,
  now: Date,
): SecurityPeriod {
  const fin = to ?? utcDay(now);
  const debut =
    from ??
    utcDay(
      new Date(
        new Date(`${fin}T00:00:00.000Z`).getTime() -
          (PLATFORM_AUDIT_LIMITS.securityDefaultDays - 1) * DAY_MS,
      ),
    );
  const start = new Date(`${debut}T00:00:00.000Z`);
  const endInclusive = new Date(`${fin}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endInclusive.getTime())) {
    return { ok: false, message: 'Période invalide.' };
  }
  if (start > endInclusive) return { ok: false, message: 'Le début suit la fin de la période.' };
  const jours = Math.round((endInclusive.getTime() - start.getTime()) / DAY_MS) + 1;
  if (jours > PLATFORM_AUDIT_LIMITS.securityMaxDays) {
    return {
      ok: false,
      message: `Période de ${PLATFORM_AUDIT_LIMITS.securityMaxDays} jours au plus.`,
    };
  }
  return { ok: true, from: debut, to: fin, start, end: new Date(endInclusive.getTime() + DAY_MS) };
}

// ── Synthèse ───────────────────────────────────────────────────────────────────

const zeros = (): Record<PlatformSecurityEventKind, number> =>
  Object.fromEntries(PLATFORM_SECURITY_EVENT_KINDS.map((k) => [k, 0])) as Record<
    PlatformSecurityEventKind,
    number
  >;

/** Action du journal plateforme → nature (`account_blocked` ← `user.disabled`, …). */
export const SECURITY_AUDIT_ACTIONS: ReadonlyMap<string, PlatformSecurityEventKind> = new Map(
  PLATFORM_SECURITY_EVENT_KINDS.flatMap((k) => {
    const def = PLATFORM_SECURITY_EVENTS[k];
    return def.source === 'audit' && def.auditAction ? [[def.auditAction, k] as const] : [];
  }),
);

export function buildSecuritySummary(input: {
  from: string;
  to: string;
  counters: readonly { day: string; kind: string; count: number }[];
  audit: readonly { day: string; action: string; count: number }[];
  blockedAccountsNow: number;
}): PlatformSecuritySummaryView {
  const jours: string[] = [];
  for (
    let t = new Date(`${input.from}T00:00:00.000Z`).getTime();
    t <= new Date(`${input.to}T00:00:00.000Z`).getTime();
    t += DAY_MS
  ) {
    jours.push(utcDay(new Date(t)));
  }
  const parJour = new Map(jours.map((d) => [d, zeros()]));
  const totals = zeros();
  const ajouter = (day: string, kind: PlatformSecurityEventKind, n: number) => {
    const ligne = parJour.get(day);
    if (!ligne || !Number.isFinite(n) || n <= 0) return;
    ligne[kind] += n;
    totals[kind] += n;
  };
  const connues = new Set<string>(PLATFORM_SECURITY_EVENT_KINDS);
  for (const c of input.counters) {
    // Seules les natures de source `counter` viennent des compteurs.
    if (connues.has(c.kind)) {
      const kind = c.kind as PlatformSecurityEventKind;
      if (PLATFORM_SECURITY_EVENTS[kind].source === 'counter') ajouter(c.day, kind, c.count);
    }
  }
  for (const a of input.audit) {
    const kind = SECURITY_AUDIT_ACTIONS.get(a.action);
    if (kind) ajouter(a.day, kind, a.count);
  }
  return {
    from: input.from,
    to: input.to,
    kinds: PLATFORM_SECURITY_EVENT_KINDS,
    days: jours.map((day) => ({ day, counts: parJour.get(day)! })),
    totals,
    blockedAccountsNow: Math.max(0, Math.trunc(input.blockedAccountsNow)),
  };
}
