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
// Aucune méthode de lecture, de modification ni de suppression : le journal reste
// en ajout seul. La lecture plateforme passe par `admin/`.

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';

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
}
