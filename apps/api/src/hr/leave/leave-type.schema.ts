// Types d'absence (ADR-0045 § 2.5). ADR-0045 — H3.
//
// Paramétrés par l'organisation ; quatre types créés à l'activation (`key` non nul),
// AUCUN n'acquiert de jours (`accrual: none`, décision ouverte n° 7). Libellé unique
// parmi les actifs (`labelKey`, index partiel) ; jamais effacé, archivé (`active`).

import type { LeaveProration, LeaveUnit } from '@lalanda/shared/hr';
import { LEAVE_PRORATIONS, LEAVE_UNITS } from '@lalanda/shared/hr';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

export type StoredAccrual =
  | { kind: 'none' }
  | { kind: 'monthly'; days: string }
  | { kind: 'yearly'; days: string; on: 'leave_year_start' | 'anniversary' };

@Schema({ collection: 'hr_leave_types', timestamps: true, strict: true })
export class LeaveType {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** Clé d'un type créé à l'activation, `null` pour un type ajouté. */
  @Prop({ type: String, default: null })
  key!: string | null;

  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: String, required: true })
  labelKey!: string;

  @Prop({ type: String, required: true, enum: LEAVE_UNITS })
  unit!: LeaveUnit;

  @Prop({ type: Boolean, required: true })
  deductsFromBalance!: boolean;

  @Prop({ type: Object, required: true })
  accrual!: StoredAccrual;

  @Prop({ type: String, required: true, enum: LEAVE_PRORATIONS })
  proration!: LeaveProration;

  @Prop({ type: Object, required: true })
  carryOver!: { maxDays: string | null; expiresAfterMonths: number | null };

  @Prop({ type: Boolean, required: true })
  allowNegative!: boolean;

  @Prop({ type: Boolean, required: true })
  requiresDocument!: boolean;

  @Prop({ type: Boolean, required: true })
  confidential!: boolean;

  @Prop({ type: Boolean, required: true })
  requiresHrApproval!: boolean;

  @Prop({ type: Boolean, required: true })
  countsAsAbsenteeism!: boolean;

  @Prop({ type: Boolean, required: true })
  hrOnly!: boolean;

  @Prop({ type: Boolean, required: true, default: true })
  active!: boolean;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type LeaveTypeDocument = HydratedDocument<LeaveType>;
export type LeaveTypeLean = LeaveType & { _id: Types.ObjectId };
export const LeaveTypeSchema = SchemaFactory.createForClass(LeaveType);

LeaveTypeSchema.index(
  { organizationId: 1, key: 1 },
  {
    unique: true,
    partialFilterExpression: { key: { $type: 'string' } },
    name: 'hr_leave_type_key_unique',
  },
);
LeaveTypeSchema.index(
  { organizationId: 1, labelKey: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'hr_leave_type_label_unique' },
);
