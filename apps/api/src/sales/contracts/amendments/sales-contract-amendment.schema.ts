// Collection `sales_contract_amendments` — ADR-0050 § 2.5. ADR-0050 — V3.
//
// Un AVENANT modifie un contrat SIGNÉ à une date d'effet. Il porte le contenu COMPLET
// des champs qu'il change (`lines`, `billing`, `initialTermMonths`, `renewal`,
// `noticeDays`, `clauses`) ; ce qu'il ne fournit pas est repris du contrat en vigueur.
// Même cycle que le contrat, sans « Résilier » : draft → submitted → approved → signed,
// ou cancelled. Un avenant non signé n'a AUCUN effet : les conditions en vigueur sont
// calculées par le moteur (`termsAt`) à partir des seuls avenants signés.

import {
  SALES_CONTRACT_AMENDMENT_PURPOSES,
  SALES_CONTRACT_AMENDMENT_STATUSES,
  type SalesContractAmendmentPurpose,
  type SalesContractAmendmentStatus,
} from '@lalanda/shared/sales-contracts';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

import type { StoredDocumentAmounts } from '../../invoices/invoice.types.js';
import type { EngagementLine } from '../common/engagement-document.js';
import type {
  StoredApproval,
  StoredContractBilling,
  StoredContractStep,
  StoredRenewalClause,
  StoredSignature,
} from '../contracts/sales-contract.schema.js';

/** Champs changés ; absent = repris des conditions en vigueur. */
export interface StoredAmendmentChanges {
  lines?: EngagementLine[];
  /** Montants indicatifs des lignes changées, recopiés du moteur. */
  documentAmounts?: StoredDocumentAmounts;
  billing?: StoredContractBilling;
  initialTermMonths?: number | null;
  renewal?: StoredRenewalClause;
  noticeDays?: number;
  clauses?: string | null;
}

@Schema({
  collection: 'sales_contract_amendments',
  timestamps: true,
  strict: true,
  minimize: false,
})
export class SalesContractAmendment {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  contractId!: string;

  /** Avenant n° 1, 2… ; numéro affiché `CT…-A{index}`. */
  @Prop({ type: Number, required: true })
  index!: number;

  @Prop({ type: String, required: true })
  number!: string;

  @Prop({ type: String, required: true })
  effectiveDate!: string;

  @Prop({ type: String, required: true, enum: [...SALES_CONTRACT_AMENDMENT_PURPOSES] })
  purpose!: SalesContractAmendmentPurpose;

  @Prop({ type: Object, required: true })
  changes!: StoredAmendmentChanges;

  @Prop({ type: String, required: true, enum: [...SALES_CONTRACT_AMENDMENT_STATUSES] })
  status!: SalesContractAmendmentStatus;

  @Prop({ type: Date, default: null })
  submittedAt!: Date | null;

  @Prop({ type: String, default: null })
  submittedBy!: string | null;

  @Prop({ type: Date, default: null })
  approvedAt!: Date | null;

  @Prop({ type: [Object], default: [] })
  approvals!: StoredApproval[];

  @Prop({ type: Object, default: null })
  signature!: StoredSignature | null;

  @Prop({ type: Object, default: null })
  cancellation!: StoredContractStep | null;

  @Prop({ type: String, default: null })
  contentSha256!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type SalesContractAmendmentDocument = HydratedDocument<SalesContractAmendment>;
export type SalesContractAmendmentLean = SalesContractAmendment & { _id: Types.ObjectId };
export const SalesContractAmendmentSchema = SchemaFactory.createForClass(SalesContractAmendment);
SalesContractAmendmentSchema.index(
  { organizationId: 1, contractId: 1, index: 1 },
  { unique: true },
);
SalesContractAmendmentSchema.index({ organizationId: 1, status: 1 });

// Le type `StoredRenewalClause` est réexporté pour les lecteurs des avenants (V5, V6).
export type { StoredRenewalClause };
