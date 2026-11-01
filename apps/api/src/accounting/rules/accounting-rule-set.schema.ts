// Règles de correspondance versionnées (`accounting_rule_sets`, ADR-0049 § 2.4). ADR-0049 — K4.
//
// `draft → validated → superseded` ; une version `validated` est IMMUABLE. Une règle
// `requiresReview` n'est jamais appliquée par le moteur (`resolveRule`).

import type { AccountingRuleSetStatus } from '@lalanda/shared/accounting';
import { Schema as MongooseSchema } from 'mongoose';

import { accountingBaseFields, type AccountingBase } from '../accounting-base.schema.js';

export interface StoredRule {
  key: string;
  debit: string[];
  credit: string[];
  requiresReview: boolean;
}

export type AccountingRuleSetLean = AccountingBase & {
  version: number;
  status: AccountingRuleSetStatus;
  rules: StoredRule[];
  basedOn: { packSlug: string; packVersion: number } | null;
  validation: {
    by: string;
    at: Date;
    soleApprover: boolean;
    expertReview: {
      declared: boolean;
      name: string | null;
      date: string | null;
      note: string | null;
    };
  } | null;
};

export class AccountingRuleSet {}
export const AccountingRuleSetSchema = new MongooseSchema(
  {
    ...accountingBaseFields,
    version: { type: Number, required: true },
    status: { type: String, required: true, enum: ['draft', 'validated', 'superseded'] },
    rules: { type: [Object], required: true, default: [] },
    basedOn: { type: Object, default: null },
    validation: { type: Object, default: null },
  },
  { collection: 'accounting_rule_sets', timestamps: true, strict: true, minimize: false },
);
AccountingRuleSetSchema.index({ organizationId: 1, version: 1 }, { unique: true });
/** Un seul brouillon à la fois par organisation. */
AccountingRuleSetSchema.index(
  { organizationId: 1 },
  { unique: true, partialFilterExpression: { status: 'draft' }, name: 'one_draft_per_org' },
);
