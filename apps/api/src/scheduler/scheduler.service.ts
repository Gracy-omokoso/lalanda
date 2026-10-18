// Ordonnanceur (S25a, ADR-0020).
//
// ── Pourquoi la base et pas une file Redis ────────────────────────────────────
// Lalanda tourne sur une seule machine, avec un seul processus d'API. Une file
// externe (BullMQ) ajouterait une infrastructure à surveiller, et surtout ne
// saurait pas naître dans la même transaction que l'écriture métier qui la
// motive : une facture enregistrée dont l'échéance se perd entre deux systèmes
// est exactement le défaut qu'un ordonnanceur doit empêcher. Ici, une tâche est un
// document de `scheduled_jobs`, et la réclamer est un `findOneAndUpdate` atomique.
//
// ── Les trois garanties, et comment elles tiennent ────────────────────────────
// 1. UNE SEULE EXÉCUTION à la fois : la réclamation passe la tâche en `running`
//    atomiquement ; deux instances qui réclament la même ne peuvent pas gagner
//    toutes les deux.
// 2. REPRISE APRÈS PANNE : la réclamation pose un bail (`lockedUntil`). Une tâche
//    `running` dont le bail a expiré est de nouveau réclamable — son processus est
//    présumé mort.
// 3. ÉCHEC BORNÉ : chaque réclamation consomme une tentative ; au-delà de
//    `maxAttempts`, une tâche ponctuelle passe en `failed` au lieu de boucler.
//
// ── Ce que cela exige des gestionnaires ───────────────────────────────────────
// Un gestionnaire peut être exécuté PLUS d'une fois (bail expiré pendant qu'il
// tournait encore, processus tué après l'effet mais avant l'acquittement). Il doit
// donc être IDEMPOTENT — rejouer l'effet sans le doubler — et finir bien avant
// `LEASE_MS`. « Au moins une fois », jamais « exactement une fois » : aucun
// système distribué honnête ne promet mieux.

import { hostname } from 'node:os';

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { ScheduledJob, type ScheduledJobDocument } from './scheduled-job.schema.js';

/** Bail d'exécution : au-delà, une tâche `running` est présumée abandonnée. */
export const LEASE_MS = 5 * 60_000;
/** Intervalle entre deux passages de l'ordonnanceur. */
export const POLL_MS = 15_000;
/** Tâches exécutées au plus par passage — borne le temps d'un passage. */
export const MAX_JOBS_PER_TICK = 20;
/** Tentatives par défaut d'une tâche ponctuelle. */
export const DEFAULT_MAX_ATTEMPTS = 5;

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 60 * 60_000;

/**
 * Délai avant la tentative suivante : 30 s, 1 min, 2 min, 4 min… plafonné à 1 h.
 * Exponentiel parce qu'une panne qui dure (fournisseur indisponible) ne doit pas
 * être martelée toutes les quinze secondes.
 */
export function backoffMs(attemptsSoFar: number): number {
  const exponent = Math.max(0, attemptsSoFar - 1);
  return Math.min(BACKOFF_BASE_MS * 2 ** exponent, BACKOFF_MAX_MS);
}

export interface JobContext {
  jobId: string;
  key: string;
  /** Rang de cette tentative, à partir de 1. */
  attempt: number;
  now: Date;
}

export type JobHandler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<void>;

export interface ScheduleInput {
  name: string;
  /** Clé de déduplication. Par défaut le nom : une seule tâche de ce nom à la fois. */
  key?: string;
  runAt: Date;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
}

@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Scheduler');
  private readonly handlers = new Map<string, JobHandler>();
  private readonly recurring = new Map<string, number>();
  /** Identifiant de CETTE instance, inscrit dans `lockedBy` pour le diagnostic. */
  readonly instanceId = `${hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;

  constructor(@InjectModel(ScheduledJob.name) private readonly model: Model<ScheduledJob>) {}

  /** Enregistre le gestionnaire d'une tâche ponctuelle. À appeler dans `onModuleInit`. */
  register(name: string, handler: JobHandler): void {
    if (this.handlers.has(name)) throw new Error(`Tâche « ${name} » déjà enregistrée`);
    this.handlers.set(name, handler);
  }

  /**
   * Enregistre une tâche RÉCURRENTE. Sa planification est assurée au démarrage
   * (`onApplicationBootstrap`), une seule fois en base quel que soit le nombre de
   * redémarrages : sa clé est son nom.
   */
  every(name: string, everyMs: number, handler: JobHandler): void {
    if (everyMs < POLL_MS) throw new Error(`Période de « ${name} » inférieure à ${POLL_MS} ms`);
    this.register(name, handler);
    this.recurring.set(name, everyMs);
  }

  /**
   * Planifie une tâche ponctuelle. Rejouable : une clé déjà connue ne crée rien
   * et la tâche existante est laissée intacte (`created: false`).
   */
  async schedule(input: ScheduleInput): Promise<{ created: boolean }> {
    if (!this.handlers.has(input.name)) {
      // Planifier une tâche sans gestionnaire produirait un document que personne
      // ne réclamera jamais : l'erreur doit éclater ici, chez l'appelant.
      throw new Error(`Aucun gestionnaire pour la tâche « ${input.name} »`);
    }
    const key = input.key ?? input.name;
    const res = await this.model.updateOne(
      { key },
      {
        $setOnInsert: {
          name: input.name,
          key,
          payload: input.payload ?? {},
          status: 'pending',
          runAt: input.runAt,
          everyMs: null,
          attempts: 0,
          maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
          _schemaVersion: 1,
        },
      },
      { upsert: true },
    );
    return { created: res.upsertedCount === 1 };
  }

  /** Retire une tâche encore en attente. Sans effet sur une tâche en cours ou terminée. */
  async cancel(key: string): Promise<{ cancelled: boolean }> {
    const res = await this.model.deleteOne({ key, status: 'pending' });
    return { cancelled: res.deletedCount === 1 };
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureRecurring();
    if (process.env['SCHEDULER_ENABLED'] === 'false') {
      this.logger.log('Ordonnanceur désactivé (SCHEDULER_ENABLED=false).');
      return;
    }
    this.timer = setInterval(() => void this.safeTick(), POLL_MS);
    // Le minuteur ne doit pas, à lui seul, empêcher le processus de s'arrêter.
    this.timer.unref();
    this.logger.log(
      `Ordonnanceur actif — ${this.handlers.size} tâche(s) connue(s), passage toutes les ${POLL_MS / 1000} s.`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Laisse finir le passage en cours : couper au milieu d'une tâche la laisserait
    // `running` jusqu'à l'expiration de son bail.
    await this.running?.catch(() => undefined);
  }

  /**
   * Inscrit en base chaque tâche récurrente qui n'y est pas encore, et aligne la
   * période de celles qui y sont. N'avance ni ne recule une échéance existante.
   */
  async ensureRecurring(now: Date = new Date()): Promise<void> {
    for (const [name, everyMs] of this.recurring) {
      await this.model.updateOne(
        { key: name },
        {
          $setOnInsert: {
            name,
            key: name,
            payload: {},
            status: 'pending',
            runAt: now,
            attempts: 0,
            maxAttempts: DEFAULT_MAX_ATTEMPTS,
            _schemaVersion: 1,
          },
          $set: { everyMs },
        },
        { upsert: true },
      );
    }
  }

  /**
   * Un passage : réclame et exécute, l'une après l'autre, les tâches échues.
   * Renvoie le nombre de tâches traitées. Public pour les tests, qui pilotent le
   * temps (`now`) au lieu d'attendre le minuteur.
   */
  async tick(now: Date = new Date(), maxJobs = MAX_JOBS_PER_TICK): Promise<number> {
    let processed = 0;
    while (processed < maxJobs) {
      const job = await this.claim(now);
      if (!job) break;
      await this.execute(job, now);
      processed += 1;
    }
    return processed;
  }

  private async safeTick(): Promise<void> {
    if (this.running) return; // un passage à la fois par instance
    this.running = this.tick();
    try {
      await this.running;
    } catch (err) {
      this.logger.error(`Passage de l'ordonnanceur interrompu : ${describe(err)}`);
    } finally {
      this.running = null;
    }
  }

  /** Réclamation atomique : la tâche échue la plus ancienne, ou une tâche abandonnée. */
  private async claim(now: Date): Promise<ScheduledJobDocument | null> {
    const names = [...this.handlers.keys()];
    if (names.length === 0) return null;
    return this.model
      .findOneAndUpdate(
        {
          // Seulement les tâches que CETTE version du code sait exécuter : après un
          // retour arrière de déploiement, une tâche d'un gestionnaire disparu
          // attend en `pending` au lieu d'être brûlée en échecs.
          name: { $in: names },
          $or: [
            { status: 'pending', runAt: { $lte: now } },
            { status: 'running', lockedUntil: { $lte: now } },
          ],
        },
        {
          $set: {
            status: 'running',
            lockedBy: this.instanceId,
            lockedUntil: new Date(now.getTime() + LEASE_MS),
            lastRunAt: now,
          },
          $inc: { attempts: 1 },
        },
        { sort: { runAt: 1 }, new: true },
      )
      .exec();
  }

  private async execute(job: ScheduledJobDocument, now: Date): Promise<void> {
    const handler = this.handlers.get(job.name);
    // Une tâche reprise après des pannes répétées a pu dépasser son quota pendant
    // qu'elle était `running` : on l'arrête sans la rejouer une fois de plus.
    if (!handler || job.attempts > job.maxAttempts) {
      await this.settleFailure(job, now, new Error('Tentatives épuisées'));
      return;
    }
    try {
      await handler(job.payload ?? {}, {
        jobId: String(job._id),
        key: job.key,
        attempt: job.attempts,
        now,
      });
    } catch (err) {
      await this.settleFailure(job, now, err);
      return;
    }
    await this.settleSuccess(job, now);
  }

  private async settleSuccess(job: ScheduledJobDocument, now: Date): Promise<void> {
    const update =
      job.everyMs !== null
        ? {
            status: 'pending',
            runAt: new Date(now.getTime() + job.everyMs),
            attempts: 0,
            lockedBy: null,
            lockedUntil: null,
            lastError: null,
          }
        : { status: 'done', lockedBy: null, lockedUntil: null, lastError: null };
    // Conditionné à `lockedBy` : si le bail a expiré et qu'une autre instance a
    // repris la tâche, ce n'est plus à nous de la solder.
    await this.model.updateOne({ _id: job._id, lockedBy: this.instanceId }, { $set: update });
  }

  private async settleFailure(job: ScheduledJobDocument, now: Date, err: unknown): Promise<void> {
    const message = describe(err);
    const exhausted = job.attempts >= job.maxAttempts;
    let update: Record<string, unknown>;
    if (!exhausted) {
      update = { status: 'pending', runAt: new Date(now.getTime() + backoffMs(job.attempts)) };
    } else if (job.everyMs !== null) {
      // Une tâche récurrente ne s'éteint jamais : un fournisseur en panne une
      // journée ne doit pas arrêter définitivement un balayage. Elle repart à la
      // période suivante, tentatives remises à zéro, et l'échec est journalisé.
      update = { status: 'pending', runAt: new Date(now.getTime() + job.everyMs), attempts: 0 };
    } else {
      update = { status: 'failed' };
    }
    await this.model.updateOne(
      { _id: job._id, lockedBy: this.instanceId },
      { $set: { ...update, lockedBy: null, lockedUntil: null, lastError: message } },
    );
    const suite = update['status'] === 'failed' ? 'abandonnée' : 'replanifiée';
    this.logger.warn(
      `Tâche « ${job.name} » (${job.key}) en échec, tentative ${job.attempts}/${job.maxAttempts}, ${suite} : ${message}`,
    );
  }
}

/** Message d'erreur borné, sans pile : il est stocké en base et journalisé. */
function describe(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.slice(0, 500);
}
