import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditEvent, type AuditEventDocument } from './audit-event.schema.js';

export interface AuditRecordInput {
  organizationId: string;
  actorUserId: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Écriture et lecture du journal d'audit (S20a).
 *
 * `record()` NE FAIT PAS ÉCHOUER l'action journalisée : un export réussi dont la
 * trace n'a pas pu être écrite reste un export réussi, mais l'incident est visible
 * dans les logs serveur. Le compromis inverse (refuser l'export) serait un déni de
 * service sur une panne de journal — docs/17 § Journalisation ne l'exige pas.
 */
@Injectable()
export class AuditService {
  constructor(@InjectModel(AuditEvent.name) private readonly events: Model<AuditEventDocument>) {}

  /**
   * Écriture STRICTE : une trace qui n'a pas pu être écrite fait échouer l'appelant.
   *
   * Réservé aux actions dont docs/12 exige la journalisation — `report.export`
   * (R4 : « l'échec d'écriture de l'audit annule l'export »). Le raisonnement est
   * inverse de celui de `record()` : pour un export, le risque n'est pas de perdre
   * une ligne de journal, c'est qu'un fichier de données financières sorte de
   * l'organisation SANS TRACE. Mieux vaut un export refusé qu'un export invisible.
   */
  async recordStrict(input: AuditRecordInput): Promise<void> {
    await this.events.create({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata ?? {},
      _schemaVersion: 1,
    });
  }

  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.events.create({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata ?? {},
        _schemaVersion: 1,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[audit] écriture impossible', {
        action: input.action,
        organizationId: input.organizationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Derniers événements d'une organisation — jamais inter-organisations.
   *
   * `action` (S21a) filtre sur une action exacte. Le filtre est appliqué EN BASE
   * et non après coup : filtrer les 100 derniers événements côté client ferait
   * disparaître une action rare dès que le journal grossit, ce qui est le contraire
   * d'un journal d'audit.
   */
  async listForOrg(
    organizationId: string,
    limit = 100,
    action?: string,
  ): Promise<AuditEventDocument[]> {
    const filtre: Record<string, unknown> = { organizationId };
    if (action !== undefined && action !== '') filtre['action'] = action;
    return this.events
      .find(filtre)
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 500))
      .exec();
  }

  /**
   * Actions réellement présentes dans le journal d'une organisation — alimente le
   * sélecteur de filtre.
   *
   * Servi par l'API plutôt que codé en dur côté interface : le vocabulaire des
   * événements grandit à chaque lot (`report.export` en S20a,
   * `organization.settings_updated` en S21a) et une liste figée dans le front
   * proposerait des filtres sans résultat, ou en oublierait.
   */
  async actionsForOrg(organizationId: string): Promise<string[]> {
    const actions = await this.events.distinct('action', { organizationId }).exec();
    return actions.filter((a): a is string => typeof a === 'string').sort();
  }
}
