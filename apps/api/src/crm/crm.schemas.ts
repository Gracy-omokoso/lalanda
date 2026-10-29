// Collections du CRM minimal — ADR-0035 § 2.
//
// Quatre collections, toutes portées par `organizationId` (isolation : chaque
// requête le porte, une ressource d'une autre organisation est introuvable).
// Les règles d'entrée vivent dans `crm.dto.ts` ; les schémas ne gardent que la
// forme. Montants estimés : chaînes décimales canoniques, jamais des `number`.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import {
  ACTIVITY_KINDS,
  // ADR-0040 — C2
  AMOUNT_SOURCES,
  type AmountSource,
  type LostReason,
  OPPORTUNITY_STATUSES,
  STAGE_KINDS,
  type ActivityKind,
  type OpportunityStatus,
  type PipelineStage,
} from './crm-model.js';

// ── Réglages ────────────────────────────────────────────────────────────────

@Schema({ _id: false, strict: true })
export class CrmStage {
  @Prop({ type: String, required: true })
  key!: string;

  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: String, required: true, enum: STAGE_KINDS as unknown as string[] })
  kind!: PipelineStage['kind'];
}
const CrmStageSchema = SchemaFactory.createForClass(CrmStage);

// ADR-0040 — C2 (§ 2.5)
@Schema({ _id: false, strict: true })
export class CrmLostReason {
  @Prop({ type: String, required: true })
  key!: string;

  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: Boolean, required: true, default: true })
  active!: boolean;
}
const CrmLostReasonSchema = SchemaFactory.createForClass(CrmLostReason);

@Schema({ collection: 'crm_settings', timestamps: true, strict: true })
export class CrmSettings {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: [CrmStageSchema], required: true })
  stages!: PipelineStage[];

  @Prop({ type: Boolean, required: true, default: true })
  autoWinOnQuoteAccepted!: boolean;

  @Prop({ type: Number, required: true })
  staleAfterDays!: number;

  /** ADR-0040 — C2 (§ 2.5) : motifs de perte ; absent → motifs par défaut. */
  @Prop({ type: [CrmLostReasonSchema], default: undefined })
  lostReasons?: LostReason[];

  /** ADR-0040 — C2 (§ 2.5) : motif obligatoire pour passer en perdu ; absent → `true`. */
  @Prop({ type: Boolean, default: undefined })
  lostReasonRequired?: boolean;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type CrmSettingsDocument = HydratedDocument<CrmSettings>;
export const CrmSettingsSchema = SchemaFactory.createForClass(CrmSettings);
CrmSettingsSchema.index({ organizationId: 1 }, { unique: true });

// ── Contacts et prospects ───────────────────────────────────────────────────

@Schema({ collection: 'crm_contacts', timestamps: true, strict: true })
export class CrmContact {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, default: null })
  jobTitle!: string | null;

  @Prop({ type: String, default: null })
  email!: string | null;

  @Prop({ type: String, default: null })
  phone!: string | null;

  /** Client de l'organisation ; `null` : prospect (entreprise dans `companyName`). Recopié du compte (ADR-0040 § 2.2). */
  @Prop({ type: String, default: null })
  customerId!: string | null;

  @Prop({ type: String, default: null })
  companyName!: string | null;

  /**
   * ADR-0040 — C1 (§ 2.2) : compte de la personne (`crm_accounts`), `null` :
   * personne sans entreprise. `customerId` et `companyName` en sont recopiés.
   */
  @Prop({ type: String, default: null })
  accountId!: string | null;

  @Prop({ type: String, default: null })
  notes!: string | null;

  @Prop({ type: String, required: true })
  sortName!: string;

  @Prop({ type: String, required: true })
  searchKey!: string;

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
export type CrmContactDocument = HydratedDocument<CrmContact>;
export const CrmContactSchema = SchemaFactory.createForClass(CrmContact);
CrmContactSchema.index({ organizationId: 1, sortName: 1, _id: 1 });
CrmContactSchema.index({ organizationId: 1, customerId: 1 });
CrmContactSchema.index({ organizationId: 1, email: 1 });
// ADR-0040 — C1
CrmContactSchema.index({ organizationId: 1, accountId: 1 });

// ── Opportunités ────────────────────────────────────────────────────────────

@Schema({ _id: false, strict: true })
export class CrmStageEvent {
  @Prop({ type: String, required: true })
  stageKey!: string;

  @Prop({ type: Date, required: true })
  at!: Date;

  @Prop({ type: String, required: true })
  by!: string;

  /** `user` : déplacement manuel ; `quote` : devis accepté (règle de gain) ; `import`. */
  @Prop({ type: String, required: true, enum: ['user', 'quote', 'import'] })
  source!: 'user' | 'quote' | 'import';

  @Prop({ type: String, default: null })
  quoteId!: string | null;
}
const CrmStageEventSchema = SchemaFactory.createForClass(CrmStageEvent);

/**
 * ADR-0040 — C2 (§ 2.3) : ligne d'opportunité. Libellé, unité et prix sont
 * COPIÉS de l'article à l'ajout (le catalogue peut changer ensuite). Prix
 * unitaire HORS TAXES dans la devise de l'opportunité ; `null` : sans prix.
 */
@Schema({ _id: false, strict: true })
export class CrmOpportunityLine {
  @Prop({ type: String, default: null })
  catalogItemId!: string | null;

  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: String, required: true })
  quantity!: string;

  @Prop({ type: String, default: null })
  unit!: string | null;

  @Prop({ type: String, default: null })
  unitPrice!: string | null;

  @Prop({ type: String, default: null })
  discountPercent!: string | null;
}
const CrmOpportunityLineSchema = SchemaFactory.createForClass(CrmOpportunityLine);

@Schema({ collection: 'crm_opportunities', timestamps: true, strict: true })
export class CrmOpportunity {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, default: null })
  customerId!: string | null;

  @Prop({ type: String, default: null })
  prospectName!: string | null;

  @Prop({ type: String, default: null })
  contactId!: string | null;

  @Prop({ type: String, required: true })
  stageKey!: string;

  /** Nature de l'étape courante, dénormalisée pour les requêtes. */
  @Prop({ type: String, required: true, enum: OPPORTUNITY_STATUSES as unknown as string[] })
  status!: OpportunityStatus;

  /** Montant ESTIMÉ, décimal canonique à 2 décimales ; `null` : non estimé. */
  @Prop({ type: String, default: null })
  amount!: string | null;

  @Prop({ type: String, required: true, enum: ['CDF', 'USD'] })
  currency!: 'CDF' | 'USD';

  @Prop({ type: String, default: null })
  expectedCloseDate!: string | null;

  @Prop({ type: String, default: null })
  lostReason!: string | null;

  @Prop({ type: Date, default: null })
  closedAt!: Date | null;

  @Prop({ type: Date, required: true })
  lastActivityAt!: Date;

  @Prop({ type: [CrmStageEventSchema], required: true, default: [] })
  stageHistory!: CrmStageEvent[];

  // ── ADR-0040 — C2 (§ 2.3) ────────────────────────────────────────────────

  /**
   * Compte visé (`crm_accounts`, identifiant hexadécimal en chaîne, comme
   * `CrmContact.accountId` de C1) ; `customerId` et `prospectName` en sont
   * recopiés. `null` : opportunité antérieure à la migration, non rattachée.
   */
  @Prop({ type: String, default: null })
  accountId!: string | null;

  /** Responsable : membre détenant `crm.manage` ; défaut : le créateur. */
  @Prop({ type: String, default: null })
  ownerId!: string | null;

  @Prop({ type: [CrmOpportunityLineSchema], default: [] })
  lines!: CrmOpportunityLine[];

  /** `manual` : montant saisi ; `lines` : total HT des lignes, calculé par le moteur. */
  @Prop({ type: String, enum: AMOUNT_SOURCES as unknown as string[], default: 'manual' })
  amountSource!: AmountSource;

  /** Clé de `crm_settings.lostReasons` ; `lostReason` en garde le détail libre. */
  @Prop({ type: String, default: null })
  lostReasonKey!: string | null;

  @Prop({ type: Date, default: null })
  wonAt!: Date | null;

  @Prop({ type: String, required: true })
  searchKey!: string;

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
export type CrmOpportunityDocument = HydratedDocument<CrmOpportunity>;
export const CrmOpportunitySchema = SchemaFactory.createForClass(CrmOpportunity);
CrmOpportunitySchema.index({ organizationId: 1, createdAt: -1, _id: -1 });
CrmOpportunitySchema.index({ organizationId: 1, status: 1, lastActivityAt: 1 });
CrmOpportunitySchema.index({ organizationId: 1, stageKey: 1 });
CrmOpportunitySchema.index({ organizationId: 1, customerId: 1 });
// ADR-0040 — C2
CrmOpportunitySchema.index({ organizationId: 1, accountId: 1 });
CrmOpportunitySchema.index({ organizationId: 1, ownerId: 1, status: 1 });
CrmOpportunitySchema.index({ organizationId: 1, status: 1, expectedCloseDate: 1 });
CrmOpportunitySchema.index({ organizationId: 1, status: 1, closedAt: 1 });

// ── Activités ───────────────────────────────────────────────────────────────

/** ADR-0040 — C4 : jour d'échéance déjà rappelé, par type (réclamation conditionnelle). */
@Schema({ _id: false, strict: true })
export class CrmActivityReminders {
  @Prop({ type: String, default: null })
  dueSoonFor!: string | null;

  @Prop({ type: String, default: null })
  overdueFor!: string | null;
}
const CrmActivityRemindersSchema = SchemaFactory.createForClass(CrmActivityReminders);

@Schema({ collection: 'crm_activities', timestamps: true, strict: true })
export class CrmActivity {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true, enum: ACTIVITY_KINDS as unknown as string[] })
  kind!: ActivityKind;

  @Prop({ type: String, required: true })
  subject!: string;

  @Prop({ type: String, default: null })
  notes!: string | null;

  @Prop({ type: Date, default: null })
  dueAt!: Date | null;

  @Prop({ type: Boolean, required: true, default: false })
  done!: boolean;

  @Prop({ type: Date, default: null })
  doneAt!: Date | null;

  @Prop({ type: String, default: null })
  opportunityId!: string | null;

  @Prop({ type: String, default: null })
  contactId!: string | null;

  @Prop({ type: String, default: null })
  customerId!: string | null;

  // ADR-0040 — C4 § 2.4 : compte (posé par la migration de C1, lu s'il existe),
  // assigné, jour d'échéance dénormalisé et rappels déjà émis.

  /** Compte CRM visé ; `null` tant que la migration des comptes n'est pas passée. */
  @Prop({ type: String, default: null })
  accountId!: string | null;

  /** Membre détenant `crm.manage` ; jamais `null` pour une activité à échéance non faite. */
  @Prop({ type: String, default: null })
  assigneeUserId!: string | null;

  /** `AAAA-MM-JJ` : jour de Kinshasa de `dueAt`, écrit dans la même mise à jour. */
  @Prop({ type: String, default: null })
  dueDay!: string | null;

  /** Jour d'échéance déjà rappelé, par type (motif des rappels de R1). */
  @Prop({ type: CrmActivityRemindersSchema, default: () => ({}) })
  reminders!: CrmActivityReminders;

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
export type CrmActivityDocument = HydratedDocument<CrmActivity>;
export const CrmActivitySchema = SchemaFactory.createForClass(CrmActivity);
CrmActivitySchema.index({ organizationId: 1, createdAt: -1, _id: -1 });
CrmActivitySchema.index({ organizationId: 1, done: 1, dueAt: 1 });
CrmActivitySchema.index({ organizationId: 1, opportunityId: 1 });
CrmActivitySchema.index({ organizationId: 1, contactId: 1 });
// ADR-0040 — C4 : Mes tâches et brief ; rappels ; fil du compte.
CrmActivitySchema.index({ organizationId: 1, assigneeUserId: 1, done: 1, dueDay: 1 });
CrmActivitySchema.index({ organizationId: 1, done: 1, dueDay: 1 });
CrmActivitySchema.index({ organizationId: 1, accountId: 1, createdAt: 1 });
