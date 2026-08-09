// Portillon de rendu PDF (S22e — audit de sécurité avant production).
//
// POURQUOI CE FICHIER EXISTE
//
// `ReportsService.renderPdf` ouvre une page Chromium par requête, sans aucune
// borne. Mesuré sur le poste de développement, sur `GET /projects/:id/report/pdf`
// avec une session unique et un projet unique :
//
//   1 export séquentiel        →  0,9 s,  ~3 processus Chromium
//   40 exports concurrents     → 17,5 s, 149 processus Chromium, 5,7 Go de RSS
//
// Le facteur limitant n'est pas le quota de débit : le seau global est de 100
// requêtes/minute (`security/throttling.ts`) et 40 requêtes simultanées passent
// sans jamais l'entamer. Un utilisateur authentifié — le rôle le plus faible
// portant `report.export`, donc un simple `accountant` invité — épuise la
// mémoire du conteneur API. `docker-compose.prod.yml` ne déclare aucune
// `mem_limit` : l'OOM killer de l'hôte arbitre, et sur un Droplet unique il
// emporte Mongo avec lui.
//
// CE QUE CE PORTILLON GARANTIT, ET CE QU'IL NE GARANTIT PAS
//
// Il borne le nombre de rendus SIMULTANÉS et la longueur de la file d'attente.
// Au-delà, il refuse vite (`503`) plutôt que d'accepter un travail qu'il ne peut
// pas mener à bien : une requête refusée en 1 ms est un incident lisible, 149
// processus Chromium sont une panne d'infrastructure.
//
// Il ne remplace PAS un quota d'export par utilisateur (ADR-0012 §6 R4 en
// prévoit un, il n'existe pas — voir docs/29). Il empêche l'épuisement mémoire,
// pas l'abus. Les deux sont nécessaires ; celui-ci est celui qui tient dans le
// périmètre du module `reports/`.

/** Bornes par défaut. Surchargeables par variable d'environnement (voir `readLimits`). */
export const RENDER_GATE_DEFAULTS = {
  /**
   * Rendus Chromium simultanés. 2 et non 1 : un rendu bloqué sur son délai
   * d'expiration ne doit pas geler tout le service. 2 et non 8 : chaque page
   * pèse ~140 Mo de RSS dans la mesure ci-dessus.
   */
  maxConcurrent: 2,
  /**
   * Requêtes en attente d'un jeton. Au-delà, refus immédiat. Dimensionné pour
   * absorber une rafale d'un poste client sans jamais accumuler du travail que
   * le délai d'expiration ferait de toute façon échouer.
   */
  maxQueued: 8,
  /**
   * Attente maximale d'un jeton, en millisecondes. Sous ce plafond une requête
   * refusée l'est explicitement ; au-dessus, le client aurait abandonné et le
   * rendu serait effectué pour personne.
   */
  queueTimeoutMs: 20_000,
} as const;

export interface RenderGateLimits {
  maxConcurrent: number;
  maxQueued: number;
  queueTimeoutMs: number;
}

/** Levée quand la file est pleine ou que l'attente a expiré. Traduite en 503 par le service. */
export class RenderGateBusyError extends Error {
  constructor(
    readonly reason: 'queue_full' | 'queue_timeout',
    /** Secondes à conseiller au client dans `Retry-After`. */
    readonly retryAfterSec: number,
  ) {
    super(
      reason === 'queue_full'
        ? "File d'attente de rendu PDF saturée."
        : "Délai d'attente d'un rendu PDF dépassé.",
    );
    this.name = 'RenderGateBusyError';
  }
}

/**
 * Sémaphore à file bornée.
 *
 * Le point délicat est la libération : `release` doit être appelé exactement une
 * fois, y compris quand le travail lève. `run()` l'enveloppe dans un `finally`
 * pour que l'appelant n'ait aucune discipline à tenir — un jeton fuité borne le
 * service à zéro rendu pour toujours, panne bien pire que celle qu'on corrige.
 */
export class RenderGate {
  private active = 0;
  private readonly waiting: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(private readonly limits: RenderGateLimits = RENDER_GATE_DEFAULTS) {}

  /** Instantané pour les tests et une éventuelle sonde de santé. */
  stats(): { active: number; queued: number } {
    return { active: this.active, queued: this.waiting.length };
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limits.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.limits.maxQueued) {
      return Promise.reject(
        new RenderGateBusyError('queue_full', Math.ceil(this.limits.queueTimeoutMs / 1000)),
      );
    }
    return new Promise<void>((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const i = this.waiting.indexOf(entry);
          if (i !== -1) this.waiting.splice(i, 1);
          reject(
            new RenderGateBusyError('queue_timeout', Math.ceil(this.limits.queueTimeoutMs / 1000)),
          );
        }, this.limits.queueTimeoutMs),
      };
      // `unref` : un jeton en attente ne doit pas maintenir le process en vie au
      // moment de l'arrêt (`OnModuleDestroy` ferme déjà le navigateur).
      entry.timer.unref?.();
      this.waiting.push(entry);
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (!next) {
      this.active -= 1;
      return;
    }
    // Le jeton est transmis SANS repasser par `active` : décrémenter puis
    // réincrémenter ouvrirait une fenêtre où un nouvel arrivant double la file.
    clearTimeout(next.timer);
    next.resolve();
  }
}

/**
 * Bornes effectives, lues dans l'environnement.
 *
 * Volontairement hors du schéma Zod partagé (`packages/shared/src/env`) : ce
 * sont des réglages d'exploitation d'un seul module, sans valeur de sécurité
 * propre — la valeur par défaut est déjà sûre, et une variable absente ou
 * illisible doit y retomber sans empêcher l'API de démarrer.
 */
export function readLimits(env: NodeJS.ProcessEnv = process.env): RenderGateLimits {
  return {
    maxConcurrent: positiveInt(
      env['REPORTS_PDF_MAX_CONCURRENCY'],
      RENDER_GATE_DEFAULTS.maxConcurrent,
    ),
    maxQueued: positiveInt(env['REPORTS_PDF_MAX_QUEUE'], RENDER_GATE_DEFAULTS.maxQueued),
    queueTimeoutMs: positiveInt(
      env['REPORTS_PDF_QUEUE_TIMEOUT_MS'],
      RENDER_GATE_DEFAULTS.queueTimeoutMs,
    ),
  };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
