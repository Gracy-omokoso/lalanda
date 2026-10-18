// Instantanés des listes de référence e-MCF — ADR-0021 §6.
//
// Données de référence PUBLIQUES, identiques pour tous les contribuables : elles
// sont conservées par environnement, sans organisation. Un nouveau document
// n'est écrit que lorsque le contenu change (empreinte SHA-256 du contenu
// canonique) ; les factures du lot S25f figeront l'empreinte de la liste
// utilisée.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'edef_reference_snapshots', timestamps: false, strict: true })
export class EdefReferenceSnapshot {
  @Prop({ type: String, required: true, enum: ['test', 'production'] })
  environment!: 'test' | 'production';

  @Prop({ type: String, required: true })
  list!: string;

  @Prop({ type: String, required: true })
  sha256!: string;

  @Prop({ type: Object, required: true })
  payload!: unknown;

  @Prop({ type: Date, required: true })
  fetchedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type EdefReferenceSnapshotDocument = HydratedDocument<EdefReferenceSnapshot>;
export const EdefReferenceSnapshotSchema = SchemaFactory.createForClass(EdefReferenceSnapshot);
// Dernier instantané d'une liste dans un environnement.
EdefReferenceSnapshotSchema.index({ environment: 1, list: 1, fetchedAt: -1 });
// Un contenu donné n'est conservé qu'une fois par liste et par environnement.
EdefReferenceSnapshotSchema.index({ environment: 1, list: 1, sha256: 1 }, { unique: true });
