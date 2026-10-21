import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Période réalisée d'un projet (S18b — docs/08 Prévisionnel/Réalisé).
 *
 * Un document par (projet, année d'exercice, mois). `values` porte les montants
 * réalisés saisis manuellement pour les lignes clés du template (CA, charges
 * principales…), indexés par `lineId` — les mêmes identifiants que les lignes
 * du plan validé, pour que le rapprochement plan ↔ réalisé soit direct.
 *
 * Machine d'état (docs/22 § Période réalisée, forme MVP) :
 *   open → closed (clôture) → open (réouverture, owner uniquement, motivée).
 * Chaque réouverture est journalisée dans `reopenedLog` — la trace d'audit
 * exigée par docs/08 (« La réouverture exige une permission, un motif et une
 * trace d'audit »).
 *
 * Aucune saisie du réalisé ne touche jamais au plan validé (immuable, S16c).
 */
/** Étiquette d'origine d'une valeur réalisée (ADR-0031 § 3, ADR-0034 § 5). */
export interface ActualValueSource {
  source: 'manual' | 'run.expenses' | 'run.sales';
  at: Date;
  by: string;
  /** Version du calcul moteur qui a produit la valeur (sources RUN). */
  version?: string;
  /** Nombre de documents agrégés (sources RUN). */
  documents?: number;
  /** Empreinte des documents et du montant : base de l'idempotence (sources RUN). */
  fingerprint?: string;
}

@Schema({ collection: 'actual_periods', timestamps: true, strict: true })
export class ActualPeriod {
  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  @Prop({ type: String, required: true, index: true })
  projectId!: string;

  /** Année d'EXERCICE (1..5) — relative au plan, pas une année calendaire. */
  @Prop({ type: Number, required: true, min: 1, max: 5 })
  year!: number;

  /** Mois de l'exercice (1..12). */
  @Prop({ type: Number, required: true, min: 1, max: 12 })
  month!: number;

  @Prop({ type: String, required: true, enum: ['open', 'closed'], default: 'open' })
  status!: 'open' | 'closed';

  /** Montants réalisés par `lineId` du template (devise du projet). */
  @Prop({ type: Object, required: true, default: {} })
  values!: Record<string, number>;

  /**
   * Origine de chaque valeur (docs/08 § Saisie : « chaque donnée conserve source,
   * auteur, date ») — ADR-0031 § 3 et ADR-0034 § 5. `manual` pour une saisie à la
   * main, `run.expenses` pour les dépenses, `run.sales` pour les ventes. Absente
   * sur les périodes antérieures : lue comme « saisie manuelle d'origine inconnue ».
   */
  @Prop({ type: Object, default: {} })
  sources?: Record<string, ActualValueSource>;

  @Prop({ type: Date })
  closedAt?: Date;

  /** User id de l'auteur de la clôture. */
  @Prop({ type: String })
  closedBy?: string;

  /** Journal d'audit des réouvertures — jamais purgé, append-only. */
  @Prop({
    type: [
      {
        reopenedAt: { type: Date, required: true },
        reopenedBy: { type: String, required: true },
        reason: { type: String, required: true },
        _id: false,
      },
    ],
    default: [],
  })
  reopenedLog!: { reopenedAt: Date; reopenedBy: string; reason: string }[];

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  // timestamps: true
  createdAt!: Date;
  updatedAt!: Date;
}

export type ActualPeriodDocument = HydratedDocument<ActualPeriod>;
export const ActualPeriodSchema = SchemaFactory.createForClass(ActualPeriod);

// Un seul document par projet + année + mois — protège contre les upserts concurrents.
ActualPeriodSchema.index({ projectId: 1, year: 1, month: 1 }, { unique: true });
// Lecture « périodes d'une année » scopée tenant.
ActualPeriodSchema.index({ organizationId: 1, projectId: 1, year: 1, month: 1 });
