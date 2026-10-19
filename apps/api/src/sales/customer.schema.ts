// Collection `customers` — fichier clients de l'organisation (ADR-0022 § S25c.2).
//
// Cinq types DGI (`PP PM PC PL AO`). Les règles par type sont appliquées à
// l'entrée (`sales.dto.ts`) ; le schéma ne garde que la forme. `firstInvoicedAt`
// n'est écrit QUE par `SalesUsageService.markInvoiced` et n'est jamais remis à
// `null` : il décide entre suppression réelle et désactivation (ADR-0022 § O7).

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import { CUSTOMER_TYPES, type CustomerType } from './sales.dto.js';

@Schema({ collection: 'customers', timestamps: true, strict: true })
export class Customer {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true, enum: CUSTOMER_TYPES as unknown as string[] })
  type!: CustomerType;

  @Prop({ type: String, required: true })
  name!: string;

  /** Normalisé (`normalizeNif`) ; `null` pour un PP ou un AO sans NIF. */
  @Prop({ type: String, default: null })
  nif!: string | null;

  /** Référence du document d'exonération — AO seulement. */
  @Prop({ type: String, default: null })
  exemptionReference!: string | null;

  @Prop({ type: String, default: null })
  phone!: string | null;

  @Prop({ type: String, default: null })
  email!: string | null;

  @Prop({ type: String, default: null })
  address!: string | null;

  @Prop({ type: Boolean, required: true, default: true })
  active!: boolean;

  @Prop({ type: Date, default: null })
  deactivatedAt!: Date | null;

  @Prop({ type: String, default: null })
  deactivatedBy!: string | null;

  @Prop({ type: Date, default: null })
  firstInvoicedAt!: Date | null;

  /** `name` normalisé (minuscules, sans accents) — tri. */
  @Prop({ type: String, required: true })
  sortName!: string;

  /** `name`, `nif`, `email` normalisés — recherche « contient ». */
  @Prop({ type: String, required: true })
  searchKey!: string;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type CustomerDocument = HydratedDocument<Customer>;
export const CustomerSchema = SchemaFactory.createForClass(Customer);

// Liste triée et paginée par curseur.
CustomerSchema.index({ organizationId: 1, sortName: 1, _id: 1 });
CustomerSchema.index({ organizationId: 1, active: 1 });
// Un contribuable n'a qu'une fiche par organisation, active ou non. Partiel :
// plusieurs clients sans NIF (PP, AO) coexistent.
CustomerSchema.index(
  { organizationId: 1, nif: 1 },
  { unique: true, partialFilterExpression: { nif: { $type: 'string' } } },
);
