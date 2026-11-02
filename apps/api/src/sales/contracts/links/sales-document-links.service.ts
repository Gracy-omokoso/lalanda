// Liens facture ↔ engagement — ADR-0050 § 2.7. ADR-0050 — V2.
//
// Seul écrivain de `sales_document_links`. Les factures sont LUES en lecture seule
// par la connexion (`sales_invoices`), jamais par le modèle des factures dont les
// écrivains sont comptés (`invoices.sources.test.ts`). Toute lecture porte
// `organizationId` : un lien vers une facture d'une autre organisation est impossible
// (la facture est introuvable, le lien est refusé ou ignoré).
//
// Partagé par les lots V3 (contrats), V4 (acomptes) et V5 (échéances).

import type { LinkedInvoiceInput } from '@lalanda/engine';
import type { SalesDocumentLinkKind } from '@lalanda/shared/sales-contracts';
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import type { InvoiceStatus, InvoiceType } from '../../invoices/invoice.contract.js';
import type { StoredDocumentAmounts, StoredLine } from '../../invoices/invoice.types.js';
import { isObjectIdHex } from '../../search.js';
import { READ_ONLY_COLLECTIONS } from '../common/contracts.common.js';
import {
  SalesDocumentLink,
  type SalesDocumentLineMapEntry,
  type SalesDocumentLinkDocument,
  type SalesDocumentLinkLean,
} from './sales-document-link.schema.js';

/** Facture liée, lue telle quelle (lecture seule). */
export interface LinkedInvoiceRead {
  _id: Types.ObjectId;
  type: InvoiceType;
  status: InvoiceStatus;
  number: string | null;
  proformaRef: string | null;
  currency: 'CDF' | 'USD';
  lines: StoredLine[];
  documentAmounts: StoredDocumentAmounts;
  normalization?: { codeDefDgi?: string | null } | null;
}

export interface LiveLink {
  link: SalesDocumentLinkLean;
  invoice: LinkedInvoiceRead;
}

/** Statuts d'une facture émise en série réelle (ADR-0050 § 5.2). */
const FINAL_STATUSES: readonly InvoiceStatus[] = ['issued', 'normalized'];

/**
 * État vu par le moteur : `issued` = émise ou normalisée (figée, série réelle) ;
 * `draft` = tout le reste (brouillon, normalisation en cours ou en échec) — compté
 * comme « en cours », ce qui empêche une seconde préparation de le dépasser.
 */
export function invoiceStateOf(status: InvoiceStatus): 'draft' | 'issued' {
  return FINAL_STATUSES.includes(status) ? 'issued' : 'draft';
}

/** Lien vivant → entrée du moteur (`orderInvoicing`). */
export function linkedInvoiceInput({ link, invoice }: LiveLink): LinkedInvoiceInput {
  return {
    invoiceId: link.invoiceId,
    state: invoiceStateOf(invoice.status),
    lines: invoice.lines.map((l) => ({
      index: l.index,
      catalogItemId: l.catalogItemId ?? null,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
    })),
    lineMap: link.lineMap.map((m) => ({
      invoiceLineIndex: m.invoiceLineIndex,
      lineRef: m.lineRef,
      quantity: m.quantity,
    })),
  };
}

export interface NewSalesDocumentLink {
  invoiceId: string;
  kind: SalesDocumentLinkKind;
  orderId?: string | null;
  contractId?: string | null;
  itemRef?: string | null;
  occurrenceDate?: string | null;
  lineMap?: SalesDocumentLineMapEntry[];
  requestedAmount?: string | null;
  linkedBy: string;
}

type Owner = { orderId: string } | { contractId: string };

@Injectable()
export class SalesDocumentLinksService {
  constructor(
    @InjectModel(SalesDocumentLink.name)
    private readonly links: Model<SalesDocumentLinkDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** Factures de l'organisation, par identifiant (lecture seule). */
  async invoicesOf(
    organizationId: string,
    ids: readonly string[],
  ): Promise<Map<string, LinkedInvoiceRead>> {
    const valid = [...new Set(ids.filter(isObjectIdHex))];
    if (valid.length === 0) return new Map();
    const docs = (await this.connection
      .collection(READ_ONLY_COLLECTIONS.invoices)
      .find(
        { _id: { $in: valid.map((id) => new Types.ObjectId(id)) }, organizationId },
        {
          projection: {
            type: 1,
            status: 1,
            number: 1,
            proformaRef: 1,
            currency: 1,
            lines: 1,
            documentAmounts: 1,
            'normalization.codeDefDgi': 1,
          },
        },
      )
      .toArray()) as unknown as LinkedInvoiceRead[];
    return new Map(docs.map((d) => [String(d._id), d]));
  }

  /**
   * Pose un lien. La facture doit appartenir à l'organisation (sinon rien n'est
   * écrit) ; une facture déjà liée → erreur d'index unique, remontée à l'appelant.
   */
  async link(organizationId: string, input: NewSalesDocumentLink): Promise<SalesDocumentLinkLean> {
    const found = await this.invoicesOf(organizationId, [input.invoiceId]);
    if (!found.has(input.invoiceId)) {
      throw new Error(`Facture ${input.invoiceId} introuvable dans l'organisation`);
    }
    const doc = await this.links.create({
      organizationId,
      invoiceId: input.invoiceId,
      kind: input.kind,
      orderId: input.orderId ?? null,
      contractId: input.contractId ?? null,
      itemRef: input.itemRef ?? null,
      occurrenceDate: input.occurrenceDate ?? null,
      lineMap: input.lineMap ?? [],
      requestedAmount: input.requestedAmount ?? null,
      linkedAt: new Date(),
      linkedBy: input.linkedBy,
      _schemaVersion: 1,
    });
    return doc.toObject() as SalesDocumentLinkLean;
  }

  /**
   * Liens VIVANTS d'un ou plusieurs engagements, avec leur facture. Un lien dont la
   * facture n'existe plus (brouillon supprimé) est retiré au passage.
   */
  async liveLinks(organizationId: string, owners: readonly Owner[]): Promise<LiveLink[]> {
    const orderIds = owners.flatMap((o) => ('orderId' in o ? [o.orderId] : []));
    const contractIds = owners.flatMap((o) => ('contractId' in o ? [o.contractId] : []));
    const or: Record<string, unknown>[] = [];
    if (orderIds.length > 0) or.push({ orderId: { $in: orderIds } });
    if (contractIds.length > 0) or.push({ contractId: { $in: contractIds } });
    if (or.length === 0) return [];
    const links = await this.links
      .find({ organizationId, $or: or })
      .sort({ linkedAt: 1, _id: 1 })
      .lean<SalesDocumentLinkLean[]>()
      .exec();
    const invoices = await this.invoicesOf(
      organizationId,
      links.map((l) => l.invoiceId),
    );
    const orphans = links.filter((l) => !invoices.has(l.invoiceId));
    if (orphans.length > 0) {
      await this.links
        .deleteMany({ organizationId, _id: { $in: orphans.map((l) => l._id) } })
        .exec();
    }
    return links.flatMap((link) => {
      const invoice = invoices.get(link.invoiceId);
      return invoice ? [{ link, invoice }] : [];
    });
  }

  /** Lien d'une facture (au plus un), ou `null`. */
  async linkOfInvoice(
    organizationId: string,
    invoiceId: string,
  ): Promise<SalesDocumentLinkLean | null> {
    return this.links.findOne({ organizationId, invoiceId }).lean<SalesDocumentLinkLean>().exec();
  }
}
