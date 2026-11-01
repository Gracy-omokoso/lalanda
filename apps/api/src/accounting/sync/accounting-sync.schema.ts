// Points de lecture de la synchronisation (`accounting_sync_checkpoints`, ADR-0049 § 2.7)
// et rattachement des comptes de trésorerie au plan (`accounting_treasury_links`).
// ADR-0049 — K5.
//
// Un point de lecture retient, par source, l'horodatage de la dernière pièce lue : la
// synchronisation suivante relit à partir de lui (chevauchement voulu, l'idempotence par
// clé de source rend la relecture inerte).
//
// `accounting_treasury_links` : l'ADR (§ 2.4) dit que le jeton `{treasuryAccount}` se
// résout « par `accountId` » sans dire où vit le compte du plan d'un compte de
// trésorerie ; ce rattachement, saisi par l'organisation (`accounting.manage`), le porte.
// Rien n'est posé d'office : sans rattachement, la ligne va au compte d'attente.

import type { AccountingSyncSource } from '@lalanda/shared/accounting';
import { Schema as MongooseSchema, type Types } from 'mongoose';

import { accountingBaseFields, type AccountingBase } from '../accounting-base.schema.js';

export type AccountingSyncCheckpointLean = {
  _id: Types.ObjectId;
  organizationId: string;
  source: AccountingSyncSource;
  lastUpdatedAt: Date | null;
  lastRunAt: Date;
  _schemaVersion: number;
};
export class AccountingSyncCheckpoint {}
export const AccountingSyncCheckpointSchema = new MongooseSchema(
  {
    organizationId: { type: String, required: true },
    source: { type: String, required: true },
    lastUpdatedAt: { type: Date, default: null },
    lastRunAt: { type: Date, required: true },
    _schemaVersion: { type: Number, required: true, default: 1 },
  },
  { collection: 'accounting_sync_checkpoints', timestamps: true, strict: true, minimize: false },
);
AccountingSyncCheckpointSchema.index({ organizationId: 1, source: 1 }, { unique: true });

export type AccountingTreasuryLinkLean = AccountingBase & {
  treasuryAccountId: string;
  accountNumber: string;
};
export class AccountingTreasuryLink {}
export const AccountingTreasuryLinkSchema = new MongooseSchema(
  {
    ...accountingBaseFields,
    treasuryAccountId: { type: String, required: true },
    accountNumber: { type: String, required: true },
  },
  { collection: 'accounting_treasury_links', timestamps: true, strict: true, minimize: false },
);
AccountingTreasuryLinkSchema.index({ organizationId: 1, treasuryAccountId: 1 }, { unique: true });
