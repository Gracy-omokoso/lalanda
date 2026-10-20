// Garde des appels DGI de la normalisation — ADR-0024 § 3 et § 6.
//
// Le client e-MCF (F1) borne déjà à quatre les appels simultanés et ne lève
// jamais pour une défaillance distante. Cette garde ne fait que deux choses :
//  - une exception INATTENDUE (erreur de programmation) devient une défaillance
//    « réseau » : issue inconnue, donc traitée avec la prudence d'une absence de
//    réponse, jamais comme un refus sûr ;
//  - `EdefJournalWriteError` est relancée telle quelle : le journal strict n'a
//    pas pu écrire l'entrée « requête », donc RIEN n'est parti — l'appelant le
//    sait avec certitude et agit en conséquence.

import { Injectable, Logger } from '@nestjs/common';

import { EdefJournalWriteError } from '../../edef/edef.client.js';
import type { EdefOutcome } from '../../edef/edef.types.js';

@Injectable()
export class DgiCallGuard {
  private readonly logger = new Logger('Normalisation');

  async run<T>(call: () => Promise<EdefOutcome<T>>): Promise<EdefOutcome<T>> {
    const started = Date.now();
    try {
      return await call();
    } catch (err) {
      if (err instanceof EdefJournalWriteError) throw err;
      // Jamais le jeton dans ce message : le client ne l'inclut dans aucune erreur.
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
    }
  }
}
