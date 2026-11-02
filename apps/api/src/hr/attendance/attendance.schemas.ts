// Pointages et demandes de correction (ADR-0051 § 2.3). ADR-0051 — H12.
//
// `hr_attendance_events` : AJOUT SEUL. Un pointage n'est jamais modifié ni effacé (hors
// purge réglée, aucune aujourd'hui) ; une correction approuvée l'annule en posant
// `voidedBy` et écrit les pointages proposés (`source: 'correction'`). AUCUNE adresse
// IP, position, photo, empreinte ni identifiant d'appareil (O4) : le schéma est strict.
//
// `hr_attendance_corrections` : demandée par le collaborateur (pour soi) ou saisie par
// le manager ou les RH ; décidée par `attendanceCorrectionDecision`, jamais par le
// demandeur (§ 3.4).

import {
  ATTENDANCE_CORRECTION_STATUSES,
  ATTENDANCE_EVENT_KINDS,
  ATTENDANCE_SOURCES,
  type AttendanceCorrectionStatus,
  type AttendanceEventKind,
  type AttendanceSource,
} from '@lalanda/shared/hr';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({
  collection: 'hr_attendance_events',
  timestamps: { createdAt: true, updatedAt: false },
  strict: true,
})
export class AttendanceEvent {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  employeeId!: string;

  @Prop({ type: String, required: true, enum: ATTENDANCE_EVENT_KINDS })
  kind!: AttendanceEventKind;

  /** Horodatage serveur (`self`) ou saisi (`manager`, `hr`, `correction`). */
  @Prop({ type: Date, required: true })
  at!: Date;

  @Prop({ type: String, required: true, enum: ATTENDANCE_SOURCES })
  source!: AttendanceSource;

  /** Obligatoire hors `self`. */
  @Prop({ type: String, default: null })
  note!: string | null;

  /** Correction qui l'annule ; le document reste. */
  @Prop({ type: String, default: null })
  voidedBy!: string | null;

  /** Correction qui l'a écrit (`source: 'correction'`). */
  @Prop({ type: String, default: null })
  correctionId!: string | null;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
}

export type AttendanceEventDocument = HydratedDocument<AttendanceEvent>;
export type AttendanceEventLean = AttendanceEvent & { _id: Types.ObjectId };
export const AttendanceEventSchema = SchemaFactory.createForClass(AttendanceEvent);

AttendanceEventSchema.index({ organizationId: 1, employeeId: 1, at: 1 });
AttendanceEventSchema.index({ organizationId: 1, at: 1 });

export interface StoredProposedEvent {
  kind: AttendanceEventKind;
  at: Date;
}

@Schema({ collection: 'hr_attendance_corrections', timestamps: true, strict: true })
export class AttendanceCorrection {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  employeeId!: string;

  /** Jour civil (Kinshasa) concerné. */
  @Prop({ type: String, required: true })
  date!: string;

  @Prop({ type: [Object], default: [] })
  proposed!: StoredProposedEvent[];

  @Prop({ type: [String], default: [] })
  voidEventIds!: string[];

  @Prop({ type: String, required: true })
  reason!: string;

  @Prop({ type: String, required: true, enum: ATTENDANCE_CORRECTION_STATUSES })
  status!: AttendanceCorrectionStatus;

  /** Auteur de la demande (le collaborateur, son manager ou les RH). */
  @Prop({ type: String, required: true })
  requestedBy!: string;

  @Prop({ type: String, default: null })
  decidedBy!: string | null;

  @Prop({ type: Date, default: null })
  decidedAt!: Date | null;

  @Prop({ type: String, default: null })
  comment!: string | null;

  /** Exception de l'approbateur unique, marquée (§ 3). */
  @Prop({ type: Boolean, default: false })
  soleApprover!: boolean;

  /** Pointages écrits à l'approbation. */
  @Prop({ type: [String], default: [] })
  createdEventIds!: string[];

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

export type AttendanceCorrectionDocument = HydratedDocument<AttendanceCorrection>;
export type AttendanceCorrectionLean = AttendanceCorrection & { _id: Types.ObjectId };
export const AttendanceCorrectionSchema = SchemaFactory.createForClass(AttendanceCorrection);

AttendanceCorrectionSchema.index({ organizationId: 1, employeeId: 1, status: 1, createdAt: -1 });
AttendanceCorrectionSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
