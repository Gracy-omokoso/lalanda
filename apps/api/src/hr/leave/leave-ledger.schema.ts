// Grand livre des soldes (ADR-0045 § 2.7). ADR-0045 — H3.
//
// AJOUT SEUL : aucun mouvement n'est modifié ni effacé. Le solde est calculé par le
// moteur (`leaveBalance`), jamais stocké. Idempotence de la tâche `hr.leave-accruals`
// par index uniques partiels : une acquisition par période, un report et une
// expiration par année de congé ; un débit et une restitution par demande.

import type { LeaveLedgerKind } from '@lalanda/shared/hr';
import { LEAVE_LEDGER_KINDS } from '@lalanda/shared/hr';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({
  collection: 'hr_leave_ledger',
  timestamps: { createdAt: true, updatedAt: false },
  strict: true,
})
export class LeaveLedgerEntry {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  employeeId!: string;

  @Prop({ type: String, required: true })
  typeId!: string;

  @Prop({ type: String, required: true, enum: LEAVE_LEDGER_KINDS })
  kind!: LeaveLedgerKind;

  /** Signé : crédit positif, débit négatif (chaîne décimale). */
  @Prop({ type: String, required: true })
  days!: string;

  @Prop({ type: String, required: true })
  effectiveOn!: string;

  @Prop({ type: Number, required: true })
  leaveYear!: number;

  @Prop({ type: String, default: null })
  requestId!: string | null;

  /** Période d'acquisition (`AAAA-MM` ou `AAAA-MM-JJ`). */
  @Prop({ type: String, default: null })
  period!: string | null;

  @Prop({ type: String, default: null })
  note!: string | null;

  /** `system` pour la tâche planifiée. */
  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
}

export type LeaveLedgerEntryDocument = HydratedDocument<LeaveLedgerEntry>;
export type LeaveLedgerEntryLean = LeaveLedgerEntry & { _id: Types.ObjectId };
export const LeaveLedgerEntrySchema = SchemaFactory.createForClass(LeaveLedgerEntry);

LeaveLedgerEntrySchema.index({ organizationId: 1, employeeId: 1, typeId: 1, effectiveOn: 1 });
LeaveLedgerEntrySchema.index(
  { organizationId: 1, employeeId: 1, typeId: 1, kind: 1, period: 1 },
  {
    unique: true,
    partialFilterExpression: { kind: 'accrual' },
    name: 'hr_ledger_accrual_unique',
  },
);
LeaveLedgerEntrySchema.index(
  { organizationId: 1, employeeId: 1, typeId: 1, kind: 1, leaveYear: 1 },
  {
    unique: true,
    partialFilterExpression: { kind: 'carry_over' },
    name: 'hr_ledger_carry_over_unique',
  },
);
LeaveLedgerEntrySchema.index(
  { organizationId: 1, employeeId: 1, typeId: 1, kind: 1, leaveYear: 1 },
  {
    unique: true,
    partialFilterExpression: { kind: 'expiry' },
    name: 'hr_ledger_expiry_unique',
  },
);
LeaveLedgerEntrySchema.index(
  { organizationId: 1, requestId: 1, kind: 1 },
  {
    unique: true,
    partialFilterExpression: { kind: { $in: ['taken', 'taken_reversal'] } },
    name: 'hr_ledger_request_unique',
  },
);
