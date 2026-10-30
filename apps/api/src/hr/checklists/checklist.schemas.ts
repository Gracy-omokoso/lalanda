// Modèles et listes d'entrée et de sortie (ADR-0045 § 2.9, O4). ADR-0045 — H4.
//
// Les listes ne sont PAS des tâches RUN : un projet RUN est visible de toute
// l'organisation (ADR-0039 O7) et « Reprendre l'ordinateur de X » y annoncerait un
// départ. Chaque élément n'apparaît que dans « Mes tâches » de SON assigné (port
// `HR_CHECKLIST_AGENDA`, à la lecture). Libellés des modèles proposés : sans portée
// légale.

import type { HrChecklistAssignee, HrChecklistKind } from '@lalanda/shared/hr';
import { HR_CHECKLIST_KINDS } from '@lalanda/shared/hr';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

export const HR_CHECKLISTS_COLLECTION = 'hr_checklists';

export interface ChecklistTemplateItemDoc {
  id: string;
  label: string;
  assignee: HrChecklistAssignee;
  offsetDays: number;
  note: string | null;
}

@Schema({ collection: 'hr_checklist_templates', timestamps: true, strict: true })
export class ChecklistTemplate {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** Modèle proposé à l'activation (`default_onboarding`, `default_offboarding`), sinon `null`. */
  @Prop({ type: String, default: null })
  key!: string | null;

  @Prop({ type: String, required: true, enum: HR_CHECKLIST_KINDS })
  kind!: HrChecklistKind;

  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: [Object], required: true })
  items!: ChecklistTemplateItemDoc[];

  /** Faux : retiré (`DELETE`) ; les listes déjà instanciées gardent leurs éléments. */
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

export type ChecklistTemplateDocument = HydratedDocument<ChecklistTemplate>;
export type ChecklistTemplateLean = ChecklistTemplate & { _id: Types.ObjectId };
export const ChecklistTemplateSchema = SchemaFactory.createForClass(ChecklistTemplate);

ChecklistTemplateSchema.index(
  { organizationId: 1, key: 1 },
  {
    unique: true,
    name: 'hr_checklist_template_key_unique',
    partialFilterExpression: { key: { $type: 'string' } },
  },
);
ChecklistTemplateSchema.index({ organizationId: 1, kind: 1, active: 1 });

export interface ChecklistItemDoc {
  id: string;
  label: string;
  note: string | null;
  /** Assigné résolu à l'instanciation (un compte membre). */
  assigneeUserId: string;
  dueDate: string;
  doneAt: Date | null;
  doneBy: string | null;
}

@Schema({ collection: HR_CHECKLISTS_COLLECTION, timestamps: true, strict: true })
export class Checklist {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  employeeId!: string;

  @Prop({ type: String, required: true })
  templateId!: string;

  @Prop({ type: String, required: true, enum: HR_CHECKLIST_KINDS })
  kind!: HrChecklistKind;

  @Prop({ type: String, required: true })
  label!: string;

  /** Date d'entrée (accueil) ou de sortie (départ) à l'instanciation. */
  @Prop({ type: String, required: true })
  pivotDate!: string;

  @Prop({ type: [Object], required: true })
  items!: ChecklistItemDoc[];

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

export type ChecklistDocument = HydratedDocument<Checklist>;
export type ChecklistLean = Checklist & { _id: Types.ObjectId };
export const ChecklistSchema = SchemaFactory.createForClass(Checklist);

ChecklistSchema.index(
  { organizationId: 1, 'items.assigneeUserId': 1, 'items.doneAt': 1 },
  { name: 'hr_checklist_assignee' },
);
ChecklistSchema.index({ organizationId: 1, employeeId: 1, createdAt: -1 });
