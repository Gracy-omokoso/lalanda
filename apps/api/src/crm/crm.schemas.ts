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

// ── Activités ───────────────────────────────────────────────────────────────

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
