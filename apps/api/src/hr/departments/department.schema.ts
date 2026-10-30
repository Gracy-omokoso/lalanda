// Services (ADR-0045 § 2.3). ADR-0045 — H2.
//
// Nom unique par organisation PARMI LES ACTIFS (`nameKey`, index partiel) ; arbre sans
// cycle, profondeur ≤ 8 (moteur `departmentCycle`). `headEmployeeId` est le
// responsable AFFICHÉ, pas le manager des membres du service.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'hr_departments', timestamps: true, strict: true })
export class Department {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  /** Nom normalisé : unicité parmi les actifs et tri. */
  @Prop({ type: String, required: true })
  nameKey!: string;

  @Prop({ type: String, default: null })
  parentId!: string | null;

  @Prop({ type: String, default: null })
  headEmployeeId!: string | null;

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

export type DepartmentDocument = HydratedDocument<Department>;
export type DepartmentLean = Department & { _id: Types.ObjectId };
export const DepartmentSchema = SchemaFactory.createForClass(Department);

DepartmentSchema.index({ organizationId: 1, parentId: 1 });
DepartmentSchema.index(
  { organizationId: 1, nameKey: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true },
    name: 'hr_department_name_unique',
  },
);
