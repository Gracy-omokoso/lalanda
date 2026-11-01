// Champs communs des collections comptables d'une organisation (ADR-0049 § 2). ADR-0049 — K4.
//
// `organizationId` (isolation stricte, 404 hors organisation), `createdBy`, `updatedBy`,
// `revision`, `_schemaVersion`, horodatages. Réutilisé par les lots K5 à K7.

import type { Types } from 'mongoose';

export type AccountingBase = {
  _id: Types.ObjectId;
  organizationId: string;
  revision: number;
  createdBy: string;
  updatedBy: string;
  _schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export const accountingBaseFields = {
  organizationId: { type: String, required: true },
  revision: { type: Number, required: true, default: 1 },
  createdBy: { type: String, required: true },
  updatedBy: { type: String, required: true },
  _schemaVersion: { type: Number, required: true, default: 1 },
};
