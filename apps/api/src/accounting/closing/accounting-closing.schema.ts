// Journal des clôtures d'exercice (`accounting_closings`, ADR-0049 § 4). ADR-0049 — K6.
//
// Une ligne par clôture d'exercice, en ajout seul (seul `reopened` est posé, une fois, à la
// réouverture) : l'acceptation explicite du solde d'attente et son motif, l'écriture
// d'à-nouveaux générée par le moteur, le rang de la clôture (un exercice rouvert puis
// reclôturé reçoit un rang nouveau, d'où une clé de source nouvelle pour ses à-nouveaux).
// Les champs de l'exercice lui-même (`status`, `closedAt`, `closedBy`, `reopenLog`) vivent
// dans `accounting_fiscal_years` (K4), que ce lot écrit.

import { Schema as MongooseSchema, type Types } from 'mongoose';

export type AccountingClosingLean = {
  _id: Types.ObjectId;
  organizationId: string;
  fiscalYear: number;
  cycle: number;
  closedAt: Date;
  closedBy: string;
  suspenseAccepted: { reason: string; balance: string } | null;
  openingEntryId: string | null;
  nextFiscalYear: number;
  reopened: { at: Date; by: string; reason: string; reversalEntryId: string | null } | null;
  _schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export class AccountingClosing {}
export const AccountingClosingSchema = new MongooseSchema(
  {
    organizationId: { type: String, required: true },
    fiscalYear: { type: Number, required: true },
    cycle: { type: Number, required: true },
    closedAt: { type: Date, required: true },
    closedBy: { type: String, required: true },
    suspenseAccepted: { type: Object, default: null },
    openingEntryId: { type: String, default: null },
    nextFiscalYear: { type: Number, required: true },
    reopened: { type: Object, default: null },
    _schemaVersion: { type: Number, required: true, default: 1 },
  },
  { collection: 'accounting_closings', timestamps: true, strict: true, minimize: false },
);
AccountingClosingSchema.index({ organizationId: 1, fiscalYear: 1, cycle: 1 }, { unique: true });
