// Notes de frais (ADR-0051 § 2.1). ADR-0051 — H10.
//
// `number` est attribué à la SOUMISSION (`NF{AA}{MM}-NNNNNN`) ; `steps` est figé à la
// soumission (`expenseApprovalSteps`) ; `total` n'est JAMAIS stocké : il est calculé
// par le moteur (`expenseReportTotals`) à chaque lecture. Le justificatif d'une ligne
// est un objet `hr-expense-receipts/<objectId>` (clé au hasard), chiffré par enveloppe
// quand le trousseau est configuré ; sa clé enveloppée n'est jamais servie.
// Une ressource d'une autre organisation : 404.

import type {
  ExpenseApprovalDecisionValue,
  ExpenseApprovalStepKey,
  ExpenseLineCategory,
  ExpenseReceiptContentType,
  ExpenseReportStatus,
  HrCurrency,
  HrPaymentMethod,
} from '@lalanda/shared/hr';
import { EXPENSE_REPORT_STATUSES } from '@lalanda/shared/hr';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

import type { EncryptedValue } from '../../integrations/secrets-crypto.js';

export interface StoredReceipt {
  objectId: string;
  contentType: ExpenseReceiptContentType;
  /** Taille du fichier en clair. */
  size: number;
  /** Taille stockée (chiffrée ou non) : compte dans la borne commune de 1 Gio. */
  storedSize: number;
  encrypted: boolean;
  wrappedKey: EncryptedValue | null;
  uploadedAt: Date;
  uploadedBy: string;
}

export interface StoredExpenseLine {
  id: string;
  spentOn: string;
  category: ExpenseLineCategory;
  label: string;
  amount: string;
  merchant: string | null;
  deductibleVat: string | null;
  workProjectId: string | null;
  rebillable: boolean;
  receipt: StoredReceipt | null;
  missingReceiptReason: string | null;
}

export interface StoredExpenseApproval {
  step: ExpenseApprovalStepKey;
  userId: string;
  decision: ExpenseApprovalDecisionValue;
  at: Date;
  comment: string | null;
  soleApprover: boolean;
  onBehalfOfManager: boolean;
}

/** Répartition d'une note liée à une avance (moteur `advanceSettlementPlan`), figée à l'approbation. */
export interface StoredAdvanceSettlementPlan {
  advanceId: string;
  fromAdvance: string;
  topUp: string;
  lines: { lineIndex: number; fromAdvance: string; topUp: string }[];
  /** Régularisation `expense_report` inscrite sur l'avance. */
  settlementId: string;
  expenseIds: string[];
}

export interface StoredReimbursement {
  paidOn: string;
  accountId: string | null;
  method: HrPaymentMethod;
  reference: string | null;
  paidBy: string;
  paidAt: Date;
  soleApprover: boolean;
  expenseIds: string[];
  /** Complément `top_up` inscrit sur l'avance liée, s'il y en a un. */
  topUpSettlementId: string | null;
}

@Schema({ collection: 'hr_expense_reports', timestamps: true, strict: true })
export class ExpenseReport {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, default: null })
  number!: string | null;

  @Prop({ type: String, required: true })
  employeeId!: string;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, required: true, enum: ['CDF', 'USD'] })
  currency!: HrCurrency;

  @Prop({ type: [Object], required: true })
  lines!: StoredExpenseLine[];

  @Prop({ type: String, default: null })
  advanceId!: string | null;

  @Prop({ type: String, required: true, enum: [...EXPENSE_REPORT_STATUSES], default: 'draft' })
  status!: ExpenseReportStatus;

  @Prop({ type: [String], default: [] })
  steps!: ExpenseApprovalStepKey[];

  @Prop({ type: [Object], default: [] })
  approvals!: StoredExpenseApproval[];

  @Prop({ type: Object, default: null })
  settlement!: StoredAdvanceSettlementPlan | null;

  @Prop({ type: Object, default: null })
  reimbursement!: StoredReimbursement | null;

  @Prop({ type: Date, default: null })
  submittedAt!: Date | null;

  @Prop({ type: String, default: null })
  submittedBy!: string | null;

  @Prop({ type: Date, default: null })
  approvedAt!: Date | null;

  @Prop({ type: String, default: null })
  cancelReason!: string | null;

  @Prop({ type: Date, default: null })
  cancelledAt!: Date | null;

  @Prop({ type: String, default: null })
  cancelledBy!: string | null;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type ExpenseReportDocument = HydratedDocument<ExpenseReport>;
export type ExpenseReportLean = ExpenseReport & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export const ExpenseReportSchema = SchemaFactory.createForClass(ExpenseReport);

ExpenseReportSchema.index(
  { organizationId: 1, employeeId: 1, status: 1, submittedAt: -1 },
  { name: 'hr_expense_report_employee' },
);
ExpenseReportSchema.index(
  { organizationId: 1, status: 1, submittedAt: -1 },
  { name: 'hr_expense_report_status' },
);
ExpenseReportSchema.index(
  { organizationId: 1, 'lines.workProjectId': 1 },
  {
    name: 'hr_expense_report_project',
    partialFilterExpression: { 'lines.workProjectId': { $type: 'string' } },
  },
);
ExpenseReportSchema.index(
  { organizationId: 1, number: 1 },
  {
    unique: true,
    name: 'hr_expense_report_number_unique',
    partialFilterExpression: { number: { $type: 'string' } },
  },
);

/** Clé d'un justificatif au stockage : jamais le nom de fichier. */
export function expenseReceiptObjectKey(objectId: string): string {
  return `hr-expense-receipts/${objectId}`;
}
