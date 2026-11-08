// Collection `hr_counters` — compteurs des pièces RH `NF…` et `AV…` (ADR-0051 § 1).
// ADR-0051 — H10.
//
// Un document par `organizationId + kind + year` : compteurs ANNUELS au jour de
// Kinshasa, trous admis, HORS série fiscale (motif des pièces `PF…` d'ADR-0044).

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'hr_counters', strict: true })
export class HrCounter {
  @Prop({ type: String, required: true })
  organizationId!: string;

  // ADR-0068 : `EMP` (matricules) et `POS` (numéros de poste), NON annuels (`year: 0`),
  // jamais décrémentés (`$inc` et `$max` seulement).
  // ADR-0072 : `ATT` (attestations) et `CT` (certificats de travail), ANNUELS, `$inc` seulement.
  @Prop({ type: String, required: true, enum: ['NF', 'AV', 'EMP', 'POS', 'ATT', 'CT'] })
  kind!: 'NF' | 'AV' | 'EMP' | 'POS' | 'ATT' | 'CT';

  @Prop({ type: Number, required: true })
  year!: number;

  @Prop({ type: Number, required: true, default: 0 })
  last!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type HrCounterDocument = HydratedDocument<HrCounter>;
export const HrCounterSchema = SchemaFactory.createForClass(HrCounter);
HrCounterSchema.index(
  { organizationId: 1, kind: 1, year: 1 },
  { unique: true, name: 'hr_counter_unique' },
);
