// Réglages des stocks et activation (ADR-0046 § 2.2, § 2.8). ADR-0046 — S3.
//
// L'activation est PARESSEUSE : le premier accès d'une organisation au module crée son
// emplacement par défaut (« Magasin principal ») puis ses réglages. Deux premiers accès
// simultanés butent sur les index uniques (`isDefault`, `organizationId`) : le perdant
// relit ce que le gagnant a écrit. Numérotation des bons et inventaires : compteurs
// annuels au jour de Kinshasa, trous admis, hors série fiscale (motif de R3).

import {
  STOCK_DEFAULT_ADJUSTMENT_REASONS,
  STOCK_DEFAULT_LOCATION_NAME,
  STOCK_SETTINGS_DEFAULTS,
  type StockSettingsView,
  type UpdateStockSettingsBody,
} from '@lalanda/shared/stock';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { fiscalYearOf, periodInYear } from '../sales/invoices/invoice-numbering.js';
import { isDuplicateKey, staleRevision } from '../sales/sales.errors.js';
import { normalizeKey, type StockActor } from './stock.common.js';
import {
  StockCounter,
  StockLocation,
  StockSettings,
  type StockCounterKind,
  type StockLocationLean,
  type StockSettingsLean,
} from './stock.schemas.js';

@Injectable()
export class StockSettingsService {
  constructor(
    @InjectModel(StockSettings.name) private readonly settings: Model<StockSettingsLean>,
    @InjectModel(StockLocation.name) private readonly locations: Model<StockLocationLean>,
    @InjectModel(StockCounter.name)
    private readonly counters: Model<{
      organizationId: string;
      kind: string;
      year: number;
      last: number;
    }>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Réglages de l'organisation, créés (avec l'emplacement par défaut) au premier accès. */
  async ensure(organizationId: string, actorUserId = 'system'): Promise<StockSettingsLean> {
    const found = await this.settings.findOne({ organizationId }).lean<StockSettingsLean>().exec();
    if (found) return found;
    const location = await this.ensureDefaultLocation(organizationId, actorUserId);
    try {
      await this.settings.create({
        organizationId,
        ...STOCK_SETTINGS_DEFAULTS,
        adjustmentReasons: STOCK_DEFAULT_ADJUSTMENT_REASONS.map((r) => ({ ...r })),
        defaultCostCurrency: 'CDF',
        dormantDays: null,
        defaultLocationId: String(location._id),
        revision: 1,
        createdBy: actorUserId,
        updatedBy: actorUserId,
        _schemaVersion: 1,
      });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }
    return (await this.settings.findOne({ organizationId }).lean<StockSettingsLean>().exec())!;
  }

  private async ensureDefaultLocation(
    organizationId: string,
    actorUserId: string,
  ): Promise<StockLocationLean> {
    const existing = await this.locations
      .findOne({ organizationId, isDefault: true })
      .lean<StockLocationLean>()
      .exec();
    if (existing) return existing;
    try {
      await this.locations.create({
        organizationId,
        name: STOCK_DEFAULT_LOCATION_NAME,
        nameKey: normalizeKey(STOCK_DEFAULT_LOCATION_NAME),
        kind: 'warehouse',
        workProjectId: null,
        address: null,
        responsibleUserId: null,
        isDefault: true,
        pointOfSaleIds: [],
        active: true,
        revision: 1,
        createdBy: actorUserId,
        updatedBy: actorUserId,
        _schemaVersion: 1,
      });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }
    return (await this.locations
      .findOne({ organizationId, isDefault: true })
      .lean<StockLocationLean>()
      .exec())!;
  }

  async view(organizationId: string): Promise<StockSettingsView> {
    return viewOf(await this.ensure(organizationId));
  }

  async update(
    organizationId: string,
    body: UpdateStockSettingsBody,
    actor: StockActor,
  ): Promise<StockSettingsView> {
    const current = await this.ensure(organizationId, actor.userId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const { expectedRevision, ...patch } = body;
    const set: Record<string, unknown> = { updatedBy: actor.userId };
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) set[k] = v;
    const updated = await this.settings
      .findOneAndUpdate(
        { organizationId, revision: expectedRevision },
        { $set: set, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<StockSettingsLean>()
      .exec();
    if (!updated) staleRevision((await this.ensure(organizationId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'stock.settings_changed',
      targetType: 'stock_settings',
      targetId: organizationId,
      metadata: { fields: Object.keys(set).filter((k) => k !== 'updatedBy') },
    });
    return viewOf(updated);
  }

  /** Numéro suivant (`BS2610-000001`…), dans la transaction de l'appelant. */
  async nextNumber(
    organizationId: string,
    kind: StockCounterKind,
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
        .lean<{ last: number }>()
        .exec();
    let counter: { last: number } | null;
    try {
      counter = await bump();
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      counter = await bump();
    }
    const period = periodInYear(year, now);
    const yy = String(period.year % 100).padStart(2, '0');
    const mm = String(period.month).padStart(2, '0');
    return `${kind}${yy}${mm}-${String(counter!.last).padStart(6, '0')}`;
  }
}

function viewOf(d: StockSettingsLean): StockSettingsView {
  return {
    salesIssueMode: d.salesIssueMode,
    allowNegativeManualMoves: d.allowNegativeManualMoves,
    adjustmentReasons: d.adjustmentReasons.map((r) => ({ key: r.key, label: r.label })),
    countReminderDays: d.countReminderDays,
    alertRecipients: d.alertRecipients,
    defaultCostCurrency: d.defaultCostCurrency,
    dormantDays: d.dormantDays ?? null,
    defaultLocationId: d.defaultLocationId,
    revision: d.revision,
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}
