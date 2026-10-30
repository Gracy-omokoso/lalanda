// Jours fériés et de fermeture (ADR-0045 § 2.6). ADR-0045 — H3.
//
// Liste VIDE par défaut : Lalanda ne publie aucun calendrier des fériés tant qu'il
// n'est pas sourcé (Country Pack, décision ouverte n° 12). Un jour par organisation.

import type { HrHolidayHalf } from '@lalanda/shared/hr';
import { HR_HOLIDAY_HALVES } from '@lalanda/shared/hr';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'hr_holidays', timestamps: true, strict: true })
export class Holiday {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  date!: string;

  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: String, enum: [...HR_HOLIDAY_HALVES, null], default: null })
  halfDay!: HrHolidayHalf | null;

  /** Même jour (mois et quantième) chaque année. */
  @Prop({ type: Boolean, required: true, default: false })
  recurring!: boolean;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type HolidayDocument = HydratedDocument<Holiday>;
export type HolidayLean = Holiday & { _id: Types.ObjectId };
export const HolidaySchema = SchemaFactory.createForClass(Holiday);

HolidaySchema.index(
  { organizationId: 1, date: 1 },
  { unique: true, name: 'hr_holiday_date_unique' },
);
