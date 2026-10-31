// Sorties de stock par facture de vente émise — lecture après émission (ADR-0046
// § 2.8, § 6.2, O3). ADR-0046 — S4.
//
// Pour chaque facture finale (`issued`, `normalized`) relue en LECTURE SEULE :
//   - `FV`, `EV`, mode `automatic` : chaque ligne dont `catalogItemId` est lié à un
//     article SUIVI devient un `sale_issue` (`invoice:<id>:<index>`, constaté : jamais
//     refusé, O4), daté du jour d'émission (Kinshasa), à l'emplacement du point de vente
//     (`pointOfSaleIds`) ou, à défaut, à l'emplacement par défaut de l'article ; quantité
//     convertie par le moteur (`toStockQuantity`) ; unité inconnue : « À traiter » ;
//   - mode `proposed` : chaque ligne devient « À traiter » (`sale_issue_proposed`) ;
//     mode `off` : rien ;
//   - `FA`, `EA` (avoirs) : `sale_return_proposed` seulement, JAMAIS une rentrée
//     automatique (une remise n'a pas de retour physique) — plafond : quantité créditée.
// Aucune écriture dans les ventes, leur journal, leurs compteurs ni la normalisation ;
// aucune émission n'attend le stock. Idempotent : `sourceKey` des mouvements et des
// lignes « À traiter ».

import { toStockQuantity } from '@lalanda/engine';
import {
  stockSourceKey,
  type OpenStockPendingLineInput,
  type StockPendingProposal,
  type StockSyncSourceReport,
} from '@lalanda/shared/stock';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { recordObserved } from '../links/stock-links.common.js';
import { engineItem, negate, stockToday } from '../stock.common.js';
import { StockMovementsService, type StockMovementDraft } from '../stock-movements.service.js';
import { StockPendingService } from '../stock-pending.service.js';
import {
  StockItem,
  StockLocation,
  type StockItemLean,
  type StockLocationLean,
  type StockSettingsLean,
} from '../stock.schemas.js';
import {
  SalesInvoicesReader,
  STOCK_CREDIT_NOTE_TYPES,
  type InvoiceLineRead,
  type InvoiceRead,
} from './sales-invoices.reader.js';

@Injectable()
export class StockSalesSyncService {
  private readonly logger = new Logger('StockSalesSync');
  private readonly reader: SalesInvoicesReader;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(StockItem.name) private readonly items: Model<StockItemLean>,
    @InjectModel(StockLocation.name) private readonly locations: Model<StockLocationLean>,
    @Inject(StockMovementsService) private readonly ledger: StockMovementsService,
    @Inject(StockPendingService) private readonly pending: StockPendingService,
  ) {
    this.reader = new SalesInvoicesReader(connection);
  }

  /** Rejoue les factures finales émises ou normalisées depuis `since`. */
  async syncSince(
    organizationId: string,
    settings: StockSettingsLean,
    since: Date,
  ): Promise<StockSyncSourceReport> {
    const report: StockSyncSourceReport = { read: 0, written: 0, pending: 0 };
    if (settings.salesIssueMode === 'off') return report;
    const invoices = await this.reader.finalSince(
      organizationId,
      new Date(settings.createdAt),
      since,
    );
    report.read = invoices.length;
    if (invoices.length === 0) return report;

    const catalogIds = [
      ...new Set(
        invoices.flatMap((i) =>
          (i.lines ?? []).map((l) => l.catalogItemId).filter((c): c is string => !!c),
        ),
      ),
    ];
    const linked = await this.items
      .find({ organizationId, catalogItemId: { $in: catalogIds } })
      .lean<StockItemLean[]>()
      .exec();
    const byCatalog = new Map(linked.map((i) => [i.catalogItemId!, i]));
    const posLocations = await this.locations
      .find({ organizationId, active: true, 'pointOfSaleIds.0': { $exists: true } })
      .lean<StockLocationLean[]>()
      .exec();

    for (const invoice of invoices) {
      try {
        const r = await this.applyInvoice(
          organizationId,
          settings,
          invoice,
          byCatalog,
          posLocations,
        );
        report.written += r.written;
        report.pending += r.pending;
      } catch (err) {
        // Une facture illisible n'arrête pas les autres ; le passage suivant la reprend.
        this.logger.warn(
          `Facture ${String(invoice._id)} non traitée (org ${organizationId}) : ${(err as Error).message}`,
        );
      }
    }
    return report;
  }

  private async applyInvoice(
    organizationId: string,
    settings: StockSettingsLean,
    invoice: InvoiceRead,
    byCatalog: Map<string, StockItemLean>,
    posLocations: StockLocationLean[],
  ): Promise<{ written: number; pending: number }> {
    const invoiceId = String(invoice._id);
    const issuedAt = invoice.issuedAt ? new Date(invoice.issuedAt) : new Date();
    const occurredOn = stockToday(issuedAt);
    const posLocation = invoice.pointOfSaleId
      ? posLocations.find((l) => l.pointOfSaleIds.includes(invoice.pointOfSaleId!))
      : undefined;
    const isCredit = (STOCK_CREDIT_NOTE_TYPES as readonly string[]).includes(invoice.type);
    const drafts: StockMovementDraft[] = [];
    let pending = 0;

    for (const line of invoice.lines ?? []) {
      if (!line.catalogItemId) continue;
      const item = byCatalog.get(line.catalogItemId);
      if (!item || !item.tracked || !item.active) continue; // article non suivi : rien ne sort
      const movementSourceKey = stockSourceKey.invoice(invoiceId, line.index);
      const locationId =
        posLocation !== undefined
          ? String(posLocation._id)
          : (item.defaultLocationId ?? settings.defaultLocationId);
      const unit = line.unit ?? item.unit;
      const converted = toStockQuantity(String(line.quantity), unit, engineItem(item));
      const base = proposalOf(invoiceId, line, String(item._id), occurredOn, posLocation);

      if (isCredit) {
        pending += await this.open(organizationId, {
          reason: 'sale_return_proposed',
          sourceKey: `return:${movementSourceKey}`,
          proposal: {
            ...base,
            movementKind: 'sale_return',
            ...(converted.ok
              ? { quantity: converted.quantity, unit: item.unit, maxQuantity: converted.quantity }
              : { quantity: String(line.quantity), unit, maxQuantity: null }),
          },
        });
        continue;
      }
      if (settings.salesIssueMode === 'proposed') {
        pending += await this.open(organizationId, {
          reason: 'sale_issue_proposed',
          sourceKey: `proposed:${movementSourceKey}`,
          proposal: {
            ...base,
            ...(converted.ok
              ? { quantity: converted.quantity, unit: item.unit, maxQuantity: converted.quantity }
              : { quantity: String(line.quantity), unit }),
          },
        });
        continue;
      }
      if (!converted.ok) {
        pending += await this.open(organizationId, {
          reason: 'unknown_unit',
          sourceKey: `pending:${movementSourceKey}`,
          proposal: { ...base, quantity: String(line.quantity), unit },
        });
        continue;
      }
      drafts.push({
        itemId: String(item._id),
        locationId,
        kind: 'sale_issue',
        quantity: negate(converted.quantity),
        occurredOn,
        unitCost: null,
        costStatus: 'not_applicable',
        source: { kind: 'invoice', invoiceId, lineIndex: line.index },
        sourceKey: movementSourceKey,
        workProjectId: null,
      });
    }
    const result = await recordObserved(
      { connection: this.connection, ledger: this.ledger, pending: this.pending },
      organizationId,
      drafts,
      () => null,
    );
    return { written: result.written.length, pending };
  }

  private async open(organizationId: string, input: OpenStockPendingLineInput): Promise<number> {
    return (await this.pending.open(organizationId, input)).created ? 1 : 0;
  }
}

function proposalOf(
  invoiceId: string,
  line: InvoiceLineRead,
  itemId: string,
  occurredOn: string,
  posLocation: StockLocationLean | undefined,
): StockPendingProposal {
  return {
    movementKind: 'sale_issue',
    movementSourceKey: stockSourceKey.invoice(invoiceId, line.index),
    source: { kind: 'invoice', invoiceId, lineIndex: line.index },
    itemId,
    itemRef: null,
    label: line.name ?? null,
    quantity: String(line.quantity),
    unit: line.unit ?? '',
    occurredOn,
    locationId: posLocation ? String(posLocation._id) : null,
    unitPrice: null,
    discountPercent: null,
    currency: null,
    workProjectId: null,
    orderId: null,
    movementId: null,
    maxQuantity: null,
    invoicedUnitCost: null,
  };
}
