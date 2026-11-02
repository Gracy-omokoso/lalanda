// ─────────────────────────────────────────────────────────────────────────────
// ANNONCES DE LA PLATEFORME (ADR-0053 § 4, § 6.6 — lot P6)
//
//   platform_announcements          une annonce, son circuit à deux personnes
//   platform_announcement_receipts  une ligne par (annonce, destinataire), posée à l'ENVOI
//
// Collections de PORTÉE PLATEFORME : aucune ne porte d'`organizationId`. Une annonce
// vise une catégorie déclarative (`AudienceFilter`), jamais une liste d'organisations
// écrite en dur ; l'accusé de réception ne nomme que la personne. Le destinataire ne
// lit jamais la catégorie : il ne peut donc rien apprendre des autres organisations.
//
// Idempotence : l'index unique `{ announcementId, userId }` garantit une seule ligne par
// personne — un envoi rejoué, deux onglets, deux organisations du même compte ne
// produisent jamais de doublon dans la cloche.
// ─────────────────────────────────────────────────────────────────────────────

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import type { AudienceFilter } from '@lalanda/shared/platform';

export const ANNOUNCEMENT_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'sent',
  'canceled',
  // ADR-0054 (3 nov. 2026) : une annonce envoyée peut être retirée, avec motif.
  'withdrawn',
] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const ANNOUNCEMENT_SCHEMA_VERSION = 1;

@Schema({ collection: 'platform_announcements', timestamps: true, strict: true })
export class PlatformAnnouncement {
  @Prop({ type: String, required: true })
  title!: string;

  /** Texte BRUT (2 000 caractères) : aucun HTML n'est interprété, ni ici ni à l'écran. */
  @Prop({ type: String, required: true })
  body!: string;

  /** Canal unique en v1 (décision ouverte n° 9) : aucun e-mail, aucun SMS. */
  @Prop({ type: String, required: true, enum: ['in_app'], default: 'in_app' })
  channel!: 'in_app';

  /** Catégorie de destinataires (§ 6.6) — métadonnées de plateforme seulement. */
  @Prop({ type: Object, required: true, default: {} })
  audience!: AudienceFilter;

  @Prop({ type: String, required: true, enum: ANNOUNCEMENT_STATUSES as unknown as string[] })
  status!: AnnouncementStatus;

  /** Nombre de destinataires du dernier aperçu ; remis à `null` par une modification. */
  @Prop({ type: Number, default: null })
  previewCount!: number | null;

  @Prop({ type: Date, default: null })
  previewedAt!: Date | null;

  /** Nombre recalculé à l'approbation — celui que l'envoi doit faire retaper. */
  @Prop({ type: Number, default: null })
  audienceCountAtApproval!: number | null;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, default: null })
  submittedBy!: string | null;

  @Prop({ type: Date, default: null })
  submittedAt!: Date | null;

  @Prop({ type: String, default: null })
  approvedBy!: string | null;

  @Prop({ type: Date, default: null })
  approvedAt!: Date | null;

  /** Exception du § 5.3 : un seul détenteur de l'approbation, l'auteur s'approuve. Marquée. */
  @Prop({ type: Boolean, required: true, default: false })
  soleApprover!: boolean;

  @Prop({ type: String, default: null })
  sentBy!: string | null;

  /** Début de diffusion : l'envoi (aucun envoi programmé en v1). */
  @Prop({ type: Date, default: null })
  sentAt!: Date | null;

  /** Destinataires effectivement atteints (accusés posés). */
  @Prop({ type: Number, default: null })
  recipientCount!: number | null;

  /**
   * Fin de diffusion. Facultative au brouillon : à l'envoi, `sentAt` + 30 jours par
   * défaut (§ 6.6).
   */
  @Prop({ type: Date, default: null })
  expiresAt!: Date | null;

  @Prop({ type: String, default: null })
  canceledBy!: string | null;

  @Prop({ type: Date, default: null })
  canceledAt!: Date | null;

  /** Retrait d'une annonce ENVOYÉE (ADR-0054) : elle disparaît de la bannière et de la cloche. */
  @Prop({ type: String, default: null })
  withdrawnBy!: string | null;

  @Prop({ type: Date, default: null })
  withdrawnAt!: Date | null;

  /** Motif interne, obligatoire ; jamais montré au destinataire. */
  @Prop({ type: String, default: null })
  withdrawReason!: string | null;

  @Prop({ type: Number, required: true, default: ANNOUNCEMENT_SCHEMA_VERSION })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type PlatformAnnouncementDocument = HydratedDocument<PlatformAnnouncement>;
export const PlatformAnnouncementSchema = SchemaFactory.createForClass(PlatformAnnouncement);
PlatformAnnouncementSchema.index({ createdAt: -1 });
PlatformAnnouncementSchema.index({ status: 1, expiresAt: 1 });

@Schema({ collection: 'platform_announcement_receipts', timestamps: true, strict: true })
export class PlatformAnnouncementReceipt {
  @Prop({ type: String, required: true })
  announcementId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: Date, required: true })
  deliveredAt!: Date;

  /** Copie de la fin de diffusion : la lecture du destinataire ne joint rien d'expiré. */
  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  readAt!: Date | null;

  /** « Fermer » : la bannière ne la montre plus ; la cloche la garde jusqu'à l'échéance. */
  @Prop({ type: Date, default: null })
  dismissedAt!: Date | null;

  @Prop({ type: Number, required: true, default: ANNOUNCEMENT_SCHEMA_VERSION })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type PlatformAnnouncementReceiptDocument = HydratedDocument<PlatformAnnouncementReceipt>;
export const PlatformAnnouncementReceiptSchema = SchemaFactory.createForClass(
  PlatformAnnouncementReceipt,
);
/** Idempotence : une seule ligne par (annonce, personne). */
PlatformAnnouncementReceiptSchema.index({ announcementId: 1, userId: 1 }, { unique: true });
/** Lecture du destinataire : ses annonces en cours. */
PlatformAnnouncementReceiptSchema.index({ userId: 1, expiresAt: 1 });
