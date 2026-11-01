// Journal des exports (`accounting_exports`, ADR-0049 § 2.7, § 9) et fichiers remis
// (`accounting_export_files`). ADR-0049 — K6.
//
// Le JOURNAL est en ajout seul et ne s'efface pas : paramètres, empreinte SHA-256 du
// fichier, auteur, date. Le FICHIER, lui, a une durée de conservation limitée
// (`expiresAt`, index TTL) : passé ce délai, le journal reste et le téléchargement répond
// `410 ACCOUNTING_EXPORT_EXPIRED` ; un export nouveau se demande.

import { Schema as MongooseSchema, type Types } from 'mongoose';

/** Conservation d'un fichier exporté. */
export const ACCOUNTING_EXPORT_FILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AccountingExportLean = {
  _id: Types.ObjectId;
  organizationId: string;
  kind: string;
  format: string;
  from: string;
  to: string;
  mode: 'simulation' | 'active';
  simulation: boolean;
  fileName: string;
  contentType: string;
  sha256: string;
  size: number;
  bookCurrency: string;
  chartPack: { slug: string; version: number } | null;
  ruleSetVersions: number[];
  reserveCodes: string[];
  createdBy: string;
  expiresAt: Date;
  _schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export class AccountingExport {}
export const AccountingExportSchema = new MongooseSchema(
  {
    organizationId: { type: String, required: true },
    kind: { type: String, required: true },
    format: { type: String, required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    mode: { type: String, required: true, enum: ['simulation', 'active'] },
    simulation: { type: Boolean, required: true },
    fileName: { type: String, required: true },
    contentType: { type: String, required: true },
    sha256: { type: String, required: true },
    size: { type: Number, required: true },
    bookCurrency: { type: String, required: true },
    chartPack: { type: Object, default: null },
    ruleSetVersions: { type: [Number], required: true, default: [] },
    reserveCodes: { type: [String], required: true, default: [] },
    createdBy: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    _schemaVersion: { type: Number, required: true, default: 1 },
  },
  { collection: 'accounting_exports', timestamps: true, strict: true, minimize: false },
);
AccountingExportSchema.index({ organizationId: 1, createdAt: -1, _id: -1 });

export type AccountingExportFileLean = {
  _id: Types.ObjectId;
  organizationId: string;
  exportId: string;
  data: Buffer;
  expiresAt: Date;
};

export class AccountingExportFile {}
export const AccountingExportFileSchema = new MongooseSchema(
  {
    organizationId: { type: String, required: true },
    exportId: { type: String, required: true },
    data: { type: Buffer, required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'accounting_export_files', timestamps: true, strict: true },
);
AccountingExportFileSchema.index({ organizationId: 1, exportId: 1 }, { unique: true });
AccountingExportFileSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
