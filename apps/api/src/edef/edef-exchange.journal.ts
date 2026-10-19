// Écriture du journal `edef_exchanges` — ADR-0021 §6, amendé par ADR-0024 § 6.
//
// Une classe distincte du client, pour deux raisons : le client se teste sans
// MongoDB (doublure en mémoire de ce journal), et la rédaction des corps vit à
// UN endroit, au point d'écriture, quel que soit l'appelant.
//
// Deux modes d'écriture (ADR-0024 O4) :
//  - `append` — NON bloquant : un échec d'écriture est signalé bruyamment dans
//    les journaux serveur, l'appel n'échoue pas. Lectures (`complete`) et
//    entrées `response` ;
//  - `appendStrict` — l'échec d'écriture REMONTE. Entrées `request` des appels
//    de facturation : pas de trace, pas d'envoi (la DGI exige la conservation
//    de chaque échange ; une facture normalisée sans trace serait indéfendable).

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { redactSecrets } from '../integrations/redaction.js';
import type { EdefEnvironment } from '../platform-config/dgi-platform.config.js';
import {
  EDEF_EXCHANGE_SCHEMA_VERSION,
  EdefExchange,
  type EdefExchangeDocument,
  type EdefExchangeEntryKind,
} from './edef-exchange.schema.js';

/** Taille maximale d'un corps conservé (ADR-0021 §6). */
export const EDEF_JOURNAL_BODY_LIMIT = 32 * 1024;

export interface EdefExchangeEntry {
  at: Date;
  /** UUID ; identique pour l'entrée `request` et sa `response`. */
  exchangeId: string;
  entry: EdefExchangeEntryKind;
  organizationId: string | null;
  pointOfSaleId: string | null;
  invoiceId: string | null;
  rn: string | null;
  uid: string | null;
  environment: EdefEnvironment;
  method: string;
  path: string;
  httpStatus: number | null;
  /** `null` pour une entrée `request`. */
  durationMs: number | null;
  /** `ok` ou un `EdefFailureKind` ; `null` pour une entrée `request`. */
  outcome: string | null;
  dgiErrorCode: string | null;
  /** Déjà rédigé et tronqué par `prepareEdefJournalBody`. */
  requestBody: string | null;
  /** Déjà rédigé et tronqué par `prepareEdefJournalBody`. */
  responseBody: string | null;
}

/** Contrat d'écriture — implémenté par Mongo, et par une doublure dans les tests. */
export abstract class EdefExchangeJournal {
  /** Non bloquant : ne lève jamais. */
  abstract append(entry: EdefExchangeEntry): Promise<void>;
  /** Strict : lève si l'entrée n'a pas été écrite. */
  abstract appendStrict(entry: EdefExchangeEntry): Promise<void>;
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
      await this.write(entry);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[edef] journal des échanges non écrit', {
        entry: entry.entry,
        exchangeId: entry.exchangeId,
        path: entry.path,
        outcome: entry.outcome,
        organizationId: entry.organizationId,
        invoiceId: entry.invoiceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async appendStrict(entry: EdefExchangeEntry): Promise<void> {
    await this.write(entry);
  }

  private async write(entry: EdefExchangeEntry): Promise<void> {
    await this.model.create({ ...entry, _schemaVersion: EDEF_EXCHANGE_SCHEMA_VERSION });
  }
}
