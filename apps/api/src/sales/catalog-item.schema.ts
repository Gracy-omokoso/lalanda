// Collection `catalog_items` — catalogue d'articles de l'organisation
// (ADR-0022 § S25c.3).
//
// Le catalogue ne calcule rien : il porte le prix unitaire, son mode (TTC ou
// HT) et le groupe de taxation ; les totaux relèvent du moteur (S25d). Les
// montants sont des chaînes décimales canoniques à deux décimales, jamais des
// nombres (docs/26).

import {
  DOCUMENT_CURRENCIES,
  ITEM_TYPES,
  TAX_GROUP_LETTERS,
  type DocumentCurrency,
  type ItemType,
  type PriceMode,
  type TaxGroupLetter,
} from '@lalanda/engine';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** Taxe spécifique conservée : `amount` pour `per_unit`, `rate` pour `percent`. */
@Schema({ _id: false, strict: true })
export class CatalogSpecificTax {
  @Prop({ type: String, required: true, enum: ['per_unit', 'percent'] })
  kind!: 'per_unit' | 'percent';

  @Prop({ type: String })
  amount?: string;

  @Prop({ type: String })
  rate?: string;
}
const CatalogSpecificTaxSchema = SchemaFactory.createForClass(CatalogSpecificTax);

@Schema({ collection: 'catalog_items', timestamps: true, strict: true })
export class CatalogItem {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** Référence interne ; jamais « HORS CHAMP » (posé par `outOfScope`). */
  @Prop({ type: String, default: null })
  code!: string | null;

  /** `code` en majuscules — champ technique de l'unicité insensible à la casse. */
  @Prop({ type: String, default: null })
  codeKey!: string | null;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true, enum: ITEM_TYPES as unknown as string[] })
  itemType!: ItemType;

  @Prop({ type: String, required: true, enum: TAX_GROUP_LETTERS as unknown as string[] })
  taxGroup!: TaxGroupLetter;

  @Prop({ type: Boolean, required: true, default: false })
  outOfScope!: boolean;

  @Prop({ type: String, required: true })
  unitPrice!: string;

  @Prop({ type: String, required: true, enum: ['ttc', 'ht'] })
  priceMode!: PriceMode;

  /** Devise du prix (ADR-0023 E4) ; les articles antérieurs valent `CDF`. */
  @Prop({ type: String, required: true, enum: [...DOCUMENT_CURRENCIES], default: 'CDF' })
  currency!: DocumentCurrency;

  @Prop({ type: String, required: true })
  unit!: string;

  @Prop({ type: CatalogSpecificTaxSchema, default: null })
  specificTax!: CatalogSpecificTax | null;

  @Prop({ type: Boolean, required: true, default: true })
  active!: boolean;

  @Prop({ type: Date, default: null })
  deactivatedAt!: Date | null;

  @Prop({ type: String, default: null })
  deactivatedBy!: string | null;

  @Prop({ type: Date, default: null })
  firstInvoicedAt!: Date | null;

  @Prop({ type: String, required: true })
  sortName!: string;

  /** `code` et `name` normalisés. */
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

export type CatalogItemDocument = HydratedDocument<CatalogItem>;
export const CatalogItemSchema = SchemaFactory.createForClass(CatalogItem);

CatalogItemSchema.index({ organizationId: 1, sortName: 1, _id: 1 });
CatalogItemSchema.index({ organizationId: 1, active: 1 });
// Code unique par organisation, casse ignorée ; plusieurs articles sans code coexistent.
CatalogItemSchema.index(
  { organizationId: 1, codeKey: 1 },
  { unique: true, partialFilterExpression: { codeKey: { $type: 'string' } } },
);
