// Collection `sales_invoices` — documents de vente (ADR-0023 § S25e.2).
//
// Un document naît brouillon (pro forma) et se GÈLE à l'émission (mode
// ordinaire) ou à « Normaliser » (mode normalisé). Les sous-documents figés
// (client, lignes, montants, conversion, vendeur…) sont des valeurs JSON pures
// — chaînes décimales, jamais de `number` pour un montant (docs/26) — afin que
// `contentSha256` se recalcule à l'identique après lecture en base.
//
// Écrivains : `InvoiceDraftsService` (brouillon), `InvoiceFreezingService`
// (gel, reprise en brouillon, `credited` des origines), `InvoiceNumberingService`
// (numéro définitif d'une facture normalisée, `confirm`) et S25f
// (`normalization`, transitions `pending_normalization → …`).

import type { PaymentInput } from '@lalanda/engine';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import type { FrozenPresentation } from '../documents/templates/template.contract.js';
import {
  INVOICE_STATUSES,
  INVOICE_TYPES,
  type DgiEnvironment,
  type EmissionMode,
  type InvoiceSeries,
  type InvoiceStatus,
  type InvoiceType,
} from './invoice.contract.js';
import type {
  InvoiceCampaignLabel,
  StoredConversion,
  StoredCreditNote,
  StoredCustomer,
  StoredDocumentAmounts,
  StoredLine,
  StoredNormalizedAmounts,
  StoredSeller,
  StoredTaxRates,
} from './invoice.types.js';
import type { InvoiceNormalizationState } from './normalization.port.js';

@Schema({ collection: 'sales_invoices', timestamps: true, strict: true, minimize: false })
export class SalesInvoice {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true, enum: INVOICE_STATUSES as unknown as string[] })
  status!: InvoiceStatus;

  /** `PF-AAAA-NNNNNN` : hors série fiscale, jamais un numéro de facture. */
  @Prop({ type: String, required: true })
  proformaRef!: string;

  @Prop({ type: String, required: true, enum: INVOICE_TYPES as unknown as string[] })
  type!: InvoiceType;

  @Prop({ type: String, required: true, enum: ['CDF', 'USD'] })
  currency!: 'CDF' | 'USD';

  @Prop({ type: String, required: true, enum: ['ttc', 'ht'] })
  priceMode!: 'ttc' | 'ht';

  @Prop({ type: Object, required: true })
  customer!: StoredCustomer;

  @Prop({ type: String, default: null })
  pointOfSaleId!: string | null;

  @Prop({ type: [Object], default: [] })
  lines!: StoredLine[];

  @Prop({ type: [Object], default: [] })
  payments!: PaymentInput[];

  @Prop({ type: Object, required: true })
  comments!: Record<string, string | null>;

  @Prop({ type: Object, default: null })
  creditNote!: StoredCreditNote | null;

  @Prop({ type: Boolean, required: true, default: false })
  showUsdCounterValue!: boolean;

  @Prop({ type: Object, required: true })
  documentAmounts!: StoredDocumentAmounts;

  @Prop({ type: Object, default: null })
  conversion!: StoredConversion | null;

  @Prop({ type: Object, default: null })
  normalizedAmounts!: StoredNormalizedAmounts | null;

  @Prop({ type: String, default: null })
  calculationVersion!: string | null;

  @Prop({ type: String, default: null })
  roundingPolicyId!: string | null;

  @Prop({ type: Object, default: null })
  taxRates!: StoredTaxRates | null;

  /** Définitif seulement (§ S25e.3). */
  @Prop({ type: String, default: null })
  number!: string | null;

  @Prop({ type: String, default: null })
  series!: InvoiceSeries | null;

  @Prop({ type: Number, default: null })
  fiscalYear!: number | null;

  /**
   * Rang numérique du numéro définitif dans la série de l'année (ADR-0027,
   * amendement du 21 oct. 2026) : `42` pour `IN2610-000042` comme pour
   * `AV2611-000042`. Protégé par l'index unique ci-dessous. `null` sans numéro.
   */
  @Prop({ type: Number, default: null })
  fiscalSeq!: number | null;

  @Prop({ type: Date, default: null })
  issuedAt!: Date | null;

  @Prop({ type: String, default: null })
  emissionMode!: EmissionMode | null;

  @Prop({ type: String, default: null })
  environment!: DgiEnvironment | null;

  @Prop({ type: String, default: null })
  isf!: string | null;

  @Prop({ type: Object, default: null })
  seller!: StoredSeller | null;

  @Prop({ type: Object, default: null })
  operator!: { userId: string; name: string } | null;

  /**
   * Version du logiciel Lalanda qui a GELÉ le document (ADR-0026 § 6.2), figée
   * avec lui et imprimée en pied de PDF. Absente des documents gelés avant le
   * 20 oct. 2026 (pas de migration : leur empreinte et leur PDF sont inchangés).
   */
  @Prop({ type: String, required: false })
  softwareVersion?: string | null;

  /**
   * Présentation FIGÉE au gel (ADR-0028 § 6) : modèle et version, options
   * résolues, empreinte de l'identité visuelle (logos par identifiant immuable
   * et SHA-256, couleurs, police). L'original se réimprime avec elle, même si
   * l'organisation change ensuite de modèle ou de logo. Absente : présentation
   * d'origine (documents gelés avant le 21 oct. 2026, ou organisation sans
   * modèle choisi) — pas de migration, empreinte et PDF inchangés.
   */
  @Prop({ type: Object, required: false })
  presentation?: FrozenPresentation | null;

  @Prop({ type: Date, default: null })
  frozenAt!: Date | null;

  @Prop({ type: Number, default: null })
  frozenFromRevision!: number | null;

  @Prop({ type: String, default: null })
  contentSha256!: string | null;

  /** Part `CREDIT` des paiements, pour les encaissements à venir (§ S25e.13). */
  @Prop({ type: String, default: null })
  amountOnCredit!: string | null;

  /** Origine : quantités déjà créditées par des avoirs gelés (§ S25e.5). */
  @Prop({ type: [Object], default: [] })
  credited!: { lineIndex: number; quantity: string }[];

  @Prop({ type: Number, required: true, default: 0 })
  creditRevision!: number;

  /** Propriété de S25f après sa création au gel (§ S25e.10). */
  @Prop({ type: Object, default: null })
  normalization!: InvoiceNormalizationState | null;

  @Prop({ type: Number, required: true, default: 0 })
  duplicateCount!: number;

  /**
   * Étiquette INTERNE de la campagne d'homologation DGI (ADR-0026 § 7) : posée
   * à la création du brouillon par la ligne de commande `edef:homologation`, et
   * par elle seule (aucune route ne l'accepte : les corps HTTP sont `.strict()`).
   * Ni envoyée à la DGI, ni imprimée, ni dans `contentSha256`, ni dans la vue :
   * elle sert à reprendre une campagne interrompue sans renormaliser.
   * Absente des autres documents.
   */
  @Prop({ type: Object, required: false })
  campaign?: InvoiceCampaignLabel | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  /** `issuedAt ?? createdAt` : tri des listes. */
  @Prop({ type: Date, required: true })
  sortAt!: Date;

  /** Nom du client, numéro et référence de pro forma, normalisés : recherche `q`. */
  @Prop({ type: String, required: true, default: '' })
  searchKey!: string;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type SalesInvoiceDocument = HydratedDocument<SalesInvoice>;
export const SalesInvoiceSchema = SchemaFactory.createForClass(SalesInvoice);

SalesInvoiceSchema.index({ organizationId: 1, sortAt: -1, _id: -1 });
SalesInvoiceSchema.index({ organizationId: 1, status: 1 });
// Un numéro définitif n'existe qu'une fois par série : filet de sécurité sous le compteur.
SalesInvoiceSchema.index(
  { organizationId: 1, series: 1, number: 1 },
  { unique: true, partialFilterExpression: { number: { $type: 'string' } } },
);
// ADR-0027, amendement du 21 oct. 2026 : un RANG n'existe qu'une fois par
// organisation, série et année — `IN2610-000042` et `AV2611-000042` sont deux
// chaînes distinctes, mais pas deux rangs. Filet sous le compteur et le bail.
SalesInvoiceSchema.index(
  { organizationId: 1, series: 1, fiscalYear: 1, fiscalSeq: 1 },
  { unique: true, partialFilterExpression: { fiscalSeq: { $type: 'number' } } },
);
SalesInvoiceSchema.index({ organizationId: 1, proformaRef: 1 }, { unique: true });
SalesInvoiceSchema.index({ organizationId: 1, 'creditNote.originInvoiceId': 1 });
