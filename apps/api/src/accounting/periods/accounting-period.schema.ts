// Exercices et périodes (`accounting_fiscal_years`, `accounting_periods`, ADR-0049 § 2.7).
// ADR-0049 — K4 : STRUCTURE seulement. Les clôtures, réouvertures (`closedAt`,
// `closedBy`, `reopenLog`) relèvent du lot K6, qui écrit ces champs.

import type {
  AccountingFiscalYearStatus,
  AccountingPeriodStatus,
} from '@lalanda/shared/accounting';
import { Schema as MongooseSchema } from 'mongoose';

import { accountingBaseFields, type AccountingBase } from '../accounting-base.schema.js';

export interface ReopenLogEntry {
  at: Date;
  by: string;
  reason: string;
}

export type AccountingFiscalYearLean = AccountingBase & {
  year: number;
  start: string;
  end: string;
  status: AccountingFiscalYearStatus;
  closedAt: Date | null;
  closedBy: string | null;
  reopenLog: ReopenLogEntry[];
};

export class AccountingFiscalYear {}
export const AccountingFiscalYearSchema = new MongooseSchema(
  {
    ...accountingBaseFields,
    year: { type: Number, required: true },
    start: { type: String, required: true },
    end: { type: String, required: true },
    status: { type: String, required: true, enum: ['open', 'closing', 'closed'] },
    closedAt: { type: Date, default: null },
    closedBy: { type: String, default: null },
    reopenLog: { type: [Object], required: true, default: [] },
  },
  { collection: 'accounting_fiscal_years', timestamps: true, strict: true, minimize: false },
);
AccountingFiscalYearSchema.index({ organizationId: 1, year: 1 }, { unique: true });

export type AccountingPeriodLean = AccountingBase & {
  fiscalYear: number;
  /** Mois civil de la période (`year`, `month` de 1 à 12). */
  year: number;
  month: number;
  start: string;
  end: string;
  status: AccountingPeriodStatus;
  closedAt: Date | null;
  closedBy: string | null;
  reopenLog: ReopenLogEntry[];
};

export class AccountingPeriod {}
export const AccountingPeriodSchema = new MongooseSchema(
  {
    ...accountingBaseFields,
    fiscalYear: { type: Number, required: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    start: { type: String, required: true },
    end: { type: String, required: true },
    status: { type: String, required: true, enum: ['open', 'closed'] },
    closedAt: { type: Date, default: null },
    closedBy: { type: String, default: null },
    reopenLog: { type: [Object], required: true, default: [] },
  },
  { collection: 'accounting_periods', timestamps: true, strict: true, minimize: false },
);
AccountingPeriodSchema.index({ organizationId: 1, year: 1, month: 1 }, { unique: true });
AccountingPeriodSchema.index({ organizationId: 1, fiscalYear: 1 });
