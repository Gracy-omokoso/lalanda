// Dossier collaborateur, données NON sensibles (ADR-0045 § 2.1). ADR-0045 — H2.
//
// Minimisation : ni sexe, ni date de naissance, ni nationalité, ni photo, ni situation
// familiale. Les données sensibles vivent dans `hr_employee_private`, jamais lue par
// les listes ni les fiches. `userId` relie facultativement un compte membre ; unique
// par organisation (index partiel). « À venir » et « en période d'essai » sont dérivés
// par le moteur (`employeeStatusOf`), jamais stockés.

import type { EmployeeExitCategory, EmployeeStatus, HrWorkPattern } from '@lalanda/shared/hr';
import { EMPLOYEE_EXIT_CATEGORIES, EMPLOYEE_STATUSES } from '@lalanda/shared/hr';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'hr_employees', timestamps: true, strict: true })
export class Employee {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  firstName!: string;

  @Prop({ type: String, required: true })
  lastName!: string;

  @Prop({ type: String, default: null })
  preferredName!: string | null;

  /** Nom normalisé « nom prénom » — tri et curseur. */
  @Prop({ type: String, required: true })
  sortName!: string;

  /** Noms, matricule, poste normalisés — recherche « contient ». */
  @Prop({ type: String, required: true })
  searchKey!: string;

  @Prop({ type: String, default: null })
  employeeNumber!: string | null;

  /** Clé d'unicité du matricule (`employeeNumberKey`), ou `null`. */
  @Prop({ type: String, default: null })
  employeeNumberKey!: string | null;

  @Prop({ type: String, default: null })
  userId!: string | null;

  @Prop({ type: String, default: null })
  workEmail!: string | null;

  @Prop({ type: String, default: null })
  workPhone!: string | null;

  @Prop({ type: String, required: true })
  jobTitle!: string;

  @Prop({ type: String, default: null })
  departmentId!: string | null;

  @Prop({ type: String, default: null })
  managerEmployeeId!: string | null;

  @Prop({ type: String, required: true })
  contractType!: string;

  @Prop({ type: String, required: true })
  startDate!: string;

  @Prop({ type: String, default: null })
  probationEndDate!: string | null;

  @Prop({ type: String, default: null })
  contractEndDate!: string | null;

  @Prop({ type: String, default: null })
  endDate!: string | null;

  @Prop({ type: String, enum: [...EMPLOYEE_EXIT_CATEGORIES, null], default: null })
  exitCategory!: EmployeeExitCategory | null;

  @Prop({ type: String, required: true, enum: EMPLOYEE_STATUSES, default: 'active' })
  status!: EmployeeStatus;

  /** `null` = rythme de l'organisation (`hr_settings.workPattern`). */
  @Prop({ type: Object, default: null })
  workPattern!: HrWorkPattern | null;

  @Prop({ type: String, default: null })
  workLocation!: string | null;

  /** Exceptions d'acquisition par type d'absence (lot H3) ; `null` au lot H2. */
  @Prop({ type: Object, default: null })
  leavePolicyOverrides!: Record<string, unknown> | null;

  /** Texte brut, NON sensible par contrat d'interface. */
  @Prop({ type: String, default: null })
  notes!: string | null;

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

export type EmployeeDocument = HydratedDocument<Employee>;
export type EmployeeLean = Employee & { _id: Types.ObjectId };
export const EmployeeSchema = SchemaFactory.createForClass(Employee);

EmployeeSchema.index({ organizationId: 1, status: 1, sortName: 1, _id: 1 });
EmployeeSchema.index({ organizationId: 1, sortName: 1, _id: 1 });
EmployeeSchema.index({ organizationId: 1, departmentId: 1 });
EmployeeSchema.index({ organizationId: 1, managerEmployeeId: 1 });
EmployeeSchema.index(
  { organizationId: 1, contractEndDate: 1 },
  { partialFilterExpression: { contractEndDate: { $type: 'string' } } },
);
EmployeeSchema.index(
  { organizationId: 1, probationEndDate: 1 },
  { partialFilterExpression: { probationEndDate: { $type: 'string' } } },
);
EmployeeSchema.index(
  { organizationId: 1, employeeNumberKey: 1 },
  {
    unique: true,
    partialFilterExpression: { employeeNumberKey: { $type: 'string' } },
    name: 'hr_employee_number_unique',
  },
);
EmployeeSchema.index(
  { organizationId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { userId: { $type: 'string' } },
    name: 'hr_employee_user_unique',
  },
);
