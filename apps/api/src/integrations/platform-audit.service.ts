// Journal d'audit de PORTÉE PLATEFORME — ADR-0013 §6, ADR-0012 (collection).
//
// Réutilise la collection `audit_events` de S20a, son schéma et ses index : il
// n'y a qu'un journal, et en créer un second rendrait toute investigation
// bicéphale.
//
// ── Pourquoi ne pas appeler `AuditService.recordStrict()` ─────────────────────
//
// Parce qu'ADR-0013 §6 exige que « l'écriture de l'audit soit dans la MÊME
// TRANSACTION que la modification du secret », et que `recordStrict()` n'accepte
// pas de `ClientSession` : elle ouvre sa propre écriture. Un secret pourrait
// alors être enregistré et sa trace perdue — précisément le cas que l'ADR
// interdit. Ce service écrit sur le MÊME modèle Mongoose, avec la session de
// l'appelant. Ajouter le paramètre à `AuditService` serait plus élégant, mais ce
// fichier appartient au lot RBAC (S20a) et sa signature est consommée ailleurs.
//
// Aucune méthode de modification ni de suppression : le journal reste en ajout seul.
// Les lectures (ADR-0053 — P5) sont toutes bornées à la portée `platform`.

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model, Types } from 'mongoose';

import { AuditEvent, type AuditEventDocument } from '../authz/audit-event.schema.js';

/**
 * Organisation portée par les événements de portée plateforme.
 *
 * `audit_events.organizationId` est obligatoire (schéma S20a) et l'isolation par
 * organisation est le principe du journal. Un événement plateforme n'appartient
 * à aucune organisation cliente : lui en attribuer une le ferait apparaître dans
 * le journal d'un client, ce qui serait à la fois faux et indiscret. La
 * sentinelle `'platform'` lui donne son propre espace — aucune organisation
 * réelle ne peut porter cet identifiant, qui n'est pas un ObjectId.
 */
export const PLATFORM_AUDIT_SCOPE = 'platform';

export interface PlatformAuditInput {
  actorUserId: string;
  /** Rôle plateforme détenu AU MOMENT de l'action. */
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, string | number | boolean | null>;
}

@Injectable()
export class PlatformAuditService {
  constructor(@InjectModel(AuditEvent.name) private readonly events: Model<AuditEventDocument>) {}

  /**
   * Écriture STRICTE, dans la session fournie : un échec de trace fait échouer
   * l'appelant, et une transaction annulée annule les deux.
   */
  async record(input: PlatformAuditInput, session?: ClientSession): Promise<void> {
    await this.events.create(
      [
        {
          organizationId: PLATFORM_AUDIT_SCOPE,
          actorUserId: input.actorUserId,
          actorRole: input.actorRole,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          metadata: input.metadata ?? {},
          _schemaVersion: 1,
        },
      ],
      // `create([...], { session })` est la seule forme de `create` qui accepte
      // une session : `create(doc, { session })` traite le second argument comme
      // un second document à créer. L'erreur est silencieuse et coûte l'atomicité.
      session ? { session } : {},
    );
  }

  /** Derniers événements plateforme — alimente le journal d'audit d'`/admin`. */
  async list(
    filter: { action?: string; actorUserId?: string } = {},
    limit = 100,
  ): Promise<AuditEventDocument[]> {
    const query: Record<string, unknown> = { organizationId: PLATFORM_AUDIT_SCOPE };
    if (filter.action) query['action'] = filter.action;
    if (filter.actorUserId) query['actorUserId'] = filter.actorUserId;
    return this.events
      .find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 500))
      .exec();
  }

  // ── ADR-0053 — P5 : lecture filtrée, export et agrégats de sécurité ─────────
  //
  // Lectures seules, toujours bornées à la portée `platform` : aucune de ces méthodes ne
  // peut servir un événement d'organisation, quel que soit le filtre reçu.

  /**
   * Page du journal plateforme : filtres combinés en ET, période `[from, to[`, tri du plus
   * récent au plus ancien, curseur `before` (date + identifiant, sans saut ni doublon).
   */
  async query(
    filter: PlatformAuditFilter,
    limit: number,
  ): Promise<{ events: AuditEventDocument[]; hasMore: boolean }> {
    const clauses: Record<string, unknown>[] = [{ organizationId: PLATFORM_AUDIT_SCOPE }];
    if (filter.action) clauses.push({ action: filter.action });
    if (filter.actorUserId) clauses.push({ actorUserId: filter.actorUserId });
    if (filter.targetType) clauses.push({ targetType: filter.targetType });
    if (filter.targetId) clauses.push({ targetId: filter.targetId });
    if (filter.from || filter.to) {
      const createdAt: Record<string, Date> = {};
      if (filter.from) createdAt['$gte'] = filter.from;
      if (filter.to) createdAt['$lt'] = filter.to;
      clauses.push({ createdAt });
    }
    if (filter.before) {
      clauses.push({
        $or: [
          { createdAt: { $lt: filter.before.createdAt } },
          { createdAt: filter.before.createdAt, _id: { $lt: filter.before.id } },
        ],
      });
    }
    const bounded = Math.min(Math.max(Math.trunc(limit), 1), PLATFORM_AUDIT_QUERY_MAX);
    const rows = await this.events
      .find({ $and: clauses })
      .sort({ createdAt: -1, _id: -1 })
      .limit(bounded + 1)
      .exec();
    return { events: rows.slice(0, bounded), hasMore: rows.length > bounded };
  }

  /** Nombre d'événements plateforme par jour UTC et par action, sur `[from, to[`. */
  async countByDay(
    actions: readonly string[],
    from: Date,
    to: Date,
  ): Promise<{ day: string; action: string; count: number }[]> {
    if (actions.length === 0) return [];
    const rows = await this.events
      .aggregate<{ _id: { day: string; action: string }; count: number }>([
        {
          $match: {
            organizationId: PLATFORM_AUDIT_SCOPE,
            action: { $in: [...actions] },
            createdAt: { $gte: from, $lt: to },
          },
        },
        {
          $group: {
            _id: {
              day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
              action: '$action',
            },
            count: { $sum: 1 },
          },
        },
      ])
      .exec();
    return rows.map((r) => ({ day: r._id.day, action: r._id.action, count: r.count }));
  }
}

/** ADR-0053 — P5 : plafond d'une page ou d'un export du journal plateforme. */
export const PLATFORM_AUDIT_QUERY_MAX = 5_000;

/** ADR-0053 — P5 : filtres du journal plateforme, déjà validés et convertis. */
export interface PlatformAuditFilter {
  action?: string;
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  /** Borne basse incluse. */
  from?: Date;
  /** Borne haute exclue. */
  to?: Date;
  /** Curseur : événements strictement plus anciens que celui-ci. */
  before?: { createdAt: Date; id: Types.ObjectId };
}
