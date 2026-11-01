// Journaux (`accounting_journals`, ADR-0049 § 2.5). ADR-0049 — K4.

import type { AccountingJournalKind } from '@lalanda/shared/accounting';
import { Schema as MongooseSchema } from 'mongoose';

import { accountingBaseFields, type AccountingBase } from '../accounting-base.schema.js';

export type AccountingJournalLean = AccountingBase & {
  code: string;
  label: string;
  kind: AccountingJournalKind;
  treasuryAccountId: string | null;
  active: boolean;
};

export class AccountingJournal {}
export const AccountingJournalSchema = new MongooseSchema(
  {
    ...accountingBaseFields,
    code: { type: String, required: true },
    label: { type: String, required: true },
    kind: {
      type: String,
      required: true,
      enum: ['sales', 'purchases', 'treasury', 'misc', 'opening'],
    },
    treasuryAccountId: { type: String, default: null },
    active: { type: Boolean, required: true, default: true },
  },
  { collection: 'accounting_journals', timestamps: true, strict: true, minimize: false },
);
AccountingJournalSchema.index({ organizationId: 1, code: 1 }, { unique: true });
