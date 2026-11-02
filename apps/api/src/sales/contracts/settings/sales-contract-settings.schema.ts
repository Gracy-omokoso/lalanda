// Collection `sales_contract_settings` — ADR-0050 § 2.1. ADR-0050 — V3.
//
// Une par organisation ; absente = défaut implicite (`SALES_CONTRACT_SETTINGS_DEFAULTS` :
// préavis 30 j, fin de terme 60 j, brouillons le jour de l'échéance, préparation
// automatique, approbateur unique toléré). Modifiée sous `sales.contract.approve`.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'sales_contract_settings', timestamps: true, strict: true })
export class SalesContractSettings {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: Number, required: true })
  noticeAlertDays!: number;

  @Prop({ type: Number, required: true })
  termEndAlertDays!: number;

  @Prop({ type: Number, required: true })
  subscriptionLeadDays!: number;

  @Prop({ type: Boolean, required: true })
  autoPrepareSubscriptionDrafts!: boolean;

  @Prop({ type: Boolean, required: true })
  allowSoleApprover!: boolean;

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

export type SalesContractSettingsDocument = HydratedDocument<SalesContractSettings>;
export type SalesContractSettingsLean = SalesContractSettings & { _id: Types.ObjectId };
export const SalesContractSettingsSchema = SchemaFactory.createForClass(SalesContractSettings);
SalesContractSettingsSchema.index({ organizationId: 1 }, { unique: true });
