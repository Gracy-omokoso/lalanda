// Plan de l'organisation (`accounting_accounts`, ADR-0049 § 2.3). ADR-0049 — K4.
//
// Les comptes du pack choisi ne sont PAS recopiés : ils sont lus du pack (copie
// RÉFÉRENCÉE). Un document `origin: 'pack'` n'existe que si l'organisation a précisé le
// libellé ou archivé le compte ; un compte propre (`origin: 'organization'`) prolonge un
// compte du pack. Les comptes auxiliaires (clients, fournisseurs) naissent à la première
// écriture qui les vise (lot K5) : `auxiliary` et `collectiveNumber` sont prévus ici.

import type { AccountingAccountOrigin, AccountingAuxiliaryKind } from '@lalanda/shared/accounting';
import { Schema as MongooseSchema } from 'mongoose';

import { accountingBaseFields, type AccountingBase } from '../accounting-base.schema.js';

export type AccountingAccountLean = AccountingBase & {
  number: string;
  origin: AccountingAccountOrigin;
  /** Compte du pack référencé (`origin: 'pack'`) ou prolongé (`origin: 'organization'`). */
  packAccountNumber: string;
  /** Précision (pack) ou libellé (compte propre) ; `null` : libellé du pack. */
  label: string | null;
  auxiliary: { kind: AccountingAuxiliaryKind; partyId: string } | null;
  collectiveNumber: string | null;
  active: boolean;
};

export class AccountingAccount {}
export const AccountingAccountSchema = new MongooseSchema(
  {
    ...accountingBaseFields,
    number: { type: String, required: true },
    origin: { type: String, required: true, enum: ['pack', 'organization'] },
    packAccountNumber: { type: String, required: true },
    label: { type: String, default: null },
    auxiliary: { type: Object, default: null },
    collectiveNumber: { type: String, default: null },
    active: { type: Boolean, required: true, default: true },
  },
  { collection: 'accounting_accounts', timestamps: true, strict: true, minimize: false },
);
AccountingAccountSchema.index({ organizationId: 1, number: 1 }, { unique: true });
