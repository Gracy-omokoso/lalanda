// Lectures SEULES des pièces nécessaires à la proposition de reprise (ADR-0049 § 3.2).
// ADR-0049 — K7.
//
// La reprise LIT les factures, avoirs et encaissements de vente, les factures, avoirs et
// paiements fournisseurs : `find` seulement, par la connexion de l'application, avec une
// projection, toujours filtrés par `organizationId`. Aucune méthode d'écriture n'est
// appelée ici (test de surface `opening-sources.surface.test.ts`). Ce fichier ne calcule
// rien : les restes sont calculés par les moteurs (`computeSettlement`,
// `payableSettlement`) dans le service, avec les pièces ANTÉRIEURES au jour de bascule.
//
// Pourquoi pas `AccountingSourcesService` (K5) : sa projection des factures de vente ne
// porte ni la part à crédit (`amountOnCredit`) ni l'origine d'un avoir (`creditNote`),
// et les lectures de règlement des modules sources ne disent pas la date des encaissements.

import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Document, Filter } from 'mongodb';
import type { Connection } from 'mongoose';

import { CREDIT_NOTE_TYPES } from '../../sales/invoices/invoice.contract.js';
import { kinshasaDayOf } from '../../sales/receipts/kinshasa-day.js';

/** Statuts d'une facture de vente gelée et définitive (ADR-0031 § 2). */
const FINAL_SALES_STATUSES = ['issued', 'normalized'];
const CREDIT_TYPES: readonly string[] = CREDIT_NOTE_TYPES;

/** Facture de vente à reprendre : part à crédit, avoirs et encaissements antérieurs. */
export interface OpeningSalesInvoice {
  id: string;
  number: string | null;
  currency: string;
  customerId: string | null;
  customerName: string | null;
  amountOnCredit: string;
  creditNoteCredits: string[];
  allocations: string[];
}

/** Facture fournisseur à reprendre : total, paiements et avoirs antérieurs. */
export interface OpeningSupplierInvoice {
  id: string;
  number: string | null;
  currency: string;
  supplierId: string;
  supplierName: string | null;
  total: string;
  allocations: string[];
  creditNotes: string[];
}

const dayOf = (v: unknown): string | null => {
  if (v instanceof Date) return kinshasaDayOf(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return kinshasaDayOf(new Date(v));
  return null;
};
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const idOf = (d: Document): string => String(d['_id']);

@Injectable()
export class OpeningSourcesReader {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private find(
    collection: string,
    organizationId: string,
    filter: Filter<Document>,
    projection: Record<string, 1>,
  ): Promise<Document[]> {
    return this.connection
      .collection(collection)
      .find({ ...filter, organizationId }, { projection })
      .sort({ _id: 1 })
      .toArray();
  }

  /**
   * Factures de vente de la série réelle, définitives, émises AVANT le jour de bascule,
   * avec une part à crédit ; avoirs et encaissements datés AVANT ce jour seulement.
   */
  async salesInvoices(organizationId: string, cutover: string): Promise<OpeningSalesInvoice[]> {
    const invoices = (
      await this.find(
        'sales_invoices',
        organizationId,
        {
          status: { $in: FINAL_SALES_STATUSES },
          series: 'real',
          type: { $nin: CREDIT_TYPES },
          amountOnCredit: { $type: 'string' },
        },
        { number: 1, currency: 1, customer: 1, amountOnCredit: 1, issuedAt: 1, frozenAt: 1 },
      )
    ).filter((d) => {
      const day = dayOf(d['issuedAt'] ?? d['frozenAt']);
      return day !== null && day < cutover;
    });
    if (invoices.length === 0) return [];
    const ids = invoices.map(idOf);
    const [creditNotes, receipts] = await Promise.all([
      this.find(
        'sales_invoices',
        organizationId,
        {
          status: { $in: FINAL_SALES_STATUSES },
          type: { $in: CREDIT_TYPES },
          'creditNote.originInvoiceId': { $in: ids },
          amountOnCredit: { $type: 'string' },
        },
        { creditNote: 1, amountOnCredit: 1, issuedAt: 1, frozenAt: 1 },
      ),
      this.find(
        'sales_receipts',
        organizationId,
        { status: 'recorded', invoiceIds: { $in: ids }, receivedOn: { $lt: cutover } },
        { allocations: 1 },
      ),
    ]);
    return invoices.map((d) => {
      const id = idOf(d);
      const customer = (d['customer'] ?? null) as {
        customerId?: unknown;
        name?: unknown;
      } | null;
      return {
        id,
        number: str(d['number']),
        currency: String(d['currency']),
        customerId: str(customer?.customerId),
        customerName: str(customer?.name),
        amountOnCredit: String(d['amountOnCredit']),
        creditNoteCredits: creditNotes
          .filter((c) => {
            const day = dayOf(c['issuedAt'] ?? c['frozenAt']);
            const origin = (c['creditNote'] ?? null) as { originInvoiceId?: unknown } | null;
            return origin?.originInvoiceId === id && day !== null && day < cutover;
          })
          .map((c) => String(c['amountOnCredit'])),
        allocations: receipts.flatMap((r) =>
          ((r['allocations'] ?? []) as { invoiceId?: unknown; amount?: unknown }[])
            .filter((a) => a.invoiceId === id && typeof a.amount === 'string')
            .map((a) => a.amount as string),
        ),
      };
    });
  }

  /**
   * Factures fournisseurs VALIDÉES datées AVANT le jour de bascule ; paiements non annulés
   * et avoirs validés datés AVANT ce jour seulement.
   */
  async supplierInvoices(
    organizationId: string,
    cutover: string,
  ): Promise<OpeningSupplierInvoice[]> {
    const invoices = await this.find(
      'supplier_invoices',
      organizationId,
      { status: 'validated', kind: 'invoice', invoiceDate: { $lt: cutover } },
      { internalNumber: 1, currency: 1, supplierId: 1, total: 1 },
    );
    if (invoices.length === 0) return [];
    const ids = invoices.map(idOf);
    const supplierIds = [...new Set(invoices.map((d) => String(d['supplierId'])))];
    const { ObjectId } = await import('mongodb');
    const [payments, credits, suppliers] = await Promise.all([
      this.find(
        'supplier_payments',
        organizationId,
        {
          status: { $ne: 'cancelled' },
          'allocations.invoiceId': { $in: ids },
          paidOn: { $lt: cutover },
        },
        { allocations: 1 },
      ),
      this.find(
        'supplier_invoices',
        organizationId,
        {
          status: 'validated',
          kind: 'credit_note',
          creditedInvoiceId: { $in: ids },
          invoiceDate: { $lt: cutover },
        },
        { creditedInvoiceId: 1, total: 1 },
      ),
      this.find(
        'suppliers',
        organizationId,
        {
          _id: {
            $in: supplierIds.filter((s) => /^[0-9a-f]{24}$/i.test(s)).map((s) => new ObjectId(s)),
          },
        },
        { name: 1 },
      ),
    ]);
    const names = new Map(suppliers.map((s) => [idOf(s), str(s['name'])]));
    return invoices.map((d) => {
      const id = idOf(d);
      const supplierId = String(d['supplierId']);
      return {
        id,
        number: str(d['internalNumber']),
        currency: String(d['currency']),
        supplierId,
        supplierName: names.get(supplierId) ?? null,
        total: String(d['total']),
        allocations: payments.flatMap((p) =>
          ((p['allocations'] ?? []) as { invoiceId?: unknown; amount?: unknown }[])
            .filter((a) => a.invoiceId === id && typeof a.amount === 'string')
            .map((a) => a.amount as string),
        ),
        creditNotes: credits
          .filter((c) => c['creditedInvoiceId'] === id)
          .map((c) => String(c['total'])),
      };
    });
  }
}
