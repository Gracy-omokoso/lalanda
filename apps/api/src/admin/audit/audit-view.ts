// Vue servie du journal plateforme (ADR-0053 § 2.5, § 6.5 — lot P5). Fonctions pures.
//
// ── Minimisation par liste blanche ───────────────────────────────────────────
//
// Le journal plateforme dit qui a fait quoi, sur quelle cible, quand et pourquoi. Ses
// métadonnées sont écrites par plusieurs lots ; certaines n'ont rien à faire à l'écran
// ni dans un fichier exporté : le montant d'une demande de paiement (`amountDueCents`),
// l'adresse IP et l'agent du navigateur d'un changement de secret (le dépôt n'écrit
// ailleurs qu'une empreinte d'IP). Plutôt qu'une liste noire qui laisserait passer la
// prochaine clé ajoutée sans y penser, une LISTE BLANCHE : une clé inconnue est retirée,
// et la vue dit combien l'ont été (`redactedKeys`). Ajouter une clé ici est un geste
// délibéré, revu avec ce commentaire.

import type { AuditEventDocument } from '../../authz/audit-event.schema.js';
import { toCsv } from '../../crm/crm-csv.js';

/** Métadonnées servies : motifs, références, rôles, états — jamais un montant ni une IP. */
export const PLATFORM_AUDIT_METADATA_KEYS: readonly string[] = [
  // Motifs et messages (§ 2.5 : le motif fait partie de la trace).
  'reason',
  'reasonCategory',
  'internalNote',
  'clientMessage',
  'liftReason',
  'revokeNote',
  'revokeClientMessage',
  // Références et marques.
  'ref',
  'platformEventRef',
  'reference',
  'grantId',
  'soleOperator',
  'soleApprover',
  'source',
  'status',
  // Suspension, rôles, blocage.
  'mode',
  'role',
  'expiresAt',
  'revokedSessions',
  // Abonnements : l'offre et le moyen, pas la somme.
  'plan',
  'interval',
  'method',
  'startsAt',
  'endsAt',
  'from',
  'to',
  'scanned',
  'changed',
  // Intégrations : nom et suffixes, jamais une valeur de secret.
  'secretName',
  'keys',
  'last4Before',
  'last4After',
  'result',
  'forced',
  'keyId',
  // Export du journal (P5).
  'rowCount',
  'truncated',
  'filterAction',
  'filterActorUserId',
  'filterTargetType',
  'filterTargetId',
  'filterFrom',
  'filterTo',
];

const AUTORISEES = new Set(PLATFORM_AUDIT_METADATA_KEYS);

export type AuditMetadataValue = string | number | boolean | null;

export interface PlatformAuditEventView {
  id: string;
  action: string;
  actorUserId: string;
  actorRole: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, AuditMetadataValue>;
  /** Clés retirées par la liste blanche (0 le plus souvent). */
  redactedKeys: number;
  createdAt: string;
}

/** Ne garde que les clés de la liste blanche, à valeur simple. */
export function minimizeMetadata(raw: Record<string, unknown> | null | undefined): {
  metadata: Record<string, AuditMetadataValue>;
  redactedKeys: number;
} {
  const metadata: Record<string, AuditMetadataValue> = {};
  let redactedKeys = 0;
  for (const [cle, valeur] of Object.entries(raw ?? {})) {
    const simple =
      valeur === null ||
      typeof valeur === 'string' ||
      typeof valeur === 'number' ||
      typeof valeur === 'boolean';
    if (AUTORISEES.has(cle) && simple) metadata[cle] = valeur;
    else redactedKeys += 1;
  }
  return { metadata, redactedKeys };
}

export function toAuditEventView(doc: AuditEventDocument): PlatformAuditEventView {
  const { metadata, redactedKeys } = minimizeMetadata(
    doc.metadata as Record<string, unknown> | undefined,
  );
  const createdAt = (doc as unknown as { createdAt?: Date }).createdAt;
  return {
    id: String(doc._id),
    action: doc.action,
    actorUserId: doc.actorUserId,
    actorRole: doc.actorRole,
    targetType: doc.targetType,
    targetId: doc.targetId,
    metadata,
    redactedKeys,
    createdAt: createdAt ? createdAt.toISOString() : '',
  };
}

// ── Période et curseur ─────────────────────────────────────────────────────────

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `from` inclus, `to` EXCLU. Un jour (`AAAA-MM-JJ`) vaut son début en UTC pour `from`
 * et le début du LENDEMAIN pour `to` : « jusqu'au 3 » comprend tout le 3.
 */
export function resolvePeriod(
  from: string | undefined,
  to: string | undefined,
): { from?: Date; to?: Date } {
  const periode: { from?: Date; to?: Date } = {};
  if (from) periode.from = new Date(JOUR.test(from) ? `${from}T00:00:00.000Z` : from);
  if (to) {
    periode.to = JOUR.test(to)
      ? new Date(new Date(`${to}T00:00:00.000Z`).getTime() + DAY_MS)
      : new Date(to);
  }
  return periode;
}

/** Curseur opaque `<ISO>_<id>` du dernier événement d'une page. */
export function encodeCursor(view: Pick<PlatformAuditEventView, 'createdAt' | 'id'>): string {
  return `${view.createdAt}_${view.id}`;
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const i = cursor.lastIndexOf('_');
  if (i <= 0) return null;
  const createdAt = new Date(cursor.slice(0, i));
  const id = cursor.slice(i + 1);
  if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f]{24}$/i.test(id)) return null;
  return { createdAt, id: id.toLowerCase() };
}

// ── Export CSV ─────────────────────────────────────────────────────────────────

export const PLATFORM_AUDIT_CSV_HEADER = [
  'date',
  'action',
  'acteur',
  'roles_acteur',
  'type_cible',
  'cible',
  'motif',
  'categorie_motif',
  'reference',
  'seul_detenteur',
  'metadonnees',
] as const;

/**
 * CSV `;` avec BOM (même format que les autres exports du dépôt ; cellule qui commence
 * par `= + - @` neutralisée). Les métadonnées déjà minimisées, en JSON compact, closent
 * la ligne : rien de ce qui n'est pas à l'écran n'entre dans le fichier.
 */
export function platformAuditCsv(events: readonly PlatformAuditEventView[]): string {
  return toCsv(
    PLATFORM_AUDIT_CSV_HEADER,
    events.map((e) => {
      const m = e.metadata;
      const motif = m['internalNote'] ?? m['reason'] ?? m['liftReason'] ?? m['revokeNote'] ?? null;
      const ref = m['ref'] ?? m['platformEventRef'] ?? m['reference'] ?? null;
      return [
        e.createdAt,
        e.action,
        e.actorUserId,
        e.actorRole,
        e.targetType,
        e.targetId,
        motif === null ? null : String(motif),
        m['reasonCategory'] == null ? null : String(m['reasonCategory']),
        ref === null ? null : String(ref),
        m['soleOperator'] === true ? 'oui' : null,
        Object.keys(m).length > 0 ? JSON.stringify(m) : null,
      ];
    }),
  );
}

/** Nom du fichier exporté : la date du jour, rien d'autre. */
export function platformAuditCsvFilename(now: Date): string {
  return `journal-plateforme-${now.toISOString().slice(0, 10)}.csv`;
}
