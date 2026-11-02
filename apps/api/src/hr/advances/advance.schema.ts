// Avances au personnel (ADR-0051 § 2.2). ADR-0051 — H10.
//
// `number` à la soumission (`AV{AA}{MM}-NNNNNN`) ; `outstanding` n'est JAMAIS stocké :
// le moteur le calcule (`advanceOutstanding`) à partir du versement et des
// régularisations, inscrites en AJOUT SEUL (un complément annulé avec le remboursement
// de sa note reste, marqué `cancelledAt`). Le motif d'une avance SUR SALAIRE est chiffré
// (`reasonSealed`, section `advanceReason`, AAD = organisation + avance) ; il n'est
// jamais en clair dans le document, une liste, un journal ni une notification.

import type {
  AdvanceKind,
  AdvanceSettlementKind,
  AdvanceStatus,
  ExpenseApprovalDecisionValue,
  ExpenseApprovalStepKey,
  HrCurrency,
  HrPaymentMethod,
} from '@lalanda/shared/hr';
import { ADVANCE_STATUSES } from '@lalanda/shared/hr';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

import type { EncryptedValue } from '../../integrations/secrets-crypto.js';

export interface StoredAdvanceApproval {
  step: ExpenseApprovalStepKey;
  userId: string;
  decision: ExpenseApprovalDecisionValue;
  at: Date;
  comment: string | null;
  soleApprover: boolean;
  onBehalfOfManager: boolean;
}

export interface StoredDisbursement {
  paidOn: string;
  accountId: string;
  method: HrPaymentMethod;
  reference: string | null;
  paidBy: string;
  paidAt: Date;
  movementId: string;
  soleApprover: boolean;
}

export interface StoredSettlement {
  id: string;
  kind: AdvanceSettlementKind;
  amount: string;
  on: string;
  reference: string | null;
  by: string;
  at: Date;
  note: string | null;
  movementId: string | null;
  expenseReportId: string | null;
  soleApprover: boolean;
  cancelledAt: Date | null;
  cancelledBy: string | null;
}

@Schema({ collection: 'hr_advances', timestamps: true, strict: true })
export class EmployeeAdvance {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, default: null })
  number!: string | null;

  @Prop({ type: String, required: true })
  employeeId!: string;

  @Prop({ type: String, required: true, enum: ['expenses', 'salary'] })
  kind!: AdvanceKind;

  @Prop({ type: String, required: true })
  amount!: string;

  @Prop({ type: String, required: true, enum: ['CDF', 'USD'] })
  currency!: HrCurrency;

  /** Motif en clair d'une avance DE FRAIS ; toujours `null` pour une avance sur salaire. */
  @Prop({ type: String, default: null })
  reason!: string | null;

  /** Motif chiffré d'une avance SUR SALAIRE. */
  @Prop({ type: Object, default: null })
  reasonSealed!: EncryptedValue | null;

  @Prop({ type: String, default: null })
  purpose!: string | null;

  @Prop({ type: String, default: null })
  workProjectId!: string | null;

  @Prop({ type: String, default: null })
  expectedSettlement!: string | null;

  @Prop({ type: String, required: true, enum: [...ADVANCE_STATUSES], default: 'draft' })
  status!: AdvanceStatus;

  @Prop({ type: [String], default: [] })
  steps!: ExpenseApprovalStepKey[];

  @Prop({ type: [Object], default: [] })
  approvals!: StoredAdvanceApproval[];

  @Prop({ type: Object, default: null })
  disbursement!: StoredDisbursement | null;

  @Prop({ type: [Object], default: [] })
  settlements!: StoredSettlement[];

  @Prop({ type: Date, default: null })
  submittedAt!: Date | null;

  @Prop({ type: String, default: null })
  submittedBy!: string | null;

  @Prop({ type: Date, default: null })
  approvedAt!: Date | null;

  @Prop({ type: String, default: null })
  cancelReason!: string | null;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type EmployeeAdvanceDocument = HydratedDocument<EmployeeAdvance>;
export type EmployeeAdvanceLean = EmployeeAdvance & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export const EmployeeAdvanceSchema = SchemaFactory.createForClass(EmployeeAdvance);

EmployeeAdvanceSchema.index(
  { organizationId: 1, employeeId: 1, status: 1 },
  { name: 'hr_advance_employee' },
);
EmployeeAdvanceSchema.index(
  { organizationId: 1, status: 1, kind: 1 },
  { name: 'hr_advance_status_kind' },
);
EmployeeAdvanceSchema.index(
  { organizationId: 1, number: 1 },
  {
    unique: true,
    name: 'hr_advance_number_unique',
    partialFilterExpression: { number: { $type: 'string' } },
  },
);

/** Le motif chiffré ne sort jamais du document par `toJSON` / `toObject`. */
function amputerLeMotif(_doc: unknown, ret: unknown): unknown {
  const bag = ret as Record<string, unknown>;
  if (bag['reasonSealed'] !== null && typeof bag['reasonSealed'] === 'object') {
    bag['reasonSealed'] = '[redacted]';
  }
  return bag;
}
EmployeeAdvanceSchema.set('toJSON', { transform: amputerLeMotif });
