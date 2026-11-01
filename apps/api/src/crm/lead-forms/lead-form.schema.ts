// Collections du formulaire public de prospects — ADR-0048 § 2.
//
// `crm_lead_forms` : un formulaire par organisation (index unique), désactivé à
// la création. `crm_lead_submissions` : preuve du consentement de chaque
// soumission ACCEPTÉE — empreinte d'IP seulement, jamais l'adresse en clair.

import type { LeadFormCurrency, LeadFormFieldKey } from '@lalanda/shared/crm';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

/** Auteur technique des écritures faites par une soumission publique. */
export const LEAD_FORM_SYSTEM_ACTOR = 'system:crm-lead-form';

@Schema({ _id: false, strict: true })
export class CrmLeadFormField {
  @Prop({ type: String, required: true })
  key!: LeadFormFieldKey;

  @Prop({ type: Boolean, required: true })
  enabled!: boolean;

  @Prop({ type: Boolean, required: true })
  required!: boolean;

  @Prop({ type: String, default: null })
  label!: string | null;
}
const CrmLeadFormFieldSchema = SchemaFactory.createForClass(CrmLeadFormField);

@Schema({ collection: 'crm_lead_forms', timestamps: true, strict: true })
export class CrmLeadForm {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  token!: string;

  @Prop({ type: Date, default: null })
  tokenRotatedAt!: Date | null;

  @Prop({ type: Boolean, required: true, default: false })
  enabled!: boolean;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, default: null })
  intro!: string | null;

  @Prop({ type: [CrmLeadFormFieldSchema], required: true })
  fields!: CrmLeadFormField[];

  @Prop({ type: String, required: true })
  consentText!: string;

  @Prop({ type: String, default: null })
  privacyPolicyUrl!: string | null;

  @Prop({ type: String, required: true })
  successMessage!: string;

  @Prop({ type: String, default: null })
  assigneeUserId!: string | null;

  @Prop({ type: Boolean, required: true, default: false })
  createOpportunity!: boolean;

  @Prop({ type: String, required: true, enum: ['USD', 'CDF'], default: 'USD' })
  opportunityCurrency!: LeadFormCurrency;

  @Prop({ type: Boolean, required: true, default: true })
  showBranding!: boolean;

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
export type CrmLeadFormDocument = HydratedDocument<CrmLeadForm>;
export type CrmLeadFormLean = CrmLeadForm & { _id: Types.ObjectId };
export const CrmLeadFormSchema = SchemaFactory.createForClass(CrmLeadForm);
CrmLeadFormSchema.index({ organizationId: 1 }, { unique: true });
CrmLeadFormSchema.index({ token: 1 }, { unique: true });

@Schema({ _id: false, strict: true })
export class CrmLeadConsent {
  /** Texte AFFICHÉ au visiteur, copié : le changer plus tard ne réécrit pas le passé. */
  @Prop({ type: String, required: true })
  text!: string;

  @Prop({ type: String, default: null })
  policyUrl!: string | null;

  @Prop({ type: Date, required: true })
  acceptedAt!: Date;
}
const CrmLeadConsentSchema = SchemaFactory.createForClass(CrmLeadConsent);

@Schema({ collection: 'crm_lead_submissions', timestamps: { updatedAt: false }, strict: true })
export class CrmLeadSubmission {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  formId!: string;

  @Prop({ type: String, required: true })
  contactId!: string;

  @Prop({ type: String, default: null })
  accountId!: string | null;

  @Prop({ type: String, required: true })
  activityId!: string;

  @Prop({ type: String, default: null })
  opportunityId!: string | null;

  /** E-mail déjà connu : contact et compte réutilisés, rien de réécrit. */
  @Prop({ type: Boolean, required: true })
  duplicate!: boolean;

  @Prop({ type: CrmLeadConsentSchema, required: true })
  consent!: CrmLeadConsent;

  /** Empreinte salée de l'IP (ADR-0048 § 7) ; jamais l'adresse. */
  @Prop({ type: String, required: true })
  ipHash!: string;

  createdAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type CrmLeadSubmissionDocument = HydratedDocument<CrmLeadSubmission>;
export const CrmLeadSubmissionSchema = SchemaFactory.createForClass(CrmLeadSubmission);
CrmLeadSubmissionSchema.index({ organizationId: 1, createdAt: -1 });
CrmLeadSubmissionSchema.index({ organizationId: 1, formId: 1, createdAt: -1 });
