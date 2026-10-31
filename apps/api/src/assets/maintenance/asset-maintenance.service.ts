// Maintenance et couvertures des équipements (ADR-0046 § 3.3, § 3.4). ADR-0046 — S5.
//
// - Une intervention préventive FAITE avec récurrence crée la suivante, planifiée à la
//   date du MOTEUR (`nextMaintenanceDate`, fin de mois bornée) ; rejouer « faite » ne
//   crée rien de plus (`nextId`).
// - Le coût saisi est INFORMATIF : aucune dépense n'est créée ; l'intervention se relie
//   à un fournisseur ou à une facture fournisseur de l'organisation (vérifiés, 404).
// - Un équipement `under_maintenance` le reste jusqu'à une intervention faite (il revient
//   alors en service s'il est affecté, en réserve sinon) ou un retour manuel.
// - Couvertures (garantie, assurance, contrat) : échéance jugée par le moteur
//   (`expiryStatus`) ; aucune règle d'assurance obligatoire.
// - Valeurs (coûts) masquées sans `purchase.read` ni `treasury.read`.

import { expiryStatus, nextMaintenanceDate } from '@lalanda/engine';
import type {
  AssetCoverageView,
  AssetListOf,
  AssetMaintenanceView,
  CompleteMaintenanceBody,
  CreateCoverageBody,
  CreateMaintenanceBody,
  UpdateCoverageBody,
  UpdateMaintenanceBody,
} from '@lalanda/shared/assets';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { conflict, staleRevision } from '../../sales/sales.errors.js';
import { isObjectIdHex } from '../../sales/search.js';
import {
  assetsToday,
  coverageNotFound,
  inAssetsTransaction,
  maintenanceNotFound,
} from '../assets-common.js';
import { AssetsLinks } from '../assets-links.js';
import {
  AssetCoverage,
  AssetMaintenance,
  type AssetCoverageDocument,
  type AssetCoverageLean,
  type AssetLean,
  type AssetMaintenanceDocument,
  type AssetMaintenanceLean,
} from '../assets.schemas.js';
import { AssetsService, type AssetReader } from '../registry/assets.service.js';
import { AssetSettingsService, type AssetActor } from '../settings/asset-settings.service.js';

function maintenanceView(m: AssetMaintenanceLean, reader: AssetReader): AssetMaintenanceView {
  return {
    id: String(m._id),
    assetId: m.assetId,
    kind: m.kind,
    status: m.status,
    plannedOn: m.plannedOn ?? null,
    doneOn: m.doneOn ?? null,
    cost: reader.visible ? (m.cost ?? null) : null,
    currency: m.currency ?? null,
    supplierId: m.supplierId ?? null,
    supplierInvoiceId: m.supplierInvoiceId ?? null,
    performedBy: m.performedBy ?? null,
    note: m.note ?? null,
    recurrence: m.recurrence ?? null,
    nextId: m.nextId ?? null,
    revision: m.revision,
    createdAt: new Date(m.createdAt).toISOString(),
    updatedAt: new Date(m.updatedAt).toISOString(),
  };
}

@Injectable()
export class AssetMaintenanceService {
  constructor(
    @InjectModel(AssetMaintenance.name)
    private readonly maintenance: Model<AssetMaintenanceDocument>,
    @InjectModel(AssetCoverage.name) private readonly coverages: Model<AssetCoverageDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AssetsService) private readonly assets: AssetsService,
    @Inject(AssetsLinks) private readonly links: AssetsLinks,
    @Inject(AssetSettingsService) private readonly settings: AssetSettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Maintenance ────────────────────────────────────────────────────────────

  async listMaintenance(
    organizationId: string,
    assetId: string,
    reader: AssetReader,
  ): Promise<AssetListOf<AssetMaintenanceView>> {
    await this.assets.requireOwn(organizationId, assetId);
    const rows = await this.maintenance
      .find({ organizationId, assetId })
      .sort({ plannedOn: -1, doneOn: -1, _id: -1 })
      .lean<AssetMaintenanceLean[]>()
      .exec();
    return { items: rows.map((m) => maintenanceView(m, reader)), valuesHidden: !reader.visible };
  }

  private async requireMaintenance(
    organizationId: string,
    assetId: string,
    maintenanceId: string,
  ): Promise<AssetMaintenanceLean> {
    if (!isObjectIdHex(maintenanceId)) maintenanceNotFound();
    const m = await this.maintenance
      .findOne({ _id: new Types.ObjectId(maintenanceId), organizationId, assetId })
      .lean<AssetMaintenanceLean>()
      .exec();
    if (!m) maintenanceNotFound();
    return m;
  }

  private async writableAsset(organizationId: string, assetId: string): Promise<AssetLean> {
    const asset = await this.assets.requireOwn(organizationId, assetId);
    if (asset.status === 'disposed') {
      conflict('ASSET_DISPOSED', 'Cet équipement est cédé : réouvrez-le avant de le modifier.');
    }
    return asset;
  }

  async createMaintenance(
    organizationId: string,
    assetId: string,
    body: CreateMaintenanceBody,
    actor: AssetActor,
    reader: AssetReader,
  ): Promise<AssetMaintenanceView> {
    await this.writableAsset(organizationId, assetId);
    const links = await this.links.supplierLinks(
      organizationId,
      body.supplierId ?? null,
      body.supplierInvoiceId ?? null,
    );
    const created = await this.maintenance.create({
      organizationId,
      assetId,
      kind: body.kind,
      status: body.status,
      plannedOn: body.plannedOn ?? null,
      doneOn: body.status === 'done' ? (body.doneOn ?? null) : null,
      cost: body.cost ?? null,
      currency: body.currency ?? null,
      ...links,
      performedBy: body.performedBy ?? null,
      note: body.note ?? null,
      recurrence: body.recurrence ?? null,
      nextId: null,
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'assets.maintenance.created',
      targetType: 'asset_maintenance',
      targetId: String(created._id),
      metadata: { assetId, kind: body.kind, status: body.status },
    });
    if (body.status === 'done' && body.recurrence && body.doneOn) {
      // Faite d'emblée avec récurrence : la suivante est planifiée comme pour `done`.
      await this.scheduleNext(
        organizationId,
        created.toObject() as AssetMaintenanceLean,
        body.doneOn,
        actor,
      );
    }
    return maintenanceView(
      await this.requireMaintenance(organizationId, assetId, String(created._id)),
      reader,
    );
  }

  async updateMaintenance(
    organizationId: string,
    assetId: string,
    maintenanceId: string,
    body: UpdateMaintenanceBody,
    actor: AssetActor,
    reader: AssetReader,
  ): Promise<AssetMaintenanceView> {
    await this.writableAsset(organizationId, assetId);
    const current = await this.requireMaintenance(organizationId, assetId, maintenanceId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    if (current.status !== 'planned') {
      conflict('ASSET_MAINTENANCE_CLOSED', 'Cette intervention est faite ou annulée.');
    }
    if (body.recurrence && current.kind !== 'preventive') {
      conflict('RECURRENCE_PREVENTIVE_ONLY', 'Seule une maintenance préventive se répète.');
    }
    const set: Record<string, unknown> = { updatedBy: actor.userId };
    for (const k of [
      'plannedOn',
      'status',
      'cost',
      'currency',
      'performedBy',
      'note',
      'recurrence',
    ] as const) {
      if (body[k] !== undefined) set[k] = body[k];
    }
    if (body.supplierId !== undefined || body.supplierInvoiceId !== undefined) {
      Object.assign(
        set,
        await this.links.supplierLinks(
          organizationId,
          body.supplierId !== undefined ? body.supplierId : current.supplierId,
          body.supplierInvoiceId !== undefined ? body.supplierInvoiceId : current.supplierInvoiceId,
        ),
      );
    }
    const res = await this.maintenance
      .updateOne(
        { _id: current._id, organizationId, revision: current.revision },
        { $set: set, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(current.revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'assets.maintenance.updated',
      targetType: 'asset_maintenance',
      targetId: maintenanceId,
      metadata: { assetId, status: (set['status'] as string | undefined) ?? current.status },
    });
    return maintenanceView(
      await this.requireMaintenance(organizationId, assetId, maintenanceId),
      reader,
    );
  }

  async completeMaintenance(
    organizationId: string,
    assetId: string,
    maintenanceId: string,
    body: CompleteMaintenanceBody,
    actor: AssetActor,
    reader: AssetReader,
  ): Promise<AssetMaintenanceView> {
    const asset = await this.writableAsset(organizationId, assetId);
    const current = await this.requireMaintenance(organizationId, assetId, maintenanceId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    if (current.status === 'cancelled') {
      conflict('ASSET_MAINTENANCE_CLOSED', 'Cette intervention est annulée.');
    }
    if (current.status === 'done') {
      // Rejeu : rien de plus (la suivante éventuelle existe déjà).
      return maintenanceView(current, reader);
    }
    const set: Record<string, unknown> = {
      status: 'done',
      doneOn: body.doneOn,
      updatedBy: actor.userId,
    };
    for (const k of ['cost', 'currency', 'performedBy', 'note'] as const) {
      if (body[k] !== undefined) set[k] = body[k];
    }
    await inAssetsTransaction(this.connection, async (session) => {
      const res = await this.maintenance
        .updateOne(
          { _id: current._id, organizationId, revision: current.revision, status: 'planned' },
          { $set: set, $inc: { revision: 1 } },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(current.revision);
      if (asset.status === 'under_maintenance') {
        await this.connection.collection('assets').updateOne(
          { _id: asset._id, organizationId, status: 'under_maintenance' },
          {
            $set: {
              status: asset.currentAssignment ? 'in_service' : 'in_storage',
              updatedBy: actor.userId,
              updatedAt: new Date(),
            },
            $inc: { revision: 1 },
          },
          { session },
        );
      }
      await this.audit.record(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'assets.maintenance.done',
          targetType: 'asset_maintenance',
          targetId: maintenanceId,
          metadata: { assetId, doneOn: body.doneOn },
        },
        { session },
      );
    });
    if (current.kind === 'preventive' && current.recurrence) {
      await this.scheduleNext(organizationId, current, body.doneOn, actor);
    }
    return maintenanceView(
      await this.requireMaintenance(organizationId, assetId, maintenanceId),
      reader,
    );
  }

  /** Planifie l'intervention suivante (moteur) ; idempotent par `nextId`. */
  private async scheduleNext(
    organizationId: string,
    done: AssetMaintenanceLean,
    doneOn: string,
    actor: AssetActor,
  ): Promise<string> {
    const plannedOn = nextMaintenanceDate(doneOn, done.recurrence!.everyMonths);
    const nextObjectId = new Types.ObjectId();
    // Réserver d'abord le lien : deux appels concurrents n'en créent qu'une.
    const claimed = await this.maintenance
      .updateOne(
        { _id: done._id, organizationId, nextId: null },
        { $set: { nextId: nextObjectId.toHexString() } },
      )
      .exec();
    if (claimed.modifiedCount !== 1) return String(done._id);
    await this.maintenance.create({
      _id: nextObjectId,
      organizationId,
      assetId: done.assetId,
      kind: 'preventive',
      status: 'planned',
      plannedOn,
      doneOn: null,
      cost: null,
      currency: null,
      supplierId: done.supplierId ?? null,
      supplierInvoiceId: null,
      performedBy: done.performedBy ?? null,
      note: null,
      recurrence: done.recurrence,
      nextId: null,
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    return nextObjectId.toHexString();
  }

  // ── Couvertures ────────────────────────────────────────────────────────────

  private async coverageView(
    organizationId: string,
    c: AssetCoverageLean,
    reader: AssetReader,
    defaultReminder?: number,
  ): Promise<AssetCoverageView> {
    const reminder =
      c.reminderDays ??
      defaultReminder ??
      (await this.settings.effective(organizationId)).reminderDays;
    return {
      id: String(c._id),
      assetId: c.assetId,
      kind: c.kind,
      provider: c.provider,
      reference: c.reference ?? null,
      startOn: c.startOn,
      endOn: c.endOn,
      cost: reader.visible ? (c.cost ?? null) : null,
      currency: c.currency ?? null,
      documentId: c.documentId ?? null,
      reminderDays: c.reminderDays ?? null,
      expiry: expiryStatus(c.endOn, reminder, assetsToday()),
      revision: c.revision,
      createdAt: new Date(c.createdAt).toISOString(),
      updatedAt: new Date(c.updatedAt).toISOString(),
    };
  }

  private async requireCoverage(
    organizationId: string,
    assetId: string,
    coverageId: string,
  ): Promise<AssetCoverageLean> {
    if (!isObjectIdHex(coverageId)) coverageNotFound();
    const c = await this.coverages
      .findOne({ _id: new Types.ObjectId(coverageId), organizationId, assetId })
      .lean<AssetCoverageLean>()
      .exec();
    if (!c) coverageNotFound();
    return c;
  }

  async listCoverages(
    organizationId: string,
    assetId: string,
    reader: AssetReader,
  ): Promise<AssetListOf<AssetCoverageView>> {
    await this.assets.requireOwn(organizationId, assetId);
    const [rows, settings] = await Promise.all([
      this.coverages
        .find({ organizationId, assetId })
        .sort({ endOn: -1 })
        .lean<AssetCoverageLean[]>()
        .exec(),
      this.settings.effective(organizationId),
    ]);
    const items: AssetCoverageView[] = [];
    for (const c of rows)
      items.push(await this.coverageView(organizationId, c, reader, settings.reminderDays));
    return { items, valuesHidden: !reader.visible };
  }

  async createCoverage(
    organizationId: string,
    assetId: string,
    body: CreateCoverageBody,
    actor: AssetActor,
    reader: AssetReader,
  ): Promise<AssetCoverageView> {
    await this.writableAsset(organizationId, assetId);
    if (body.documentId) await this.links.assertDocument(organizationId, body.documentId);
    const created = await this.coverages.create({
      organizationId,
      assetId,
      kind: body.kind,
      provider: body.provider,
      reference: body.reference ?? null,
      startOn: body.startOn,
      endOn: body.endOn,
      cost: body.cost ?? null,
      currency: body.currency ?? null,
      documentId: body.documentId ?? null,
      reminderDays: body.reminderDays ?? null,
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'assets.coverage.created',
      targetType: 'asset_coverage',
      targetId: String(created._id),
      metadata: { assetId, kind: body.kind },
    });
    return this.coverageView(organizationId, created.toObject() as AssetCoverageLean, reader);
  }

  async updateCoverage(
    organizationId: string,
    assetId: string,
    coverageId: string,
    body: UpdateCoverageBody,
    actor: AssetActor,
    reader: AssetReader,
  ): Promise<AssetCoverageView> {
    await this.writableAsset(organizationId, assetId);
    const current = await this.requireCoverage(organizationId, assetId, coverageId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const startOn = body.startOn ?? current.startOn;
    const endOn = body.endOn ?? current.endOn;
    if (endOn < startOn) conflict('END_BEFORE_START', 'La fin précède le début.');
    if (body.documentId) await this.links.assertDocument(organizationId, body.documentId);
    const set: Record<string, unknown> = { updatedBy: actor.userId, startOn, endOn };
    for (const k of [
      'provider',
      'reference',
      'cost',
      'currency',
      'documentId',
      'reminderDays',
    ] as const) {
      if (body[k] !== undefined) set[k] = body[k];
    }
    const res = await this.coverages
      .updateOne(
        { _id: current._id, organizationId, revision: current.revision },
        { $set: set, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(current.revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'assets.coverage.updated',
      targetType: 'asset_coverage',
      targetId: coverageId,
      metadata: { assetId },
    });
    return this.coverageView(
      organizationId,
      await this.requireCoverage(organizationId, assetId, coverageId),
      reader,
    );
  }

  async removeCoverage(
    organizationId: string,
    assetId: string,
    coverageId: string,
    actor: AssetActor,
  ): Promise<{ deleted: true }> {
    await this.writableAsset(organizationId, assetId);
    const current = await this.requireCoverage(organizationId, assetId, coverageId);
    await this.coverages.deleteOne({ _id: current._id, organizationId }).exec();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'assets.coverage.deleted',
      targetType: 'asset_coverage',
      targetId: coverageId,
      metadata: { assetId, kind: current.kind, endOn: current.endOn },
    });
    return { deleted: true };
  }
}
