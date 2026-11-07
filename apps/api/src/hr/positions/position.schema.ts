// Référentiel des postes (ADR-0068 § 3). Collection `hr_positions`.
//
// `positionNumber` (`POS-001`) vient du compteur `POS` de `hr_counters` : jamais
// réutilisé, même d'un poste supprimé (le document reste, statut `deleted`). Un poste
// vacant (`open`) se pourvoit « poste pour poste » ; la sortie du titulaire le rend
// vacant sans le supprimer. `holders` garde l'historique des titulaires.

import { HR_POSITION_STATUSES, type HrPositionStatus } from '@lalanda/shared/hr';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

export interface PositionHolder {
  employeeId: string;
  from: string;
  to: string | null;
}

@Schema({ collection: 'hr_positions', timestamps: true, strict: true })
export class Position {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  positionNumber!: string;

  /** Clé d'unicité (`employeeNumberKey` du numéro). */
  @Prop({ type: String, required: true })
  positionNumberKey!: string;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, default: null })
  departmentId!: string | null;

  @Prop({ type: String, required: true, enum: HR_POSITION_STATUSES, default: 'open' })
  status!: HrPositionStatus;

  @Prop({ type: String, default: null })
  holderEmployeeId!: string | null;

  /** Historique `{ employeeId, from, to }` (dates d'entrée et de sortie). */
  @Prop({ type: [Object], default: [] })
  holders!: PositionHolder[];

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

export type PositionDocument = HydratedDocument<Position>;
export type PositionLean = Position & { _id: Types.ObjectId };
export const PositionSchema = SchemaFactory.createForClass(Position);

PositionSchema.index(
  { organizationId: 1, positionNumberKey: 1 },
  { unique: true, name: 'hr_position_number_unique' },
);
PositionSchema.index({ organizationId: 1, status: 1, positionNumberKey: 1 });
PositionSchema.index(
  { organizationId: 1, holderEmployeeId: 1 },
  { partialFilterExpression: { holderEmployeeId: { $type: 'string' } } },
);
