// Numérotation des pièces internes des achats — ADR-0044 § 2.3 à § 2.6. ADR-0044 — P3.
//
// Format `{P}{AA}{MM}-NNNNNN` (motif des devis `DV…`, ADR-0035, et de la
// numérotation d'ADR-0027) : année et mois au jour de Kinshasa, compteur ANNUEL par
// organisation et par nature, trous admis (un numéro pris dans une transaction
// annulée est perdu), HORS série fiscale. Service partagé : P3 (`DA`, `BC`), P4
// (`FF`) et P5 (`PF`) l'appellent, chacun avec sa nature.

import { PURCHASE_NUMBER_PREFIXES, type PurchaseNumberKind } from '@lalanda/shared/purchases';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';

import {
  fiscalYearOf,
  periodInYear,
  type NumberingPeriod,
} from '../../sales/invoices/invoice-numbering.js';
import { isDuplicateKey } from '../../sales/sales.errors.js';
import { PurchaseCounter, type PurchaseCounterDocument } from './purchase-counter.schema.js';

/** `DA2610-000001`, `BC2611-000042`… */
export function formatPurchaseNumber(
  kind: PurchaseNumberKind,
  period: NumberingPeriod,
  seq: number,
): string {
  const yy = String(period.year % 100).padStart(2, '0');
  const mm = String(period.month).padStart(2, '0');
  return `${PURCHASE_NUMBER_PREFIXES[kind]}${yy}${mm}-${String(seq).padStart(6, '0')}`;
}

@Injectable()
export class PurchaseCountersService {
  constructor(
    @InjectModel(PurchaseCounter.name) private readonly counters: Model<PurchaseCounterDocument>,
  ) {}

  /**
   * Numéro suivant de la nature `kind`, attribué à l'instant `now`. Dans la
   * transaction de l'appelant (`session`) : un numéro n'est consommé que si
   * l'écriture qui le porte est validée — sinon un trou, admis.
   */
  async next(
    organizationId: string,
    kind: PurchaseNumberKind,
    now: Date,
    session?: ClientSession,
  ): Promise<string> {
    const year = fiscalYearOf(now);
    const bump = () =>
      this.counters
        .findOneAndUpdate(
          { organizationId, kind, year },
          { $inc: { last: 1 }, $setOnInsert: { _schemaVersion: 1 } },
          { upsert: true, new: true, ...(session ? { session } : {}) },
        )
        .lean<PurchaseCounter>()
        .exec();
    let counter: PurchaseCounter | null;
    try {
      counter = await bump();
    } catch (err) {
      // Première création concurrente du compteur : la seconde bute sur l'index unique.
      if (!isDuplicateKey(err)) throw err;
      counter = await bump();
    }
    return formatPurchaseNumber(kind, periodInYear(year, now), counter!.last);
  }
}
