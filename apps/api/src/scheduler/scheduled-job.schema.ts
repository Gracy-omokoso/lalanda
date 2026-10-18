import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** Cycle de vie d'une tâche. `done` et `failed` sont terminaux. */
export const JOB_STATUSES = ['pending', 'running', 'done', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Tâche planifiée (S25a, ADR-0020).
 *
 * La base EST la file : une tâche est un document, la réclamer est un
 * `findOneAndUpdate` atomique. Pas de Redis, pas de worker séparé — une tâche peut
 * ainsi naître dans la même transaction que l'écriture métier qui la motive (une
 * facture et son échéance), ce qu'aucune file externe ne garantit.
 */
@Schema({ collection: 'scheduled_jobs', timestamps: true, strict: true })
export class ScheduledJob {
  /** Nom du gestionnaire enregistré (`billing.sweep`, `sales.reminder`…). */
  @Prop({ type: String, required: true })
  name!: string;

  /**
   * Clé de déduplication, UNIQUE. Planifier deux fois la même clé ne crée pas
   * deux tâches : c'est ce qui rend `schedule()` sûr à rejouer (redémarrage,
   * double clic, réessai réseau). Une tâche récurrente a pour clé son nom.
   */
  @Prop({ type: String, required: true })
  key!: string;

  /** Données passées au gestionnaire. Petites et sérialisables — jamais un secret. */
  @Prop({ type: Object, default: {} })
  payload!: Record<string, unknown>;

  @Prop({ type: String, enum: JOB_STATUSES, required: true, default: 'pending' })
  status!: JobStatus;

  /** Date à partir de laquelle la tâche peut être réclamée. */
  @Prop({ type: Date, required: true })
  runAt!: Date;

  /** Période en millisecondes d'une tâche récurrente ; `null` pour une tâche ponctuelle. */
  @Prop({ type: Number, default: null })
  everyMs!: number | null;

  /**
   * Tentatives consommées depuis le dernier succès. Incrémentée à la RÉCLAMATION,
   * pas à l'échec : un processus tué en pleine exécution consomme donc bien sa
   * tentative, et une tâche qui ferait planter l'API à chaque passage finit en
   * `failed` au lieu de boucler.
   */
  @Prop({ type: Number, required: true, default: 0 })
  attempts!: number;

  @Prop({ type: Number, required: true, default: 5 })
  maxAttempts!: number;

  /** Instance qui exécute la tâche (diagnostic uniquement). */
  @Prop({ type: String, default: null })
  lockedBy!: string | null;

  /**
   * Fin du bail d'exécution. Passé ce délai, une tâche `running` est considérée
   * abandonnée (processus mort) et redevient réclamable.
   */
  @Prop({ type: Date, default: null })
  lockedUntil!: Date | null;

  /** Dernière erreur, tronquée. Jamais de donnée sensible : le message vient du code. */
  @Prop({ type: String, default: null })
  lastError!: string | null;

  @Prop({ type: Date, default: null })
  lastRunAt!: Date | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  // timestamps: true
  createdAt!: Date;
  updatedAt!: Date;
}

export type ScheduledJobDocument = HydratedDocument<ScheduledJob>;
export const ScheduledJobSchema = SchemaFactory.createForClass(ScheduledJob);

ScheduledJobSchema.index({ key: 1 }, { unique: true });
/**
 * Sert la réclamation : `status` en égalité, puis tri par `runAt`. Couvre aussi
 * la reprise des tâches `running` dont le bail a expiré (`lockedUntil` est lu
 * sur un ensemble déjà réduit aux tâches en cours, toujours peu nombreuses).
 */
ScheduledJobSchema.index({ status: 1, runAt: 1 });
