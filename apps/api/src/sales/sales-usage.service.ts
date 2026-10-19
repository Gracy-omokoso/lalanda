// Marque d'usage en facturation — ADR-0022 § S25c.6, § O7.
//
// Livré SANS APPELANT pour le lot S25e (même précédent qu'`emissionModeOf`,
// ADR-0021) : l'émission d'une facture appellera `markInvoiced` dans sa
// transaction.
//
// C'est le SEUL écrivain de `firstInvoicedAt` (test `sales.unit.test.ts`). Le
// champ n'est posé que s'il est `null` et n'est jamais remis à `null` : un client
// ou un article déjà facturé ne peut plus être supprimé, seulement désactivé.

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Model } from 'mongoose';

import { CatalogItem, type CatalogItemDocument } from './catalog-item.schema.js';
import { Customer, type CustomerDocument } from './customer.schema.js';
import { isObjectIdHex } from './search.js';

function objectIdOf(id: string): Types.ObjectId {
  // Un identifiant mal formé ici est une erreur de programmation de l'appelant
  // (la facture a déjà résolu ses références) : on échoue bruyamment.
  if (!isObjectIdHex(id)) throw new TypeError(`Identifiant invalide : ${id}`);
  return new Types.ObjectId(id);
}

@Injectable()
export class SalesUsageService {
  constructor(
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(CatalogItem.name) private readonly items: Model<CatalogItemDocument>,
  ) {}

  /**
   * Pose `firstInvoicedAt` sur le client et les articles d'une facture, s'il est
   * encore `null`. Bornée à l'organisation : une référence d'une autre
   * organisation n'est pas touchée.
   */
  async markInvoiced(
    organizationId: string,
    refs: { customerId: string | null; catalogItemIds: readonly string[] },
    opts: { session?: ClientSession } = {},
  ): Promise<void> {
    const at = new Date();
    const options = opts.session ? { session: opts.session } : {};
    // Tous les identifiants sont vérifiés AVANT la première écriture.
    const customerId = refs.customerId === null ? null : objectIdOf(refs.customerId);
    const ids = [...new Set(refs.catalogItemIds)].map(objectIdOf);
    if (customerId !== null) {
      await this.customers
        .updateOne(
          { _id: customerId, organizationId, firstInvoicedAt: null },
          { $set: { firstInvoicedAt: at }, $inc: { revision: 1 } },
          options,
        )
        .exec();
    }
    if (ids.length > 0) {
      await this.items
        .updateMany(
          { _id: { $in: ids }, organizationId, firstInvoicedAt: null },
          { $set: { firstInvoicedAt: at }, $inc: { revision: 1 } },
          options,
        )
        .exec();
    }
  }
}
