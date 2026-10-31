// Grand livre des stocks : SEUL écrivain de `stock_movements` et de `stock_levels`
// (ADR-0046 § 2.3, § 2.5, O4). ADR-0046 — S3.
//
// ── Point d'extension du lot S4 ─────────────────────────────────────────────
// Les branchements achats et ventes (réceptions, factures émises, avoirs) appellent
// `record()` avec `mode: 'observed'` (jamais refusé, alerte de stock négatif) et des
// `sourceKey` d'idempotence (`stockSourceKey.receptionIn(…)`, `…invoice(…)`) : rejouer
// un rattrapage ne réécrit rien. Les lignes qu'ils ne savent pas traiter passent par
// `StockPendingService.open()`.
//
// ── Concurrence ─────────────────────────────────────────────────────────────
// Chaque écriture tient dans UNE transaction : contrôle du disponible (moteur
// `checkStockAvailability`, sur le grand livre lu dans l'instantané de la transaction),
// insertion des mouvements, `$inc` des niveaux. Deux transactions qui touchent le même
// niveau (article × emplacement) entrent en `WriteConflict` : la seconde est rejouée par
// `withTransaction` et relit le grand livre à jour — le niveau ne peut pas être faux, et
// deux sorties concurrentes ne peuvent pas franchir ensemble le disponible.

import {
  checkStockAvailability,
  STOCK_VERSION,
  type StockAvailabilityCheck,
  type StockShortfall,
} from '@lalanda/engine';
import type { StockCostStatus, StockMovementKind } from '@lalanda/shared/stock';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { isDuplicateKey, staleRevision } from '../sales/sales.errors.js';
import {
  conflict,
  engineMovement,
  isEntry,
  isOid,
  notFound,
  qty3,
  type StockActor,
} from './stock.common.js';
import {
  StockLevel,
  StockMovement,
  StockPendingLine,
  type StockLevelLean,
  type StockMovementLean,
  type StockMovementSource,
  type StockPendingLineLean,
} from './stock.schemas.js';

/** Mouvement à écrire ; `quantity` signée (entrées > 0, sorties < 0). */
export interface StockMovementDraft {
  itemId: string;
  locationId: string;
  kind: StockMovementKind;
  quantity: string;
  occurredOn: string;
  unitCost: string | null;
  costStatus: StockCostStatus;
  source: StockMovementSource;
  sourceKey: string;
  workProjectId?: string | null;
  transferId?: string | null;
  reason?: { key: string; note: string | null } | null;
  reversalOf?: string | null;
}

export interface RecordOptions {
  /**
   * `decided` : mouvement décidé dans le module (bon, annulation) — refusé au-delà du
   * disponible (`409 STOCK_INSUFFICIENT`) sauf `allowNegative`. `observed` : constaté
   * ailleurs (vente émise, annulation de réception, inventaire validé) — toujours écrit.
   */
  mode: 'decided' | 'observed';
  allowNegative?: boolean;
  actorUserId: string;
  session: ClientSession;
}

export interface RecordResult {
  written: StockMovementLean[];
  /** Clés déjà présentes : rien n'est réécrit (idempotence). */
  skipped: string[];
  /** Manques constatés (moteur), y compris quand le négatif est permis ou constaté. */
  shortfalls: StockShortfall[];
  goesNegative: boolean;
}

@Injectable()
export class StockMovementsService {
  constructor(
    @InjectModel(StockMovement.name) private readonly movements: Model<StockMovementLean>,
    @InjectModel(StockLevel.name) private readonly levels: Model<StockLevelLean>,
    @InjectModel(StockPendingLine.name) private readonly pending: Model<StockPendingLineLean>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Crée, HORS transaction, les niveaux manquants (quantité 0) : dans la transaction,
   * l'incrément ne fait alors jamais d'insertion concurrente sur l'index unique.
   */
  async ensureLevels(
    organizationId: string,
    pairs: readonly { itemId: string; locationId: string }[],
  ): Promise<void> {
    const seen = new Set<string>();
    for (const p of pairs) {
      const key = `${p.itemId}:${p.locationId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        await this.levels.updateOne(
          { organizationId, itemId: p.itemId, locationId: p.locationId },
          {
            $setOnInsert: {
              quantity: Types.Decimal128.fromString('0.000'),
              lastMovementAt: null,
              engineVersion: STOCK_VERSION,
              _schemaVersion: 1,
            },
          },
          { upsert: true },
        );
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
      }
    }
  }

  /** Écrit des mouvements dans la transaction de l'appelant (voir l'en-tête). */
  async record(
    organizationId: string,
    drafts: readonly StockMovementDraft[],
    opts: RecordOptions,
  ): Promise<RecordResult> {
    const { session } = opts;
    const keys = drafts.map((d) => d.sourceKey);
    const existing = await this.movements
      .find({ organizationId, sourceKey: { $in: keys } }, { sourceKey: 1 }, { session })
      .lean<{ sourceKey: string }[]>()
      .exec();
    const done = new Set(existing.map((e) => e.sourceKey));
    const todo = drafts.filter((d) => !done.has(d.sourceKey));

    // Disponible : le moteur juge les sorties sur le grand livre (instantané de la transaction).
    const exits = todo.filter((d) => !isEntry(d.quantity));
    let check: StockAvailabilityCheck | null = null;
    if (exits.length > 0) {
      const itemIds = [...new Set(exits.map((d) => d.itemId))];
      const locationIds = [...new Set(exits.map((d) => d.locationId))];
      const ledger = await this.movements
        .find(
          { organizationId, itemId: { $in: itemIds }, locationId: { $in: locationIds } },
          null,
          { session },
        )
        .lean<StockMovementLean[]>()
        .exec();
      check = checkStockAvailability({
        movements: ledger.map(engineMovement),
        lines: exits.map((d) => ({
          itemId: d.itemId,
          locationId: d.locationId,
          quantity: qty3(d.quantity).slice(1),
        })),
        allowNegativeManualMoves: opts.mode === 'observed' || opts.allowNegative === true,
      });
      if (!check.ok) {
        conflict('STOCK_INSUFFICIENT', 'Stock insuffisant à l’emplacement pour cette sortie.', {
          shortfalls: check.shortfalls,
        });
      }
    }

    const now = new Date();
    const written = (await this.movements.insertMany(
      todo.map((d) => ({
        organizationId,
        itemId: d.itemId,
        locationId: d.locationId,
        kind: d.kind,
        quantity: qty3(d.quantity),
        occurredOn: d.occurredOn,
        unitCost: d.unitCost,
        costStatus: d.costStatus,
        source: d.source,
        sourceKey: d.sourceKey,
        workProjectId: d.workProjectId ?? null,
        transferId: d.transferId ?? null,
        reason: d.reason ?? null,
        reversalOf: d.reversalOf ?? null,
        revision: 1,
        createdBy: opts.actorUserId,
        updatedBy: opts.actorUserId,
        _schemaVersion: 1,
      })),
      { session, ordered: true, lean: false },
    )) as unknown as { toObject: () => StockMovementLean }[];

    for (const d of todo) {
      await this.levels.updateOne(
        { organizationId, itemId: d.itemId, locationId: d.locationId },
        {
          $inc: { quantity: Types.Decimal128.fromString(qty3(d.quantity)) },
          $set: { lastMovementAt: now, engineVersion: STOCK_VERSION },
          $setOnInsert: { _schemaVersion: 1 },
        },
        { upsert: true, session },
      );
    }
    return {
      written: written.map((w) => w.toObject()),
      skipped: [...done],
      shortfalls: check?.shortfalls ?? [],
      goesNegative: check !== null && check.shortfalls.length > 0,
    };
  }

  // ── Lecture du grand livre ─────────────────────────────────────────────────

  /** Mouvements des articles donnés (tous emplacements), pour le moteur. */
  async ofItems(
    organizationId: string,
    itemIds: readonly string[],
    session?: ClientSession,
  ): Promise<StockMovementLean[]> {
    if (itemIds.length === 0) return [];
    return this.movements
      .find({ organizationId, itemId: { $in: [...itemIds] } }, null, session ? { session } : {})
      .sort({ occurredOn: 1, _id: 1 })
      .lean<StockMovementLean[]>()
      .exec();
  }

  async all(organizationId: string, session?: ClientSession): Promise<StockMovementLean[]> {
    return this.movements
      .find({ organizationId }, null, session ? { session } : {})
      .sort({ occurredOn: 1, _id: 1 })
      .lean<StockMovementLean[]>()
      .exec();
  }

  async ofVoucher(
    organizationId: string,
    voucherId: string,
    session?: ClientSession,
  ): Promise<StockMovementLean[]> {
    return this.movements
      .find({ organizationId, 'source.voucherId': voucherId }, null, session ? { session } : {})
      .sort({ _id: 1 })
      .lean<StockMovementLean[]>()
      .exec();
  }

  async hasMovements(organizationId: string, itemId: string, filter: Record<string, unknown> = {}) {
    return (await this.movements.exists({ organizationId, itemId, ...filter }).exec()) !== null;
  }

  async findOwn(organizationId: string, movementId: string): Promise<StockMovementLean> {
    if (!isOid(movementId)) movementNotFound();
    const doc = await this.movements
      .findOne({ _id: new Types.ObjectId(movementId), organizationId })
      .lean<StockMovementLean>()
      .exec();
    if (!doc) movementNotFound();
    return doc;
  }

  // ── Correction du coût d'une entrée (§ 2.3.1) ──────────────────────────────

  /**
   * Seule correction permise d'un mouvement : le coût unitaire d'une ENTRÉE valorisée
   * ou en attente de coût, dans la devise de l'article (aucun taux). Audit STRICT dans
   * la transaction ; les lignes « À traiter » de coût qui visent ce mouvement se ferment.
   */
  async correctCost(
    organizationId: string,
    movementId: string,
    input: { unitCost: string; reason: string; expectedRevision: number },
    actor: StockActor,
    session: ClientSession,
  ): Promise<StockMovementLean> {
    const current = await this.movements
      .findOne({ _id: new Types.ObjectId(movementId), organizationId }, null, { session })
      .lean<StockMovementLean>()
      .exec();
    if (!current) movementNotFound();
    if (!isEntry(current.quantity) || current.costStatus === 'not_applicable') {
      conflict(
        'STOCK_MOVEMENT_COST_NOT_EDITABLE',
        'Seul le coût d’une entrée valorisée ou en attente de coût se corrige.',
      );
    }
    if (current.revision !== input.expectedRevision) staleRevision(current.revision);
    const updated = await this.movements
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: input.expectedRevision },
        {
          $set: { unitCost: input.unitCost, costStatus: 'valued', updatedBy: actor.userId },
          $inc: { revision: 1 },
        },
        { new: true, session },
      )
      .lean<StockMovementLean>()
      .exec();
    if (!updated) staleRevision(current.revision);
    await this.audit.recordStrict(
      {
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'stock.entry_cost_changed',
        targetType: 'stock_movement',
        targetId: movementId,
        metadata: {
          itemId: current.itemId,
          before: { unitCost: current.unitCost, costStatus: current.costStatus },
          after: { unitCost: input.unitCost, costStatus: 'valued' },
          reason: input.reason,
        },
      },
      { session },
    );
    await this.pending.updateMany(
      {
        organizationId,
        status: 'open',
        reason: { $in: ['pending_cost', 'cost_differs'] },
        'proposal.movementId': movementId,
      },
      {
        $set: {
          status: 'resolved',
          movementId,
          closure: { at: new Date(), by: actor.userId, note: input.reason },
          updatedBy: actor.userId,
        },
        $inc: { revision: 1 },
      },
      { session },
    );
    return updated;
  }
}

function movementNotFound(): never {
  notFound('STOCK_MOVEMENT_NOT_FOUND', 'Mouvement introuvable.');
}
