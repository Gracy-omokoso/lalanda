// Écriture du journal `edef_exchanges` — ADR-0021 §6.
//
// Une classe distincte du client, pour deux raisons : le client se teste sans
// MongoDB (doublure en mémoire de ce journal), et la rédaction du corps de
// réponse vit à UN endroit, au point d'écriture, quel que soit l'appelant.
//
// Un échec d'écriture du journal ne fait pas échouer l'appel : il est signalé
// bruyamment dans les journaux serveur. Pour les lectures de ce lot (statut et
// listes publiques), refuser le résultat d'un appel réussi à cause d'une panne
// de journal n'apporterait rien ; l'émission des factures (S25f) devra, elle,
// décider d'un journal strict.

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { redactSecrets } from '../integrations/redaction.js';
import type { EdefEnvironment } from '../platform-config/dgi-platform.config.js';
import { EdefExchange, type EdefExchangeDocument } from './edef-exchange.schema.js';

/** Taille maximale d'un corps de réponse conservé (ADR-0021 §6). */
export const EDEF_JOURNAL_BODY_LIMIT = 32 * 1024;

export interface EdefExchangeEntry {
  at: Date;
  organizationId: string | null;
  pointOfSaleId: string | null;
  environment: EdefEnvironment;
  method: string;
  path: string;
  httpStatus: number | null;
  durationMs: number;
  outcome: string;
  dgiErrorCode: string | null;
  requestBody: string | null;
  /** Texte brut ; tronqué et rédigé par `prepareEdefJournalBody`. */
  responseBody: string | null;
}

/** Contrat d'écriture — implémenté par Mongo, et par une doublure dans les tests. */
export abstract class EdefExchangeJournal {
  abstract append(entry: EdefExchangeEntry): Promise<void>;
}

/**
 * Rédaction puis troncature d'un corps destiné au journal.
 *
 * La rédaction AVANT la troncature : tronquer d'abord pourrait couper le jeton
 * en deux et laisser passer un fragment que `redactSecrets` ne reconnaîtrait
 * plus.
 */
export function prepareEdefJournalBody(
  body: string | null,
  secrets: readonly string[],
): string | null {
  if (body === null) return null;
  const redacted = redactSecrets(body, secrets);
  return redacted.length > EDEF_JOURNAL_BODY_LIMIT
    ? `${redacted.slice(0, EDEF_JOURNAL_BODY_LIMIT)}…[tronqué]`
    : redacted;
}

@Injectable()
export class MongoEdefExchangeJournal extends EdefExchangeJournal {
  constructor(@InjectModel(EdefExchange.name) private readonly model: Model<EdefExchangeDocument>) {
    super();
  }

  async append(entry: EdefExchangeEntry): Promise<void> {
    try {
      await this.model.create({ ...entry, _schemaVersion: 1 });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[edef] journal des échanges non écrit', {
        path: entry.path,
        outcome: entry.outcome,
        organizationId: entry.organizationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
