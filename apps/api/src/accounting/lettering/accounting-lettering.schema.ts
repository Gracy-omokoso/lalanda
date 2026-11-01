// Lettrage (`accounting_lettering`, ADR-0049 § 2.7, § 6.11). ADR-0049 — K5.
//
// Événements en AJOUT SEUL : `letter` (code, lignes) puis, éventuellement, `unletter`
// (même code). L'état courant se rejoue par `resolveLettering` (moteur) ; le code actif
// est recopié sur les lignes (`lines[].letteringCode`) pour la lecture, hors empreinte.

import { Schema as MongooseSchema, type Types } from 'mongoose';

export type AccountingLetteringLean = {
  _id: Types.ObjectId;
  organizationId: string;
  code: string;
  accountNumber: string;
  auxiliary: string | null;
  currency: string;
  lineRefs: string[];
  action: 'letter' | 'unletter';
  automatic: boolean;
  bookDifference: string | null;
  at: Date;
  by: string;
  _schemaVersion: number;
};

export class AccountingLettering {}
export const AccountingLetteringSchema = new MongooseSchema(
  {
    organizationId: { type: String, required: true },
    code: { type: String, required: true },
    accountNumber: { type: String, required: true },
    auxiliary: { type: String, default: null },
    currency: { type: String, required: true },
    lineRefs: { type: [String], required: true },
    action: { type: String, required: true, enum: ['letter', 'unletter'] },
    automatic: { type: Boolean, required: true },
    bookDifference: { type: String, default: null },
    at: { type: Date, required: true },
    by: { type: String, required: true },
    _schemaVersion: { type: Number, required: true, default: 1 },
  },
  { collection: 'accounting_lettering', timestamps: false, strict: true, minimize: false },
);
AccountingLetteringSchema.index({ organizationId: 1, code: 1, action: 1 }, { unique: true });
