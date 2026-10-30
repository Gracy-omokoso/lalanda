// Demandes d'absence (ADR-0045 § 2.7). ADR-0045 — H3.
//
// `days` est calculé par le moteur (`leaveDays`) à la soumission ; `steps` est figé à
// la soumission (`leaveApprovalSteps`) ; `approvals` porte chaque décision, avec
// l'approbateur unique (`soleApprover`) et la suppléance du manager
// (`onBehalfOfManager`) marqués. Une ressource d'une autre organisation : 404.

import type {
  LeaveApprovalDecisionValue,
  LeaveApprovalStepKey,
  LeaveHalf,
  LeaveRequestStatus,
} from '@lalanda/shared/hr';
import { LEAVE_REQUEST_STATUSES } from '@lalanda/shared/hr';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

export interface StoredBound {
  date: string;
  half: LeaveHalf;
}

export interface StoredApproval {
  step: LeaveApprovalStepKey;
  userId: string;
  decision: LeaveApprovalDecisionValue;
  at: Date;
  comment: string | null;
  soleApprover: boolean;
  onBehalfOfManager: boolean;
}

@Schema({ collection: 'hr_leave_requests', timestamps: true, strict: true })
export class LeaveRequest {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  employeeId!: string;

  @Prop({ type: String, required: true })
  typeId!: string;

  @Prop({ type: Object, required: true })
  start!: StoredBound;

  @Prop({ type: Object, required: true })
  end!: StoredBound;

  /** Jours décomptés (chaîne décimale du moteur). */
  @Prop({ type: String, required: true })
  days!: string;

  @Prop({ type: String, default: null })
  reason!: string | null;

  /** Justificatif (`hr_documents`, lot H4) ; `null` tant qu'aucun n'est joint. */
  @Prop({ type: String, default: null })
  attachmentId!: string | null;

  @Prop({ type: String, required: true, enum: LEAVE_REQUEST_STATUSES })
  status!: LeaveRequestStatus;

  @Prop({ type: [String], required: true })
  steps!: LeaveApprovalStepKey[];

  @Prop({ type: [Object], default: [] })
  approvals!: StoredApproval[];

  /** Un débit `taken` a été écrit au grand livre (type qui débite le solde). */
  @Prop({ type: Boolean, default: false })
  debited!: boolean;

  @Prop({ type: Date, default: null })
  cancelledAt!: Date | null;

  @Prop({ type: String, default: null })
  cancelledBy!: string | null;

  @Prop({ type: String, default: null })
  cancelReason!: string | null;

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

export type LeaveRequestDocument = HydratedDocument<LeaveRequest>;
export type LeaveRequestLean = LeaveRequest & { _id: Types.ObjectId };
export const LeaveRequestSchema = SchemaFactory.createForClass(LeaveRequest);

LeaveRequestSchema.index({ organizationId: 1, employeeId: 1, 'start.date': 1 });
LeaveRequestSchema.index({ organizationId: 1, status: 1, 'start.date': 1 });
LeaveRequestSchema.index({ organizationId: 1, 'end.date': 1 });
