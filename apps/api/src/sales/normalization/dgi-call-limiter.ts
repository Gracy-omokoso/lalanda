// Sémaphore de processus des appels DGI de la normalisation — ADR-0024 § 6.
//
// Au plus QUATRE appels DGI simultanés par processus (normalisations des
// utilisateurs et rattrapage confondus). La DGI ne publie aucune limite de
// débit : on reste sobre. Un appel qui lève est rendu comme une défaillance
// réseau (issue inconnue) — l'appelant le traite donc avec la prudence d'une
// absence de réponse, jamais comme un refus sûr.

import { Injectable, Logger } from '@nestjs/common';

import type { EdefOutcome } from '../../edef/edef.types.js';

export const MAX_CONCURRENT_DGI_CALLS = 4;

@Injectable()
export class DgiCallLimiter {
  private readonly logger = new Logger('Normalisation');
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  async run<T>(call: () => Promise<EdefOutcome<T>>): Promise<EdefOutcome<T>> {
    await this.acquire();
    const started = Date.now();
    try {
      return await call();
    } catch (err) {
      // Erreur de programmation ou journal strict en échec (client F1) : on ne
      // sait pas si la requête est partie. Jamais le jeton dans ce message.
      this.logger.error(
        `Appel DGI interrompu par une erreur interne : ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        ok: false,
        durationMs: Date.now() - started,
        error: {
          kind: 'network',
          httpStatus: null,
          dgiErrorCode: null,
          message: 'L’appel à la DGI a été interrompu par une erreur interne de Lalanda.',
        },
      };
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < MAX_CONCURRENT_DGI_CALLS) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }
}
