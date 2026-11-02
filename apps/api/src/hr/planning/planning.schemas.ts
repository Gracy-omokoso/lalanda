// Créneaux de planning et besoins minimaux d'effectif (ADR-0051 § 2.4). ADR-0051 — H12.
//
// Une GRILLE saisie par le manager ou les RH (O5) : aucune affectation automatique,
// aucun contrôle de durée maximale, de repos ni de travail de nuit (J3). Le seul refus
// est le chevauchement de deux créneaux non annulés du même collaborateur
// (`409 SHIFT_OVERLAP`, moteur `shiftOverlaps`) ; le reste est un CONSTAT du moteur.

import { SHIFT_STATUSES, type ShiftStatus } from '@lalanda/shared/hr';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

export interface StoredUnavailability {
  comment: string;
  at: Date;
  by: string;
}

@Schema({ collection: 'hr_shifts', timestamps: true, strict: true })
export class Shift {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  employeeId!: string;

  /** Jour civil (Kinshasa) du début. */
  @Prop({ type: String, required: true })
  date!: string;

  @Prop({ type: String, required: true })
  start!: string;

  @Prop({ type: String, required: true })
  end!: string;

  @Prop({ type: Boolean, required: true, default: false })
  crossesMidnight!: boolean;

  @Prop({ type: String, default: null })
  label!: string | null;

  @Prop({ type: String, default: null })
  location!: string | null;

  @Prop({ type: String, default: null })
  departmentId!: string | null;

  @Prop({ type: String, default: null })
  workProjectId!: string | null;

  @Prop({ type: String, required: true, enum: SHIFT_STATUSES })
  status!: ShiftStatus;

  @Prop({ type: Date, default: null })
  publishedAt!: Date | null;

  @Prop({ type: String, default: null })
  publishedBy!: string | null;

  @Prop({ type: String, default: null })
  note!: string | null;

  /** Indisponibilité signalée par le collaborateur (§ 3.6). */
  @Prop({ type: Object, default: null })
  unavailability!: StoredUnavailability | null;

  /** Créneau source d'une copie de semaine. */
  @Prop({ type: String, default: null })
  copiedFromId!: string | null;

  @Prop({ type: Date, default: null })
  cancelledAt!: Date | null;

  @Prop({ type: String, default: null })
  cancelledBy!: string | null;

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

export type ShiftDocument = HydratedDocument<Shift>;
export type ShiftLean = Shift & { _id: Types.ObjectId };
export const ShiftSchema = SchemaFactory.createForClass(Shift);

ShiftSchema.index({ organizationId: 1, date: 1, employeeId: 1 });
ShiftSchema.index({ organizationId: 1, employeeId: 1, date: 1 });

@Schema({ collection: 'hr_staffing_needs', timestamps: true, strict: true })
export class StaffingNeed {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** Un service OU un lieu. */
  @Prop({ type: String, default: null })
  departmentId!: string | null;

  @Prop({ type: String, default: null })
  location!: string | null;

  @Prop({ type: String, required: true })
  weekday!: string;

  @Prop({ type: String, required: true })
  start!: string;

  @Prop({ type: String, required: true })
  end!: string;

  @Prop({ type: Boolean, required: true, default: false })
  crossesMidnight!: boolean;

  /** Saisi par l'organisation (1–200) ; Lalanda n'en pose aucun. */
  @Prop({ type: Number, required: true })
  minStaff!: number;

  @Prop({ type: String, default: null })
  label!: string | null;

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

export type StaffingNeedDocument = HydratedDocument<StaffingNeed>;
export type StaffingNeedLean = StaffingNeed & { _id: Types.ObjectId };
export const StaffingNeedSchema = SchemaFactory.createForClass(StaffingNeed);

StaffingNeedSchema.index({ organizationId: 1, weekday: 1 });
