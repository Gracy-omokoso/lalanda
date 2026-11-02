// ─────────────────────────────────────────────────────────────────────────────
// OCTROIS MANUELS D'OFFRE (ADR-0053 § 4, § 6.2 — lot P3)
//
// Collection de PORTÉE PLATEFORME : l'organisation visée est nommée
// `targetOrganizationId`, jamais `organizationId` (ce n'est pas une donnée du client,
// c'est une décision de Lalanda à son sujet). Ajout seul : un octroi n'est jamais
// supprimé ; il est approuvé, retiré ou laissé à son échéance.
//
// Statuts : `pending_approval` (seconde personne attendue, § 5.3), `active` (posé sur
// l'abonnement), `revoked` (retiré, ou demande annulée avant approbation). L'échéance
// n'est pas un statut écrit : elle se lit (`endsAt <= now`), comme l'essai.
// ─────────────────────────────────────────────────────────────────────────────

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import { PLATFORM_REASON_CATEGORIES } from '@lalanda/shared/platform';

import { PLANS, type Plan } from '../../billing/entitlements.js';

export const PLAN_GRANT_STATUSES = ['pending_approval', 'active', 'revoked'] as const;
export type PlanGrantStatus = (typeof PLAN_GRANT_STATUSES)[number];

export const PLAN_GRANT_SCHEMA_VERSION = 1;

@Schema({ collection: 'platform_plan_grants', timestamps: true, strict: true })
export class PlanGrant {
  @Prop({ type: String, required: true, index: true })
  targetOrganizationId!: string;

  @Prop({ type: String, required: true, enum: PLANS as unknown as string[] })
  plan!: Plan;

  @Prop({ type: String, required: true, enum: PLATFORM_REASON_CATEGORIES as unknown as string[] })
  reasonCategory!: string;

  /** Texte destiné au client (miroir de son journal). */
  @Prop({ type: String, required: true })
  clientMessage!: string;

  /** Note interne — JAMAIS servie au client. */
  @Prop({ type: String, required: true })
  internalNote!: string;

  @Prop({ type: Date, required: true })
  startsAt!: Date;

  /** `null` : sans échéance (seconde personne exigée, § 5.3). */
  @Prop({ type: Date, default: null })
  endsAt!: Date | null;

  @Prop({ type: String, required: true, enum: PLAN_GRANT_STATUSES as unknown as string[] })
  status!: PlanGrantStatus;

  /** Qui a préparé l'octroi. */
  @Prop({ type: String, required: true })
  grantedBy!: string;

  @Prop({ type: String, default: null })
  approvedBy!: string | null;

  @Prop({ type: Date, default: null })
  approvedAt!: Date | null;

  /** Activé par le seul détenteur de `platform.billing.grant` (exception marquée). */
  @Prop({ type: Boolean, default: false })
  soleApprover!: boolean;

  /** Opérateur membre de l'organisation cible, seul détenteur (exception marquée). */
  @Prop({ type: Boolean, default: false })
  soleOperator!: boolean;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: String, default: null })
  revokedBy!: string | null;

  @Prop({ type: String, default: null })
  revokeNote!: string | null;

  @Prop({ type: Number, required: true, default: PLAN_GRANT_SCHEMA_VERSION })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type PlanGrantDocument = HydratedDocument<PlanGrant>;
export const PlanGrantSchema = SchemaFactory.createForClass(PlanGrant);
PlanGrantSchema.index({ status: 1, createdAt: -1 });
