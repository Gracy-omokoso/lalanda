// Packs de plan comptable chargés par la plateforme (`accounting_chart_packs`, ADR-0049
// § 2.1). ADR-0049 — K4.
//
// Propriété de la PLATEFORME : aucun `organizationId`. Le contenu est le YAML lu par
// `parseChartPack` (moteur), figé avec son empreinte ; le statut suit le cycle de docs/09
// (`draft → review → approved → active → retired`), porté ici et non par le YAML. Une
// version au-delà de `draft` est immuable : une correction est une version nouvelle.

import type { ChartPack } from '@lalanda/engine';
import type { AccountingChartPackStatus } from '@lalanda/shared/accounting';
import { Schema as MongooseSchema, type Types } from 'mongoose';

export interface ChartPackHistoryEntry {
  action: 'loaded' | 'reloaded' | 'transition';
  from: AccountingChartPackStatus | null;
  to: AccountingChartPackStatus;
  by: string;
  at: Date;
}

export type AccountingChartPackLean = {
  _id: Types.ObjectId;
  slug: string;
  version: number;
  status: AccountingChartPackStatus;
  content: ChartPack;
  fingerprint: string;
  loadedBy: string;
  history: ChartPackHistoryEntry[];
  revision: number;
  _schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export class AccountingChartPack {}
export const AccountingChartPackSchema = new MongooseSchema(
  {
    slug: { type: String, required: true },
    version: { type: Number, required: true },
    status: {
      type: String,
      required: true,
      enum: ['draft', 'review', 'approved', 'active', 'retired'],
    },
    content: { type: MongooseSchema.Types.Mixed, required: true },
    fingerprint: { type: String, required: true },
    loadedBy: { type: String, required: true },
    history: { type: [Object], required: true, default: [] },
    revision: { type: Number, required: true, default: 1 },
    _schemaVersion: { type: Number, required: true, default: 1 },
  },
  { collection: 'accounting_chart_packs', timestamps: true, strict: true, minimize: false },
);
AccountingChartPackSchema.index({ slug: 1, version: 1 }, { unique: true });
