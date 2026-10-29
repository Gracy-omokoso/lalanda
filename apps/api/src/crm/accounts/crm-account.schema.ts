// Collection `crm_accounts` — comptes 360° (ADR-0040 § 2.1). ADR-0040 — C1.
//
// Un compte par entreprise, prospect ou client. Un compte client est lié 1-1 à sa
// fiche `customers`, qui reste la SEULE source de son identité fiscale (type DGI,
// NIF) : le compte n'en garde qu'une copie d'affichage du nom, réécrite par la
// synchronisation client → compte (`CrmAccountsSync`). Le compte porte ce qui est
// commercial : responsable, secteur, origine, coordonnées commerciales, notes.
//
// Isolation : chaque document porte `organizationId` ; un compte d'une autre
// organisation est introuvable (404).

import type { CrmAccountConversionMode, CrmAccountKind } from '@lalanda/shared/crm';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false, strict: true })
export class CrmAccountConversion {
  @Prop({ type: String, required: true })
  customerId!: string;

  @Prop({ type: Date, required: true })
  convertedAt!: Date;

  @Prop({ type: String, required: true })
  convertedBy!: string;

  @Prop({ type: String, required: true, enum: ['created', 'linked'] })
  mode!: CrmAccountConversionMode;
}
const CrmAccountConversionSchema = SchemaFactory.createForClass(CrmAccountConversion);

@Schema({ collection: 'crm_accounts', timestamps: true, strict: true })
export class CrmAccount {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** Dénormalisé de `customerId` (non nul ⇒ `customer`), écrit dans la même mise à jour. */
  @Prop({ type: String, required: true, enum: ['prospect', 'customer'] })
  kind!: CrmAccountKind;

  /** `null` : prospect. Sinon une fiche `customers` de l'organisation (unique partiel). */
  @Prop({ type: String, default: null })
  customerId!: string | null;

  /** Prospect : saisi. Client : copie du nom de la fiche client (la fiche fait foi). */
  @Prop({ type: String, required: true })
  name!: string;

  /** `name` normalisé (minuscules, sans accents, espaces réduits) — tri et homonymes. */
  @Prop({ type: String, required: true })
  sortName!: string;

  /** Nom, e-mail, site et secteur normalisés — recherche « contient ». */
  @Prop({ type: String, required: true })
  searchKey!: string;

  /** Responsable : `null` ou un membre détenant `crm.manage`. */
  @Prop({ type: String, default: null })
  ownerId!: string | null;

  @Prop({ type: String, default: null })
  industry!: string | null;

  @Prop({ type: String, default: null })
  origin!: string | null;

  @Prop({ type: String, default: null })
  website!: string | null;

  /** Coordonnées COMMERCIALES : celles des factures restent celles de la fiche client. */
  @Prop({ type: String, default: null })
  phone!: string | null;

  @Prop({ type: String, default: null })
  email!: string | null;

  @Prop({ type: String, default: null })
  address!: string | null;

  @Prop({ type: String, default: null })
  notes!: string | null;

  /** `false` = archivé. Miroir de `customers.active` pour un compte client. */
  @Prop({ type: Boolean, required: true, default: true })
  active!: boolean;

  @Prop({ type: CrmAccountConversionSchema, default: null })
  conversion!: CrmAccountConversion | null;

  /** Prospect fusionné dans un autre compte : conservé pour la trace, exclu des listes. */
  @Prop({ type: String, default: null })
  mergedInto!: string | null;

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

export type CrmAccountDocument = HydratedDocument<CrmAccount>;
export type CrmAccountLean = CrmAccount & { _id: Types.ObjectId };
export const CrmAccountSchema = SchemaFactory.createForClass(CrmAccount);

/** Auteur des écritures faites par la synchronisation et la migration. */
export const CRM_ACCOUNTS_SYSTEM_ACTOR = 'system:crm-accounts';

// Liste triée par nom et paginée par curseur.
CrmAccountSchema.index({ organizationId: 1, sortName: 1, _id: 1 });
CrmAccountSchema.index({ organizationId: 1, active: 1, kind: 1 });
CrmAccountSchema.index({ organizationId: 1, ownerId: 1 });
// Une fiche client a au plus un compte. Partiel : les prospects (`null`) coexistent.
CrmAccountSchema.index(
  { organizationId: 1, customerId: 1 },
  { unique: true, partialFilterExpression: { customerId: { $type: 'string' } } },
);
