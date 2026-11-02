// Collection `sales_contract_files` — ADR-0050 § 2.6. ADR-0050 — V2.
//
// Pièces d'un engagement : copie de travail et copie signée d'un contrat ou d'un
// avenant (lot V3), pièce du client d'une commande (`customer_order`, lot V2). PDF
// seul, 10 Mio, servi en téléchargement INERTE. Ajout seul : une pièce n'est jamais
// remplacée, une nouvelle s'ajoute (une commande brouillon supprimée emporte les
// siennes).

import {
  SALES_CONTRACT_FILE_KINDS,
  type SalesContractFileKind,
} from '@lalanda/shared/sales-contracts';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'sales_contract_files', timestamps: false, strict: true })
export class SalesContractFile {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, default: null })
  contractId!: string | null;

  @Prop({ type: String, default: null })
  amendmentId!: string | null;

  @Prop({ type: String, default: null })
  orderId!: string | null;

  @Prop({ type: String, required: true, enum: [...SALES_CONTRACT_FILE_KINDS] })
  kind!: SalesContractFileKind;

  /** Clé de l'objet stocké (`sales-contract-files/<objectId>`), tirée au hasard. */
  @Prop({ type: String, required: true })
  objectId!: string;

  @Prop({ type: String, required: true })
  fileName!: string;

  @Prop({ type: Number, required: true })
  size!: number;

  @Prop({ type: String, required: true })
  sha256!: string;

  @Prop({ type: String, required: true })
  uploadedBy!: string;

  @Prop({ type: Date, required: true })
  uploadedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type SalesContractFileDocument = HydratedDocument<SalesContractFile>;
export type SalesContractFileLean = SalesContractFile & { _id: Types.ObjectId };
export const SalesContractFileSchema = SchemaFactory.createForClass(SalesContractFile);
SalesContractFileSchema.index({ organizationId: 1, orderId: 1, uploadedAt: 1 });
SalesContractFileSchema.index({ organizationId: 1, contractId: 1, uploadedAt: 1 });
