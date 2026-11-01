// Taux SAISIS (`accounting_exchange_rates`, ADR-0049 § 2.7, § 5). ADR-0049 — K4.
//
// 1 `from` = `rate` `to` à la date ; jamais importé d'office, jamais déduit.

import type { AccountingBookCurrency } from '@lalanda/shared/accounting';
import { Schema as MongooseSchema } from 'mongoose';

import { accountingBaseFields, type AccountingBase } from '../accounting-base.schema.js';

export type AccountingExchangeRateLean = AccountingBase & {
  date: string;
  from: AccountingBookCurrency;
  to: AccountingBookCurrency;
  rate: string;
  sourceText: string;
  enteredBy: string;
};

export class AccountingExchangeRate {}
export const AccountingExchangeRateSchema = new MongooseSchema(
  {
    ...accountingBaseFields,
    date: { type: String, required: true },
    from: { type: String, required: true, enum: ['CDF', 'USD'] },
    to: { type: String, required: true, enum: ['CDF', 'USD'] },
    rate: { type: String, required: true },
    sourceText: { type: String, required: true },
    enteredBy: { type: String, required: true },
  },
  { collection: 'accounting_exchange_rates', timestamps: true, strict: true, minimize: false },
);
AccountingExchangeRateSchema.index(
  { organizationId: 1, date: 1, from: 1, to: 1 },
  { unique: true },
);
