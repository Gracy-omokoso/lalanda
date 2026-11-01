// Réglages de la comptabilité, un document par organisation (`accounting_settings`,
// ADR-0049 § 2.2). ADR-0049 — K4.
//
// `mode` vaut `off` par défaut ; `bookCurrency` et `cutoverDate` n'ont AUCUN défaut.

import type {
  AccountingBookCurrency,
  AccountingMode,
  AccountingStockPostingMode,
} from '@lalanda/shared/accounting';
import { Schema as MongooseSchema } from 'mongoose';

import { accountingBaseFields, type AccountingBase } from '../accounting-base.schema.js';

export type AccountingSettingsLean = AccountingBase & {
  mode: AccountingMode;
  chartPack: { slug: string; version: number } | null;
  bookCurrency: AccountingBookCurrency | null;
  cutoverDate: string | null;
  fiscalYearStartMonth: number;
  stockPosting: AccountingStockPostingMode;
  depreciationPosting: 'off';
  ruleSetVersion: number | null;
  activatedAt: Date | null;
  activatedBy: string | null;
};

export class AccountingSettings {}
export const AccountingSettingsSchema = new MongooseSchema(
  {
    ...accountingBaseFields,
    mode: { type: String, required: true, enum: ['off', 'simulation', 'active'], default: 'off' },
    chartPack: { type: Object, default: null },
    bookCurrency: { type: String, enum: ['CDF', 'USD', null], default: null },
    cutoverDate: { type: String, default: null },
    fiscalYearStartMonth: { type: Number, required: true, min: 1, max: 12 },
    stockPosting: { type: String, required: true, enum: ['off', 'perpetual'] },
    depreciationPosting: { type: String, required: true, enum: ['off'] },
    ruleSetVersion: { type: Number, default: null },
    activatedAt: { type: Date, default: null },
    activatedBy: { type: String, default: null },
  },
  { collection: 'accounting_settings', timestamps: true, strict: true, minimize: false },
);
AccountingSettingsSchema.index({ organizationId: 1 }, { unique: true });
