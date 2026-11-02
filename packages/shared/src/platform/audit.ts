// Journal plateforme et événements de sécurité de la console (ADR-0053 § 6.5, § 7 — lot P5).
//
// ── Ce que le journal montre, et ce qu'il tait ───────────────────────────────
//
// Qui a fait quoi, sur quelle cible, quand, et pourquoi (le motif) — § 2.5. Jamais un
// contenu métier d'organisation : ni montant, ni libellé, ni donnée RH ; jamais une
// adresse IP en clair. La liste blanche des métadonnées servies vit côté API
// (`apps/api/src/admin/audit/audit-view.ts`) ; ce fichier porte les contrats partagés.
//
// ── Événements de sécurité : des COMPTES par jour, rien d'autre ──────────────
//
// Aucun identifiant de compte, aucune adresse, aucune route précise : un compteur par
// jour (UTC) et par nature. Les natures `counter` sont relevées sur les réponses de
// l'API ; les natures `audit` sont comptées dans le journal plateforme lui-même.

import { z } from 'zod';

import { PLATFORM_VIEW_REASONS } from './constants.js';

export const PLATFORM_AUDIT_LIMITS = {
  /** Page du journal : 100 par défaut, 500 au plus. */
  pageDefault: 100,
  pageMax: 500,
  /** Un export porte sur 5 000 lignes au plus ; au-delà, resserrer les filtres. */
  exportMaxRows: 5_000,
  /** Exports par heure et par opérateur (limite de débit). */
  exportPerHour: 10,
  /** Événements de sécurité : 30 jours par défaut, 92 au plus. */
  securityDefaultDays: 30,
  securityMaxDays: 92,
} as const;

/** Action du journal plateforme qui trace un export du journal lui-même (§ 2.5). */
export const PLATFORM_AUDIT_EXPORTED_ACTION = 'platform.audit.exported';

/** Code du refus `429` de l'export. */
export const PLATFORM_AUDIT_EXPORT_RATE_LIMITED = 'PLATFORM_AUDIT_EXPORT_RATE_LIMITED';

// ── Filtres ────────────────────────────────────────────────────────────────────

/** Une chaîne de requête vide vaut « absente » (`?action=` envoyé par un formulaire). */
const vide = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const code = (max: number, motif: RegExp, message: string) =>
  z.preprocess(vide, z.string().trim().max(max).regex(motif, message).optional());

/** Jour (`AAAA-MM-JJ`, UTC) ou instant ISO 8601. */
const borne = z.preprocess(
  vide,
  z
    .union([z.iso.date(), z.iso.datetime({ offset: true })], {
      error: 'Date attendue au format AAAA-MM-JJ ou ISO 8601.',
    })
    .optional(),
);

const filtres = {
  action: code(120, /^[A-Za-z0-9_.:-]+$/, 'Action invalide.'),
  actorUserId: code(64, /^[A-Za-z0-9_:-]+$/, 'Acteur invalide.'),
  targetType: code(60, /^[A-Za-z0-9_.:-]+$/, 'Type de cible invalide.'),
  targetId: code(120, /^[A-Za-z0-9_.:@-]+$/, 'Cible invalide.'),
  from: borne,
  to: borne,
};

/** `GET /admin/audit-events` : filtres combinés en ET, page bornée, curseur opaque. */
export const PlatformAuditQuerySchema = z.object({
  ...filtres,
  before: code(80, /^[0-9TZ:.+-]+_[0-9a-f]{24}$/i, 'Curseur invalide.'),
  limit: z.preprocess(
    vide,
    z.coerce.number().int().min(1).max(PLATFORM_AUDIT_LIMITS.pageMax).optional(),
  ),
});
export type PlatformAuditQuery = z.infer<typeof PlatformAuditQuerySchema>;

/**
 * `GET /admin/audit-events/export.csv` : mêmes filtres, plus un MOTIF obligatoire —
 * un export est une lecture en masse, journalisée avec ce motif comme l'ouverture
 * d'une fiche (§ 2.6). Sans motif : `400 REASON_REQUIRED`.
 */
export const PlatformAuditExportQuerySchema = z.object({
  ...filtres,
  reason: z.enum(PLATFORM_VIEW_REASONS, { error: 'Motif de l’export obligatoire.' }),
});
export type PlatformAuditExportQuery = z.infer<typeof PlatformAuditExportQuerySchema>;

/** `GET /admin/security-events` : période en jours UTC. */
export const PlatformSecurityQuerySchema = z.object({
  from: z.preprocess(vide, z.iso.date({ error: 'Jour attendu (AAAA-MM-JJ).' }).optional()),
  to: z.preprocess(vide, z.iso.date({ error: 'Jour attendu (AAAA-MM-JJ).' }).optional()),
});

// ── Événements de sécurité agrégés ─────────────────────────────────────────────

export const PLATFORM_SECURITY_EVENT_KINDS = [
  // Relevés sur les réponses de l'API (compteurs).
  'blocked_session_refused',
  'console_forbidden',
  'console_rate_limited',
  'reauth_succeeded',
  'reauth_failed',
  'reauth_required',
  'gesture_refused',
  // Comptés dans le journal plateforme.
  'account_blocked',
  'account_unblocked',
  'platform_role_granted',
  'platform_role_revoked',
  'audit_exported',
] as const;
export type PlatformSecurityEventKind = (typeof PLATFORM_SECURITY_EVENT_KINDS)[number];

export interface PlatformSecurityEventDefinition {
  label: string;
  /** `counter` : réponse de l'API ; `audit` : événement du journal plateforme. */
  source: 'counter' | 'audit';
  /** Pour `audit` : l'action comptée. */
  auditAction?: string;
}

export const PLATFORM_SECURITY_EVENTS: Readonly<
  Record<PlatformSecurityEventKind, PlatformSecurityEventDefinition>
> = {
  blocked_session_refused: { label: 'Accès refusés : compte bloqué', source: 'counter' },
  console_forbidden: { label: 'Refus 403 sur la console', source: 'counter' },
  console_rate_limited: { label: 'Limites de débit atteintes sur la console', source: 'counter' },
  reauth_succeeded: { label: 'Ré-authentifications réussies', source: 'counter' },
  reauth_failed: { label: 'Ré-authentifications échouées', source: 'counter' },
  reauth_required: { label: 'Écritures refusées sans ré-authentification', source: 'counter' },
  gesture_refused: {
    label: 'Gestes refusés (conflit d’intérêts, à soi-même)',
    source: 'counter',
  },
  account_blocked: { label: 'Comptes bloqués', source: 'audit', auditAction: 'user.disabled' },
  account_unblocked: {
    label: 'Comptes débloqués',
    source: 'audit',
    auditAction: 'user.enabled',
  },
  platform_role_granted: {
    label: 'Rôles plateforme attribués',
    source: 'audit',
    auditAction: 'platform_role.granted',
  },
  platform_role_revoked: {
    label: 'Rôles plateforme retirés',
    source: 'audit',
    auditAction: 'platform_role.revoked',
  },
  audit_exported: {
    label: 'Exports du journal plateforme',
    source: 'audit',
    auditAction: PLATFORM_AUDIT_EXPORTED_ACTION,
  },
};

/** Synthèse servie par `GET /admin/security-events`. */
export interface PlatformSecuritySummaryView {
  /** Premier et dernier jour inclus (UTC, `AAAA-MM-JJ`). */
  from: string;
  to: string;
  kinds: readonly PlatformSecurityEventKind[];
  /** Un jour par ligne, tous les jours de la période, zéros compris. */
  days: { day: string; counts: Record<PlatformSecurityEventKind, number> }[];
  totals: Record<PlatformSecurityEventKind, number>;
  /** Comptes bloqués à l'instant de la lecture. */
  blockedAccountsNow: number;
}
