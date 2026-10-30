// Collection `suppliers` — fiches fournisseurs (ADR-0044 § 2.1). ADR-0044 — P2.
//
// Isolation : chaque document porte `organizationId` ; une fiche d'une autre
// organisation est introuvable (404), y compris par identifiant forgé dans un corps.
//
// ── Coordonnées de paiement (§ 2.1.1) ─────────────────────────────────────────
//
// Chaque moyen de paiement garde son clair CHIFFRÉ (`cipher`, AES-256-GCM sous le
// trousseau `MASTER_KEYRING`, ADR-0013) ; seuls `masked` et `fingerprint` sont lus
// en clair. Comme `organization_secrets`, `toJSON` ET `toObject` remplacent chaque
// `cipher` par `[redacted]` : un `return doc`, un `JSON.stringify(doc)` ou un
// `console.log(doc)` accidentels ne recopient ni chiffré, ni iv, ni sel, ni tag.
// Le service lit le chiffré par une lecture `lean()` explicite, au seul `reveal` et
// à la rotation.

import type {
  PurchaseCurrency,
  SupplierKind,
  SupplierPaymentMethodKind,
} from '@lalanda/shared/purchases';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

import {
  EncryptedValueSchema,
  type EncryptedValueDoc,
} from '../../integrations/integration.schema.js';
import { REDACTED } from '../../integrations/secret-value.js';

@Schema({ _id: false, strict: true })
export class SupplierContact {
  @Prop({ type: String, required: true })
  id!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, default: null })
  role!: string | null;

  @Prop({ type: String, default: null })
  phone!: string | null;

  @Prop({ type: String, default: null })
  email!: string | null;

  @Prop({ type: Boolean, required: true, default: false })
  isPrimary!: boolean;
}
const SupplierContactSchema = SchemaFactory.createForClass(SupplierContact);

@Schema({ _id: false, strict: true })
export class SupplierPaymentMethod {
  @Prop({ type: String, required: true })
  id!: string;

  @Prop({ type: String, required: true, enum: ['bank', 'mobile_money'] })
  kind!: SupplierPaymentMethodKind;

  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: Boolean, required: true, default: false })
  isDefault!: boolean;

  /** `Rawbank •••• 4521`, `M-Pesa •••• 78` — la seule forme lue hors `reveal`. */
  @Prop({ type: String, required: true })
  masked!: string;

  /** HMAC tronqué du compte, propre à l'organisation : signale un compte partagé. */
  @Prop({ type: String, required: true })
  fingerprint!: string;

  /** Clair chiffré (JSON des coordonnées) ; jamais sérialisé (voir l'en-tête). */
  @Prop({ type: EncryptedValueSchema, required: true })
  cipher!: EncryptedValueDoc;

  @Prop({ type: Date, required: true })
  changedAt!: Date;

  @Prop({ type: String, required: true })
  changedBy!: string;
}
const SupplierPaymentMethodSchema = SchemaFactory.createForClass(SupplierPaymentMethod);

@Schema({ _id: false, strict: true })
export class SupplierPaymentTermsDoc {
  @Prop({ type: String, required: true, enum: ['immediate', 'net', 'end_of_month'] })
  kind!: 'immediate' | 'net' | 'end_of_month';

  @Prop({ type: Number, default: undefined })
  days?: number;
}
const SupplierPaymentTermsSchema = SchemaFactory.createForClass(SupplierPaymentTermsDoc);

@Schema({ collection: 'suppliers', timestamps: true, strict: true })
export class Supplier {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  /** `name` normalisé (minuscules, sans accents, espaces réduits) — tri et homonymes. */
  @Prop({ type: String, required: true })
  sortName!: string;

  /** Nom, NIF, e-mail et contacts normalisés — recherche « contient ». */
  @Prop({ type: String, required: true })
  searchKey!: string;

  @Prop({ type: String, required: true, enum: ['company', 'individual'], default: 'company' })
  kind!: SupplierKind;

  /** Normalisé, forme seulement ; unique partiel par organisation. */
  @Prop({ type: String, default: null })
  nif!: string | null;

  @Prop({ type: String, default: null })
  rccm!: string | null;

  @Prop({ type: String, default: null })
  nationalId!: string | null;

  @Prop({ type: String, default: null })
  address!: string | null;

  @Prop({ type: String, default: null })
  phone!: string | null;

  @Prop({ type: String, default: null })
  email!: string | null;

  @Prop({ type: String, default: null })
  website!: string | null;

  @Prop({ type: [SupplierContactSchema], default: [] })
  contacts!: SupplierContact[];

  @Prop({ type: String, enum: ['CDF', 'USD', null], default: null })
  defaultCurrency!: PurchaseCurrency | null;

  @Prop({ type: SupplierPaymentTermsSchema, default: () => ({ kind: 'immediate' }) })
  paymentTerms!: SupplierPaymentTermsDoc;

  /** Catégorie d'ADR-0034 § 1 ; préremplit l'imputation des factures. */
  @Prop({ type: String, default: null })
  defaultCategory!: string | null;

  @Prop({ type: [SupplierPaymentMethodSchema], default: [] })
  paymentMethods!: SupplierPaymentMethod[];

  /** Dernier changement de coordonnées (bandeau d'alerte, § 2.1.1), ou `null`. */
  @Prop({ type: Date, default: null })
  paymentDetailsChangedAt!: Date | null;

  @Prop({ type: String, default: null })
  paymentDetailsChangedBy!: string | null;

  @Prop({ type: String, default: null })
  notes!: string | null;

  /** `false` = archivé : masqué des sélecteurs, conservé. */
  @Prop({ type: Boolean, required: true, default: true })
  active!: boolean;

  /** Clés `supplierKey` des dépenses texte rattachées (migration, fusion, § 2.9). */
  @Prop({ type: [String], default: [] })
  legacyKeys!: string[];

  /** Fiche fusionnée dans une autre : conservée pour la trace, exclue des listes. */
  @Prop({ type: String, default: null })
  mergedInto!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type SupplierDocument = HydratedDocument<Supplier>;
export type SupplierLean = Supplier & { _id: Types.ObjectId };
export const SupplierSchema = SchemaFactory.createForClass(Supplier);

// § 2.1 : liste triée par nom, paginée par curseur ; filtre actif ; NIF unique
// partiel ; rattachement des saisies texte par clé exacte ; comptes partagés.
SupplierSchema.index({ organizationId: 1, sortName: 1, _id: 1 });
SupplierSchema.index({ organizationId: 1, active: 1 });
SupplierSchema.index(
  { organizationId: 1, nif: 1 },
  {
    unique: true,
    partialFilterExpression: { nif: { $type: 'string' } },
    name: 'supplier_nif_unique',
  },
);
SupplierSchema.index({ organizationId: 1, legacyKeys: 1 });
SupplierSchema.index({ organizationId: 1, 'paymentMethods.fingerprint': 1 });

/** Remplace chaque chiffré par `[redacted]` (voir l'en-tête). Idempotente. */
function amputerLesChiffres(_doc: unknown, ret: unknown): unknown {
  const bag = ret as Record<string, unknown>;
  const methods = bag['paymentMethods'];
  if (Array.isArray(methods)) {
    bag['paymentMethods'] = methods.map((m) =>
      m !== null && typeof m === 'object' ? { ...(m as object), cipher: REDACTED } : m,
    );
  }
  return bag;
}

SupplierSchema.set('toJSON', { transform: amputerLesChiffres });
SupplierSchema.set('toObject', { transform: amputerLesChiffres });

/** Auteur des écritures de la migration (§ 2.9). */
export const SUPPLIERS_SYSTEM_ACTOR = 'system:suppliers-migration';
