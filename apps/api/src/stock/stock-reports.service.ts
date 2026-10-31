// Niveaux, contrôle du cache, valorisation, réapprovisionnement et rapports
// (ADR-0046 § 2.5, § 5.1, § 7.1). ADR-0046 — S3.
//
// Tous les nombres viennent du moteur : `replenishmentSuggestions` (seuils),
// `stockLevelDrift` (cache contre grand livre), `stockValuation` (rejeu à une date),
// `stockReport` (entrées, sorties, consommations, coût des ventes, par devise). Les
// quantités « commandées non reçues » viennent d'un port (`STOCK_OPEN_ORDERS_SOURCE`)
// que le lot S4 branche sur les achats ; nul ici.

import {
  replenishmentSuggestions,
  STOCK_VERSION,
  stockLevelDrift,
  stockReport,
  stockValuation,
  type OpenOrderQuantityInput,
  type ReplenishmentSuggestion,
} from '@lalanda/engine';
import type {
  ListStockLevelsQuery,
  StockLevelsRebuildReport,
  StockLevelsResponse,
  StockReorderAlertView,
  StockReplenishmentResponse,
  StockReportResponse,
  StockReportsQuery,
  StockValuationQuery,
  StockValuationResponse,
} from '@lalanda/shared/stock';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import {
  engineItem,
  engineMovement,
  inTransaction,
  qty3,
  requireAction,
  seesValues,
  type StockActor,
} from './stock.common.js';
import { StockLocationsService } from './stock-locations.service.js';
import { StockMovementsService } from './stock-movements.service.js';
import { StockItem, StockLevel, type StockItemLean, type StockLevelLean } from './stock.schemas.js';
import { StockSettingsService } from './stock-settings.service.js';

/** Port des quantités commandées non reçues (lot S4 : lecture des commandes R3). */
export const STOCK_OPEN_ORDERS_SOURCE = Symbol('STOCK_OPEN_ORDERS_SOURCE');
export interface StockOpenOrdersSource {
  /** Restes à recevoir par article, déjà convertis en unité de stock. */
  openOrders(organizationId: string): Promise<OpenOrderQuantityInput[]>;
}
export const noStockOpenOrders: StockOpenOrdersSource = { openOrders: async () => [] };

@Injectable()
export class StockReportsService {
  private readonly logger = new Logger('StockLevels');
  private readonly openOrders: StockOpenOrdersSource;

  constructor(
    @InjectModel(StockItem.name) private readonly items: Model<StockItemLean>,
    @InjectModel(StockLevel.name) private readonly levels: Model<StockLevelLean>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(StockMovementsService) private readonly ledger: StockMovementsService,
    @Inject(StockLocationsService) private readonly locations: StockLocationsService,
    @Inject(StockSettingsService) private readonly settings: StockSettingsService,
    @Optional() @Inject(STOCK_OPEN_ORDERS_SOURCE) openOrders: StockOpenOrdersSource | null,
  ) {
    this.openOrders = openOrders ?? noStockOpenOrders;
  }

  private async context(organizationId: string) {
    await this.settings.ensure(organizationId);
    const [items, levels, names] = await Promise.all([
      this.items.find({ organizationId }).lean<StockItemLean[]>().exec(),
      this.levels.find({ organizationId }).lean<StockLevelLean[]>().exec(),
      this.locations.names(organizationId),
    ]);
    return { items, levels, names, byId: new Map(items.map((i) => [String(i._id), i])) };
  }

  private suggestionsOf(
    ctx: Awaited<ReturnType<StockReportsService['context']>>,
    open: OpenOrderQuantityInput[],
  ): StockReorderAlertView[] {
    const result = replenishmentSuggestions(
      ctx.levels.map((l) => ({
        itemId: l.itemId,
        locationId: l.locationId,
        quantity: qty3(l.quantity.toString()),
      })),
      ctx.items.map(engineItem),
      open,
    );
    return result.suggestions.map((s: ReplenishmentSuggestion) => {
      const item = ctx.byId.get(s.itemId)!;
      return {
        ...s,
        itemCode: item.code ?? null,
        itemName: item.name,
        unit: item.unit,
        locationName: s.locationId === null ? null : (ctx.names.get(s.locationId) ?? null),
      };
    });
  }

  async levelsView(
    organizationId: string,
    query: ListStockLevelsQuery,
  ): Promise<StockLevelsResponse> {
    const ctx = await this.context(organizationId);
    let belowReorder = this.suggestionsOf(ctx, await this.openOrders.openOrders(organizationId));
    if (query.locationId) {
      belowReorder = belowReorder.filter(
        (s) => s.locationId === null || s.locationId === query.locationId,
      );
    }
    if (query.itemId) belowReorder = belowReorder.filter((s) => s.itemId === query.itemId);
    const alerted = new Set(belowReorder.map((s) => s.itemId));
    const levels = ctx.levels
      .filter((l) => ctx.byId.get(l.itemId)?.active !== false)
      .filter((l) => !query.locationId || l.locationId === query.locationId)
      .filter((l) => !query.itemId || l.itemId === query.itemId)
      .filter((l) => query.below !== 'reorder' || alerted.has(l.itemId))
      .map((l) => {
        const item = ctx.byId.get(l.itemId);
        return {
          itemId: l.itemId,
          itemCode: item?.code ?? null,
          itemName: item?.name ?? '',
          unit: item?.unit ?? '',
          locationId: l.locationId,
          locationName: ctx.names.get(l.locationId) ?? null,
          quantity: qty3(l.quantity.toString()),
          lastMovementAt: l.lastMovementAt ? new Date(l.lastMovementAt).toISOString() : null,
        };
      })
      .sort(
        (a, b) => a.itemName.localeCompare(b.itemName) || a.locationId.localeCompare(b.locationId),
      );
    return { version: STOCK_VERSION, levels, belowReorder };
  }

  async replenishment(organizationId: string): Promise<StockReplenishmentResponse> {
    const ctx = await this.context(organizationId);
    return {
      version: STOCK_VERSION,
      suggestions: this.suggestionsOf(ctx, await this.openOrders.openOrders(organizationId)),
    };
  }

  /**
   * Contrôle du cache (moteur `stockLevelDrift`). `fix` : rétablit chaque niveau à la
   * quantité du grand livre, dans une transaction (une écriture concurrente sur le même
   * niveau la fait rejouer).
   */
  async checkLevels(organizationId: string, fix: boolean): Promise<StockLevelsRebuildReport> {
    return inTransaction(this.connection, async (session) => {
      const [levels, movements] = await Promise.all([
        this.levels.find({ organizationId }, null, { session }).lean<StockLevelLean[]>().exec(),
        this.ledger.all(organizationId, session),
      ]);
      const report = stockLevelDrift(
        levels.map((l) => ({
          itemId: l.itemId,
          locationId: l.locationId,
          quantity: qty3(l.quantity.toString()),
        })),
        movements.map(engineMovement),
      );
      let rebuilt = 0;
      if (fix) {
        for (const d of report.drifts) {
          await this.levels.updateOne(
            { organizationId, itemId: d.itemId, locationId: d.locationId },
            {
              $set: {
                quantity: Types.Decimal128.fromString(qty3(d.ledger)),
                engineVersion: STOCK_VERSION,
              },
              $setOnInsert: { lastMovementAt: null, _schemaVersion: 1 },
            },
            { upsert: true, session },
          );
          rebuilt += 1;
        }
      }
      for (const d of report.drifts) {
        this.logger.warn(
          `STOCK_LEVEL_DRIFT org=${organizationId} item=${d.itemId} location=${d.locationId} ` +
            `cache=${d.cached} grand-livre=${d.ledger}${fix ? ' (rétabli)' : ''}`,
        );
      }
      return { version: report.version, ok: report.ok, drifts: report.drifts, rebuilt };
    });
  }

  /** Valeur par article et par devise à une date (rejeu) ; exige de voir les valeurs. */
  async valuation(
    organizationId: string,
    query: StockValuationQuery,
    actor: StockActor,
  ): Promise<StockValuationResponse> {
    if (!seesValues(actor)) requireAction(actor, 'purchase.read');
    if (query.locationId) await this.locations.requireOwn(organizationId, query.locationId);
    const ctx = await this.context(organizationId);
    const movements = await this.ledger.all(organizationId);
    const result = stockValuation({
      movements: movements.map(engineMovement),
      items: ctx.items.map(engineItem),
      until: query.on ?? null,
      locationId: query.locationId ?? null,
    });
    return {
      ...result,
      items: result.items.map((i) => ({ ...i, itemName: ctx.byId.get(i.itemId)?.name ?? '' })),
    };
  }

  async report(
    organizationId: string,
    query: StockReportsQuery,
    actor: StockActor,
  ): Promise<StockReportResponse> {
    const ctx = await this.context(organizationId);
    const movements = await this.ledger.all(organizationId);
    const r = stockReport(movements.map(engineMovement), ctx.items.map(engineItem), query);
    const v = seesValues(actor);
    const hide = (x: string): string | null => (v ? x : null);
    return {
      version: r.version,
      period: r.period,
      items: r.items.map((i) => ({
        itemId: i.itemId,
        itemName: ctx.byId.get(i.itemId)?.name ?? '',
        currency: i.currency,
        openingQuantity: i.openingQuantity,
        openingValue: hide(i.openingValue),
        entries: i.entries.map((e) => ({ ...e, value: hide(e.value) })),
        exits: i.exits.map((e) => ({ ...e, value: hide(e.value) })),
        transfersQuantity: i.transfersQuantity,
        closingQuantity: i.closingQuantity,
        closingValue: hide(i.closingValue),
        complete: i.complete,
      })),
      byCurrency: r.byCurrency.map((c) => ({
        currency: c.currency,
        openingValue: hide(c.openingValue),
        entriesValue: hide(c.entriesValue),
        exitsCost: hide(c.exitsCost),
        costOfSales: hide(c.costOfSales),
        consumption: hide(c.consumption),
        closingValue: hide(c.closingValue),
        complete: c.complete,
      })),
      byProject: r.byProject.map((p) => ({ ...p, consumedValue: hide(p.consumedValue) })),
      valuesHidden: !v,
    };
  }

  /** Organisations dont les stocks sont activés (tâche `stock.levels-check`). */
  async activeOrganizations(): Promise<string[]> {
    return (await this.connection
      .collection('stock_settings')
      .distinct('organizationId')) as string[];
  }
}
