// Fiche 360° et fil chronologique — règles pures (ADR-0040 § 3.1.2 et § 3.1.3).
// ADR-0040 — C8.
//
// Sans base ni horloge : droits par section, curseur du fil, tri et pagination
// des événements. Le service lit les sources ; ce fichier décide.

import { can, type OrgPermissionContext, type OrgRole } from '../../authz/permissions.js';

// ── Droits par section ──────────────────────────────────────────────────────

/**
 * Sections visibles du demandeur. `crm.read` est exigé par la route ; les ventes
 * (devis, factures, encaissements, solde dû) exigent `sales.read`, les projets RUN
 * `work.read`. Aucune section n'expose de trésorerie : ni compte d'encaissement,
 * ni marge, ni coût (D3) — le Commercial (`sales.read` sans `treasury.read`) voit
 * donc toutes les sections.
 */
export interface OverviewAccess {
  sales: boolean;
  work: boolean;
}

export function overviewAccessOf(role: OrgRole, ctx: OrgPermissionContext): OverviewAccess {
  return { sales: can(role, 'sales.read', ctx), work: can(role, 'work.read', ctx) };
}

/** Section rendue : connue, masquée (droit manquant, jamais de zéros) ou vide. */
export type Section<T> = ({ status: 'known' } & T) | { status: 'hidden' } | { status: 'empty' };

export const HIDDEN = Object.freeze({ status: 'hidden' as const });
export const EMPTY = Object.freeze({ status: 'empty' as const });

// ── Fil chronologique ───────────────────────────────────────────────────────

export const TIMELINE_SOURCES = [
  'activity',
  'opportunity',
  'account',
  'quote',
  'invoice',
  'receipt',
  'project',
] as const;
export type TimelineSource = (typeof TIMELINE_SOURCES)[number];

/** Sources que lit chaque droit (le fil exige `crm.read`, déjà vérifié par la route). */
export const SALES_SOURCES: readonly TimelineSource[] = ['quote', 'invoice', 'receipt'];
export const WORK_SOURCES: readonly TimelineSource[] = ['project'];

export type TimelineEventType =
  | 'activity.created'
  | 'activity.done'
  | 'opportunity.created'
  | 'opportunity.stage_changed'
  | 'opportunity.won'
  | 'opportunity.lost'
  | 'account.created'
  | 'account.converted'
  | 'account.merged'
  | 'quote.created'
  | 'quote.sent'
  | 'quote.accepted'
  | 'quote.refused'
  | 'quote.converted'
  | 'invoice.issued'
  | 'invoice.normalized'
  | 'receipt.recorded'
  | 'receipt.cancelled'
  | 'project.created'
  | 'project.completed';

export interface TimelineEvent {
  /** Identifiant stable de l'événement (document, et rang pour un historique d'étapes). */
  id: string;
  type: TimelineEventType;
  source: TimelineSource;
  at: string;
  /** Document source (activité, opportunité, devis…). */
  refId: string;
  title: string;
  by: string | null;
  details: Record<string, string | number | boolean | null>;
}

export const TIMELINE_PAGE_SIZE = 50;

/** Ordre du fil : date décroissante, puis type, puis identifiant (décroissants). */
export function compareEvents(
  a: { at: string; type: string; id: string },
  b: { at: string; type: string; id: string },
): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  if (a.type !== b.type) return a.type < b.type ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

export interface TimelineCursor {
  at: string;
  type: string;
  id: string;
}

export function encodeTimelineCursor(c: TimelineCursor): string {
  return Buffer.from(JSON.stringify({ t: c.at, k: c.type, i: c.id }), 'utf8').toString('base64url');
}

/** Curseur `(at, type, id)` ; illisible ou altéré : `null` (400 `INVALID_CURSOR`). */
export function decodeTimelineCursor(raw: string): TimelineCursor | null {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(raw)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const { t, k, i } = parsed as Record<string, unknown>;
    if (typeof t !== 'string' || typeof k !== 'string' || typeof i !== 'string') return null;
    const at = new Date(t);
    if (Number.isNaN(at.getTime()) || at.toISOString() !== t) return null;
    const cursor = { at: t, type: k, id: i };
    return encodeTimelineCursor(cursor) === raw ? cursor : null;
  } catch {
    return null;
  }
}

/** Page du fil : événements strictement après le curseur, triés, `limit` au plus. */
export function pageOfEvents(
  events: readonly TimelineEvent[],
  cursor: TimelineCursor | null,
  limit: number = TIMELINE_PAGE_SIZE,
): { items: TimelineEvent[]; nextCursor: string | null } {
  const sorted = [...events].sort(compareEvents);
  const after = cursor ? sorted.filter((e) => compareEvents(e, cursor) > 0) : sorted;
  const items = after.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      after.length > limit && last
        ? encodeTimelineCursor({ at: last.at, type: last.type, id: last.id })
        : null,
  };
}

/**
 * Sources demandées (`types=quote,invoice`, toutes par défaut), puis séparées entre
 * lues et masquées par droit. Une source inconnue : `null` (400).
 */
export function timelineSourcesOf(
  raw: unknown,
  access: OverviewAccess,
): { read: TimelineSource[]; hidden: TimelineSource[] } | null {
  let wanted: TimelineSource[] = [...TIMELINE_SOURCES];
  if (raw !== undefined && raw !== '') {
    if (typeof raw !== 'string') return null;
    const parts = [...new Set(raw.split(',').map((p) => p.trim()))];
    if (parts.some((p) => !(TIMELINE_SOURCES as readonly string[]).includes(p))) return null;
    wanted = TIMELINE_SOURCES.filter((s) => parts.includes(s));
  }
  const denied = (s: TimelineSource) =>
    (!access.sales && SALES_SOURCES.includes(s)) || (!access.work && WORK_SOURCES.includes(s));
  return { read: wanted.filter((s) => !denied(s)), hidden: wanted.filter(denied) };
}
