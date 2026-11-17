// Membres externes d'un projet — ADR-0078.
//
// Quatre collections :
//
//   - `work_external_accounts`    : compte externe (contact client ou consultant) d'une
//                                   organisation, une adresse par organisation ;
//   - `work_external_memberships` : accès d'un compte à un projet (actif ou fermé) ;
//   - `work_external_challenges`  : code à usage unique d'une demande de connexion
//                                   (HACHÉ, jamais en clair), expiration courte ;
//   - `work_external_sessions`    : sessions de l'espace externe (jeton HACHÉ), distinctes
//                                   des sessions better-auth : une session externe n'ouvre
//                                   AUCUNE route de l'ERP.
//
// Les taux d'achat d'un consultant vivent avec les taux des membres
// (`work_member_rates`, clé = identifiant du compte externe) : la marge les lit sans
// changement du moteur.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

export const EXTERNAL_ACCOUNTS = 'work_external_accounts';
export const EXTERNAL_MEMBERSHIPS = 'work_external_memberships';
export const EXTERNAL_CHALLENGES = 'work_external_challenges';
export const EXTERNAL_SESSIONS = 'work_external_sessions';

const CLOSE_REASONS = [
  'manual',
  'member_removed',
  'project_archived',
  'customer_inactive',
  'supplier_inactive',
  'converted',
];

// ── Compte externe ──────────────────────────────────────────────────────────

@Schema({ collection: EXTERNAL_ACCOUNTS, timestamps: true, strict: true })
export class WorkExternalAccount {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true, enum: ['client', 'consultant'] })
  kind!: 'client' | 'consultant';

  /** Adresse de connexion, en minuscules. */
  @Prop({ type: String, required: true })
  email!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true, enum: ['active', 'closed'], default: 'active' })
  status!: 'active' | 'closed';

  @Prop({ type: Date, default: null })
  closedAt!: Date | null;

  @Prop({ type: String, enum: [...CLOSE_REASONS, null], default: null })
  closedReason!: string | null;

  /** Contact client : fiche client (`customers`). */
  @Prop({ type: String, default: null })
  customerId!: string | null;

  /** Contact client : compte CRM facultatif (`crm_accounts`). */
  @Prop({ type: String, default: null })
  crmAccountId!: string | null;

  /** Consultant : fiche fournisseur (`suppliers`). */
  @Prop({ type: String, default: null })
  supplierId!: string | null;

  /** Consultant : référent interne (valideur de ses feuilles de temps). */
  @Prop({ type: String, default: null })
  referentUserId!: string | null;

  /** Invité externe converti (ADR-0078 § 3.4), pour la trace. */
  @Prop({ type: String, default: null })
  convertedFromUserId!: string | null;

  @Prop({ type: Date, default: null })
  lastLoginAt!: Date | null;

  // ── Revue de sécurité (M2, B2) : compteurs du jour et verrou, tenus en base ──

  /** Jour (Kinshasa) des échecs de code comptés. */
  @Prop({ type: String, default: null })
  authFailureDay?: string | null;

  @Prop({ type: Number, default: 0 })
  authFailureCount?: number;

  /** Connexion suspendue jusqu'à cette date (trop d'échecs du jour). */
  @Prop({ type: Date, default: null })
  lockedUntil?: Date | null;

  /** Jour (Kinshasa) des demandes de code comptées. */
  @Prop({ type: String, default: null })
  codeRequestDay?: string | null;

  @Prop({ type: Number, default: 0 })
  codeRequestCount?: number;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type WorkExternalAccountDocument = HydratedDocument<WorkExternalAccount>;
export type WorkExternalAccountLean = WorkExternalAccount & { _id: Types.ObjectId };
export const WorkExternalAccountSchema = SchemaFactory.createForClass(WorkExternalAccount);
WorkExternalAccountSchema.index({ organizationId: 1, email: 1 }, { unique: true });
WorkExternalAccountSchema.index({ email: 1, status: 1 });
WorkExternalAccountSchema.index({ organizationId: 1, supplierId: 1 });
WorkExternalAccountSchema.index({ organizationId: 1, customerId: 1 });

// ── Accès à un projet ───────────────────────────────────────────────────────

@Schema({ collection: EXTERNAL_MEMBERSHIPS, timestamps: true, strict: true })
export class WorkExternalMembership {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  accountId!: string;

  @Prop({ type: String, required: true })
  projectId!: string;

  @Prop({ type: String, required: true, enum: ['client', 'consultant'] })
  kind!: 'client' | 'consultant';

  @Prop({ type: String, required: true, enum: ['active', 'closed'], default: 'active' })
  status!: 'active' | 'closed';

  /** Consultant : ouvre la vue du projet (sans montants) ; défaut : ses tâches seulement. */
  @Prop({ type: Boolean, required: true, default: false })
  canOpenProject!: boolean;

  @Prop({ type: String, required: true })
  invitedBy!: string;

  @Prop({ type: Date, required: true })
  invitedAt!: Date;

  @Prop({ type: Date, default: null })
  closedAt!: Date | null;

  @Prop({ type: String, enum: [...CLOSE_REASONS, null], default: null })
  closedReason!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type WorkExternalMembershipDocument = HydratedDocument<WorkExternalMembership>;
export type WorkExternalMembershipLean = WorkExternalMembership & { _id: Types.ObjectId };
export const WorkExternalMembershipSchema = SchemaFactory.createForClass(WorkExternalMembership);
WorkExternalMembershipSchema.index(
  { organizationId: 1, accountId: 1, projectId: 1 },
  { unique: true },
);
WorkExternalMembershipSchema.index({ organizationId: 1, projectId: 1, status: 1 });

// ── Défi de connexion (code à usage unique) ─────────────────────────────────

/**
 * Défi d'une ADRESSE : il peut couvrir les comptes de plusieurs organisations (la
 * personne choisit après un code correct). Ne porte que l'adresse, les identifiants des
 * comptes et l'empreinte du code ; supprimé par l'index TTL une heure après expiration.
 */
@Schema({ collection: EXTERNAL_CHALLENGES, strict: true })
export class WorkExternalChallenge {
  @Prop({ type: String, required: true })
  email!: string;

  @Prop({ type: [String], required: true })
  accountIds!: string[];

  /** HMAC-SHA256 (clé dérivée d'`AUTH_SECRET`) de l'identifiant du défi et du code. */
  @Prop({ type: String, required: true })
  codeHash!: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Number, required: true, default: 0 })
  attempts!: number;

  /** Posé à l'usage, à l'épuisement des essais ou au remplacement par un nouveau code. */
  @Prop({ type: Date, default: null })
  consumedAt!: Date | null;

  @Prop({ type: Date, required: true })
  createdAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type WorkExternalChallengeDocument = HydratedDocument<WorkExternalChallenge>;
export type WorkExternalChallengeLean = WorkExternalChallenge & { _id: Types.ObjectId };
export const WorkExternalChallengeSchema = SchemaFactory.createForClass(WorkExternalChallenge);
WorkExternalChallengeSchema.index({ email: 1, consumedAt: 1, createdAt: -1 });
WorkExternalChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

// ── Session de l'espace externe ─────────────────────────────────────────────

@Schema({ collection: EXTERNAL_SESSIONS, strict: true })
export class WorkExternalSession {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  accountId!: string;

  /** SHA-256 du jeton du cookie (le jeton n'est jamais stocké). */
  @Prop({ type: String, required: true })
  tokenHash!: string;

  @Prop({ type: Date, required: true })
  createdAt!: Date;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: String, default: null })
  revokedReason!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type WorkExternalSessionDocument = HydratedDocument<WorkExternalSession>;
export type WorkExternalSessionLean = WorkExternalSession & { _id: Types.ObjectId };
export const WorkExternalSessionSchema = SchemaFactory.createForClass(WorkExternalSession);
WorkExternalSessionSchema.index({ tokenHash: 1 }, { unique: true });
WorkExternalSessionSchema.index({ organizationId: 1, accountId: 1, revokedAt: 1 });
WorkExternalSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400 });
