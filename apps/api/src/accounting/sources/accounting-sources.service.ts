// Modèles EN LECTURE des pièces sources (ADR-0049 § 2.7 dernier alinéa, § 6 ; motif
// d'ADR-0046 § 6.2). ADR-0049 — K5.
//
// La comptabilité LIT les pièces du RUN, elle ne les écrit JAMAIS : ce service n'expose
// que des lectures (`find`, `findOne`) sur les collections des modules sources, par la
// connexion de l'application, avec une projection. Aucune méthode d'écriture n'est
// appelée ici, et aucun autre fichier du module comptable ne touche ces collections. Un
// test e2e vérifie que les documents sources sont égaux octet pour octet avant et après
// une synchronisation (critère 3).
//
// Toutes les lectures portent `organizationId` (isolation stricte).

import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Document, Filter } from 'mongodb';
import type { Connection } from 'mongoose';

/** Collections lues, et elles seules. */
export const ACCOUNTING_SOURCE_COLLECTIONS = {
  salesInvoices: 'sales_invoices',
  salesReceipts: 'sales_receipts',
  treasuryExpenses: 'treasury_expenses',
  treasuryMovements: 'treasury_movements',
  treasuryAccounts: 'treasury_accounts',
  supplierInvoices: 'supplier_invoices',
  supplierPayments: 'supplier_payments',
  customers: 'customers',
  suppliers: 'suppliers',
  fiscalProfiles: 'organization_fiscal_profiles',
} as const;
export type AccountingSourceCollection =
  (typeof ACCOUNTING_SOURCE_COLLECTIONS)[keyof typeof ACCOUNTING_SOURCE_COLLECTIONS];

/** Document source tel que lu (valeurs JSON, `_id` ObjectId). */
export type SourceDoc = Record<string, unknown> & { _id: { toHexString(): string } };

/** Filtre de lecture : pièces modifiées depuis un instant, ou identifiants précis. */
export interface SourceScope {
  since?: Date | null;
  ids?: readonly string[];
}

const PROJECTIONS: Partial<Record<AccountingSourceCollection, Record<string, 0 | 1>>> = {
  // Une facture est lourde (présentation, PDF, normalisation) : seuls les champs utiles.
  sales_invoices: {
    status: 1,
    type: 1,
    series: 1,
    number: 1,
    currency: 1,
    customer: 1,
    lines: 1,
    payments: 1,
    documentAmounts: 1,
    normalizedAmounts: 1,
    conversion: 1,
    issuedAt: 1,
    frozenAt: 1,
    updatedAt: 1,
  },
  treasury_expenses: { attachment: 0 },
  supplier_invoices: { attachment: 0, matching: 0, lines: 0 },
};

@Injectable()
export class AccountingSourcesService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** Lecture seule d'une collection source, pour UNE organisation. */
  async read(
    collection: AccountingSourceCollection,
    organizationId: string,
    scope: SourceScope = {},
    extra: Filter<Document> = {},
  ): Promise<SourceDoc[]> {
    const { ObjectId } = await import('mongodb');
    const filter: Filter<Document> = { ...extra, organizationId };
    if (scope.ids !== undefined) {
      const ids = scope.ids.filter((id) => /^[0-9a-f]{24}$/i.test(id));
      filter['_id'] = { $in: ids.map((id) => new ObjectId(id)) };
    }
    if (scope.since !== undefined && scope.since !== null) {
      filter['updatedAt'] = { $gte: scope.since };
    }
    const projection = PROJECTIONS[collection];
    const docs = await this.connection
      .collection(collection)
      .find(filter, projection === undefined ? {} : { projection })
      .sort({ _id: 1 })
      .toArray();
    return docs as unknown as SourceDoc[];
  }

  /** Statut d'assujettissement de la fiche fiscale (`seller-vat-status`) ; faux sans fiche. */
  async vatRegistered(organizationId: string): Promise<boolean> {
    const profile = await this.connection
      .collection(ACCOUNTING_SOURCE_COLLECTIONS.fiscalProfiles)
      .findOne({ organizationId }, { projection: { vatRegistered: 1 } });
    return profile?.['vatRegistered'] === true;
  }

  /** Noms des tiers (`customers`, `suppliers`) par identifiant. */
  async names(
    collection: 'customers' | 'suppliers',
    organizationId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const docs = await this.read(collection, organizationId, { ids: [...new Set(ids)] });
    return new Map(docs.map((d) => [d._id.toHexString(), String(d['name'] ?? '')]));
  }
}
