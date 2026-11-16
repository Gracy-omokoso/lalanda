// Collection `work_timesheet_weeks` — validation hebdomadaire du temps, ADR-0077 § 4.
//
// Une ligne par membre et par semaine (lundi `AAAA-MM-JJ`) ; aucune ligne = semaine
// « en cours ». `history` est en ajout seul (soumission, approbation, renvoi,
// réouverture, avec l'auteur et le motif). Une semaine `approved` VERROUILLE les
// saisies de temps de ce membre datées de cette semaine (`WorkTimeService`).
// Rien n'est relié à la paie (ADR-0070).

import type { TimesheetAction } from '@lalanda/shared/work';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

export const TIMESHEET_STORED_STATUSES = ['submitted', 'approved', 'returned', 'reopened'] as const;
export type TimesheetStoredStatus = (typeof TIMESHEET_STORED_STATUSES)[number];

export interface TimesheetHistoryEntry {
  action: TimesheetAction;
  at: Date;
  by: string;
  reason: string | null;
}

@Schema({ collection: 'work_timesheet_weeks', timestamps: true, strict: true })
export class WorkTimesheetWeek {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  /** Lundi `AAAA-MM-JJ`. */
  @Prop({ type: String, required: true })
  week!: string;

  @Prop({ type: String, required: true, enum: [...TIMESHEET_STORED_STATUSES] })
  status!: TimesheetStoredStatus;

  @Prop({ type: Date, default: null })
  submittedAt!: Date | null;

  @Prop({ type: String, default: null })
  submittedBy!: string | null;

  @Prop({ type: Date, default: null })
  decidedAt!: Date | null;

  @Prop({ type: String, default: null })
  decidedBy!: string | null;

  /** Minutes de la semaine au moment de l'approbation (information). */
  @Prop({ type: Number, default: null })
  approvedMinutes!: number | null;

  /** Motif du dernier renvoi ou de la dernière réouverture. */
  @Prop({ type: String, default: null })
  reason!: string | null;

  @Prop({ type: [Object], default: [] })
  history!: TimesheetHistoryEntry[];

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type WorkTimesheetWeekDocument = HydratedDocument<WorkTimesheetWeek>;
export type WorkTimesheetWeekLean = WorkTimesheetWeek & { _id: Types.ObjectId };
export const WorkTimesheetWeekSchema = SchemaFactory.createForClass(WorkTimesheetWeek);
WorkTimesheetWeekSchema.index({ organizationId: 1, userId: 1, week: 1 }, { unique: true });
WorkTimesheetWeekSchema.index({ organizationId: 1, status: 1, week: 1 });
