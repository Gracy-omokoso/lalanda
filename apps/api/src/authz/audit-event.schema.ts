import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Journal d'audit minimal (S20a — docs/12 « Les exports sensibles sont journalisés »,
 * docs/17 § Journalisation).
 *
 * Append-only : aucun code ne met à jour ni ne supprime un événement. Le premier
 * producteur est `report.export`; les lots suivants (clôture, changement de rôle,
 * usurpation support) réutilisent la même collection sans la redéfinir.
 *
 * Contenu volontairement pauvre : acteur, action, cible, date, organisation. Aucun
 * montant, aucun contenu de rapport, aucun token — docs/17 § Journalisation.
 */
@Schema({ collection: 'audit_events', timestamps: { createdAt: true, updatedAt: false } })
export class AuditEvent {
  /** Organisation concernée — l'isolation s'applique aussi au journal. */
  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  /** Utilisateur à l'origine de l'événement. */
  @Prop({ type: String, required: true, index: true })
  actorUserId!: string;

  /** Rôle détenu par l'acteur AU MOMENT de l'action (il peut changer ensuite). */
  @Prop({ type: String, required: true })
  actorRole!: string;

  /** Action granulaire (`report.export`, …) ou événement métier (`member.role_changed`). */
  @Prop({ type: String, required: true, index: true })
  action!: string;

  /** Type de la cible : `project`, `membership`, `organization`… */
  @Prop({ type: String, required: true })
  targetType!: string;

  /** Identifiant de la cible. */
  @Prop({ type: String, required: true })
  targetId!: string;

  /** Détails non sensibles (format d'export, ancien/nouveau rôle…). */
  @Prop({ type: Object, default: {} })
  metadata!: Record<string, string | number | boolean | null>;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type AuditEventDocument = HydratedDocument<AuditEvent>;
export const AuditEventSchema = SchemaFactory.createForClass(AuditEvent);

// Lecture typique : « les N derniers événements de cette organisation ».
AuditEventSchema.index({ organizationId: 1, createdAt: -1 });
