// Collections `sales_contracts` et `sales_contract_counters` — ADR-0050 § 2.3, § 2.4.
// ADR-0050 — V3.
//
// Un CONTRAT est un engagement durable : lignes (formes du devis, composées par le code
// des factures), terme, reconduction, préavis, échéancier. Les clauses de durée, de
// reconduction et de préavis sont SAISIES par l'utilisateur ; les dates (fin de terme,
// date limite de préavis, terme suivant proposé) sont calculées à la lecture par le
// moteur (`contractTerms`, `termsAt`), jamais stockées.
//
// Cycle STOCKÉ : draft → submitted → approved → signed → terminated, ou cancelled.
// Avant la signature, « Nouvelle version » archive l'état dans `previousVersions`
// (motif des devis) ; après, le contenu est IMMUABLE (`contentSha256`) et toute
// modification passe par un avenant (`sales_contract_amendments`). `renewals` est en
// ajout seul.

import {
  SALES_CONTRACT_STATUSES,
  type SalesContractApprovalDecision,
  type SalesContractBillingFrequency,
  type SalesContractBillingTiming,
  type SalesContractNoticeCheck,
  type SalesContractRenewalMode,
  type SalesContractRenewalRecordMode,
  type SalesContractSignatorySide,
  type SalesContractStatus,
  type SalesContractTerminationParty,
} from '@lalanda/shared/sales-contracts';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

import type { StoredCustomer, StoredDocumentAmounts } from '../../invoices/invoice.types.js';
import type { EngagementLine } from '../common/engagement-document.js';

export interface StoredRenewalClause {
  mode: SalesContractRenewalMode;
  periodMonths: number | null;
  maxRenewals: number | null;
}

/** Échéance d'un `schedule` : ses lignes composées par le code des factures (aucun %). */
export interface StoredScheduleItem {
  itemRef: string;
  dueDate: string;
  label: string;
  lines: EngagementLine[];
  documentAmounts: StoredDocumentAmounts;
}

export type StoredContractBilling =
  | { kind: 'none' }
  | { kind: 'schedule'; items: StoredScheduleItem[] }
  | {
      kind: 'recurring';
      frequency: SalesContractBillingFrequency;
      anchorDate: string;
      timing: SalesContractBillingTiming;
      autoPrepare: boolean;
    };

export interface StoredApproval {
  userId: string;
  decision: SalesContractApprovalDecision;
  at: Date;
  comment: string | null;
  soleApprover: boolean;
}

export interface StoredSignatory {
  name: string;
  title: string | null;
  side: SalesContractSignatorySide;
}

export interface StoredSignature {
  signedOn: string;
  signatories: StoredSignatory[];
  fileId: string;
  declaredBy: string;
  declaredAt: Date;
}

export interface StoredRenewal {
  termIndex: number;
  from: string;
  to: string;
  recordedBy: string;
  recordedAt: Date;
  mode: SalesContractRenewalRecordMode;
  /** Avenant de renouvellement exprès (`explicit_amendment`), sinon `null`. */
  amendmentId: string | null;
}

export interface StoredTermination {
  noticeGivenOn: string;
  by: SalesContractTerminationParty;
  effectiveOn: string;
  reason: string;
  recordedBy: string;
  recordedAt: Date;
  noticeCheck: { result: SalesContractNoticeCheck; noticeDays: number; daysGiven: number };
}

/** Geste daté et motivé (annulation). */
export interface StoredContractStep {
  at: Date;
  by: string;
  reason: string;
}

/** Contenu versionné d'un contrat (ce que « Nouvelle version » archive et ce que l'empreinte couvre). */
export interface SalesContractContent {
  title: string;
  customerId: string;
  opportunityId: string | null;
  ownerUserId: string;
  currency: 'CDF' | 'USD';
  priceMode: 'ttc' | 'ht';
  customer: StoredCustomer;
  lines: EngagementLine[];
  documentAmounts: StoredDocumentAmounts;
  startDate: string;
  initialTermMonths: number | null;
  renewal: StoredRenewalClause;
  noticeDays: number;
  billing: StoredContractBilling;
  clauses: string | null;
}

/** Instantané figé d'une version antérieure (avant signature). */
export interface SalesContractVersionSnapshot extends SalesContractContent {
  version: number;
  status: SalesContractStatus;
  submittedAt: Date | null;
  submittedBy: string | null;
  approvals: StoredApproval[];
  archivedAt: Date;
  archivedBy: string;
}

export type SalesContractSource = { kind: 'quote'; quoteId: string; quoteVersion: number };

@Schema({ collection: 'sales_contracts', timestamps: true, strict: true, minimize: false })
export class SalesContract {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** `CT{AA}{MM}-NNNNNN` — hors série fiscale, trous admis. */
  @Prop({ type: String, required: true })
  number!: string;

  @Prop({ type: Number, required: true, default: 1 })
  version!: number;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, required: true, enum: [...SALES_CONTRACT_STATUSES] })
  status!: SalesContractStatus;

  @Prop({ type: String, required: true })
  customerId!: string;

  @Prop({ type: String, default: null })
  opportunityId!: string | null;

  @Prop({ type: Object, default: null })
  source!: SalesContractSource | null;

  /** Responsable, destinataire des alertes ; détient `sales.read` effectif. */
  @Prop({ type: String, required: true })
  ownerUserId!: string;

  @Prop({ type: String, required: true, enum: ['CDF', 'USD'] })
  currency!: 'CDF' | 'USD';

  @Prop({ type: String, required: true, enum: ['ttc', 'ht'] })
  priceMode!: 'ttc' | 'ht';

  @Prop({ type: Object, required: true })
  customer!: StoredCustomer;

  @Prop({ type: [Object], default: [] })
  lines!: EngagementLine[];

  /** Montants INDICATIFS (par période pour un abonnement), recopiés du moteur. */
  @Prop({ type: Object, required: true })
  documentAmounts!: StoredDocumentAmounts;

  @Prop({ type: String, required: true })
  startDate!: string;

  @Prop({ type: Number, default: null })
  initialTermMonths!: number | null;

  @Prop({ type: Object, required: true })
  renewal!: StoredRenewalClause;

  @Prop({ type: Number, required: true })
  noticeDays!: number;

  @Prop({ type: Object, required: true })
  billing!: StoredContractBilling;

  @Prop({ type: String, default: null })
  clauses!: string | null;

  @Prop({ type: Date, default: null })
  submittedAt!: Date | null;

  @Prop({ type: String, default: null })
  submittedBy!: string | null;

  @Prop({ type: [Object], default: [] })
  approvals!: StoredApproval[];

  @Prop({ type: Object, default: null })
  signature!: StoredSignature | null;

  @Prop({ type: [Object], default: [] })
  renewals!: StoredRenewal[];

  @Prop({ type: Object, default: null })
  termination!: StoredTermination | null;

  @Prop({ type: Object, default: null })
  cancellation!: StoredContractStep | null;

  /** Projet RUN lié (ADR-0039) : non posé par ce lot. */
  @Prop({ type: String, default: null })
  projectId!: string | null;

  @Prop({ type: [Object], default: [] })
  previousVersions!: SalesContractVersionSnapshot[];

  /** Empreinte du contenu au passage en `signed`. */
  @Prop({ type: String, default: null })
  contentSha256!: string | null;

  @Prop({ type: String, required: true })
  searchKey!: string;

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

export type SalesContractDocument = HydratedDocument<SalesContract>;
export type SalesContractLean = SalesContract & { _id: Types.ObjectId };
export const SalesContractSchema = SchemaFactory.createForClass(SalesContract);
SalesContractSchema.index({ organizationId: 1, createdAt: -1, _id: -1 });
SalesContractSchema.index({ organizationId: 1, number: 1 }, { unique: true });
SalesContractSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
SalesContractSchema.index({ organizationId: 1, customerId: 1, createdAt: -1 });
SalesContractSchema.index({ organizationId: 1, 'source.quoteId': 1 });

/** Compteur annuel des contrats (Kinshasa) ; trous admis. */
@Schema({ collection: 'sales_contract_counters', strict: true })
export class SalesContractCounter {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: Number, required: true })
  year!: number;

  @Prop({ type: Number, required: true, default: 0 })
  last!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type SalesContractCounterDocument = HydratedDocument<SalesContractCounter>;
export const SalesContractCounterSchema = SchemaFactory.createForClass(SalesContractCounter);
SalesContractCounterSchema.index({ organizationId: 1, year: 1 }, { unique: true });
