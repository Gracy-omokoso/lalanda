// Virements internes et mouvements hors dépenses et hors ventes — ADR-0034 § 4.
//
// Un virement entre deux comptes de MÊME devise ne change pas le total : montant
// sorti = montant entré. Entre deux devises, l'utilisateur saisit les deux montants
// constatés ; aucun taux ni écart de change n'est calculé (décision ouverte n° 3).

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { TreasuryCurrency } from '@lalanda/engine';
import type { Model, Types } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { TreasuryAccountsService, type LedgerEntry } from './treasury-accounts.service.js';
import {
  isMongoId,
  noFutureDate,
  notFound,
  rejected,
  type TreasuryActor,
} from './treasury.common.js';
import type { OtherMovementInput, TransferInput } from './treasury.dto.js';
import { TreasuryMovement, type TreasuryMovementDocument } from './treasury.schemas.js';

export interface MovementView {
  id: string;
  kind: TreasuryMovement['kind'];
  date: string;
  label: string;
  fromAccountId: string | null;
  toAccountId: string | null;
  amountOut: string | null;
  amountIn: string | null;
  reference: string | null;
  status: 'recorded' | 'cancelled';
  cancelReason: string | null;
}

type MovementLean = TreasuryMovement & { _id: Types.ObjectId };

const MAX_LEDGER_ENTRIES = 500;

function view(d: MovementLean): MovementView {
  return {
    id: String(d._id),
    kind: d.kind,
    date: d.date,
    label: d.label,
    fromAccountId: d.fromAccountId ?? null,
    toAccountId: d.toAccountId ?? null,
    amountOut: d.amountOut ?? null,
    amountIn: d.amountIn ?? null,
    reference: d.reference ?? null,
    status: d.status,
    cancelReason: d.cancelReason ?? null,
  };
}

@Injectable()
export class TreasuryMovementsService {
  constructor(
    @InjectModel(TreasuryMovement.name) private readonly movements: Model<TreasuryMovementDocument>,
    @Inject(TreasuryAccountsService) private readonly accounts: TreasuryAccountsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Grand livre unifié (dépenses, virements, autres mouvements, encaissements). */
  async ledger(
    organizationId: string,
    filter: { accountId?: string; from?: string; to?: string },
  ): Promise<{ items: LedgerEntry[]; truncated: boolean }> {
    if (filter.accountId !== undefined)
      await this.accounts.requireOwn(organizationId, filter.accountId);
    const { entries } = await this.accounts.ledger(organizationId);
    const items = entries.filter(
      (e) =>
        (filter.accountId === undefined || e.accountId === filter.accountId) &&
        (filter.from === undefined || e.date >= filter.from) &&
        (filter.to === undefined || e.date <= filter.to),
    );
    return {
      items: items.slice(0, MAX_LEDGER_ENTRIES),
      truncated: items.length > MAX_LEDGER_ENTRIES,
    };
  }

  async transfer(
    organizationId: string,
    input: TransferInput,
    actor: TreasuryActor,
  ): Promise<MovementView> {
    noFutureDate(input.date, 'MOVEMENT_IN_FUTURE', 'Un virement');
    const from = await this.accounts.requireUsable(organizationId, input.fromAccountId, {
      date: input.date,
    });
    const to = await this.accounts.requireUsable(organizationId, input.toAccountId, {
      date: input.date,
    });
    if (from.currency === to.currency && !sameAmount(input.amountOut, input.amountIn)) {
      rejected(
        'TRANSFER_AMOUNTS_DIFFER',
        'Entre deux comptes de même devise, le montant sorti égale le montant entré.',
      );
    }
    const label = input.label ?? `Virement ${from.name} → ${to.name}`;
    const doc = await this.movements.create({
      organizationId,
      kind: 'transfer',
      date: input.date,
      label,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amountOut: input.amountOut,
      amountIn: input.amountIn,
      reference: input.reference,
      status: 'recorded',
      cancelReason: null,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    await this.record(organizationId, actor, 'treasury.transfer.recorded', String(doc._id), {
      fromCurrency: from.currency,
      toCurrency: to.currency,
    });
    return view(doc.toObject() as MovementLean);
  }

  async other(
    organizationId: string,
    input: OtherMovementInput,
    actor: TreasuryActor,
  ): Promise<MovementView> {
    noFutureDate(input.date, 'MOVEMENT_IN_FUTURE', 'Un mouvement');
    await this.accounts.requireUsable(organizationId, input.accountId, { date: input.date });
    const incoming = input.kind === 'other_in';
    const doc = await this.movements.create({
      organizationId,
      kind: input.kind,
      date: input.date,
      label: input.label,
      fromAccountId: incoming ? null : input.accountId,
      toAccountId: incoming ? input.accountId : null,
      amountOut: incoming ? null : input.amount,
      amountIn: incoming ? input.amount : null,
      reference: input.reference,
      status: 'recorded',
      cancelReason: null,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    await this.record(organizationId, actor, 'treasury.movement.recorded', String(doc._id), {
      kind: input.kind,
    });
    return view(doc.toObject() as MovementLean);
  }

  async cancel(
    organizationId: string,
    movementId: string,
    reason: string,
    actor: TreasuryActor,
  ): Promise<MovementView> {
    if (!isMongoId(movementId)) movementNotFound();
    const current = await this.movements
      .findOne({ _id: movementId, organizationId })
      .lean<MovementLean>()
      .exec();
    if (!current) movementNotFound();
    if (current.status === 'cancelled') return view(current);
    const updated = await this.movements
      .findOneAndUpdate(
        { _id: current._id, organizationId, status: 'recorded' },
        { $set: { status: 'cancelled', cancelReason: reason, updatedBy: actor.userId } },
        { new: true },
      )
      .lean<MovementLean>()
      .exec();
    await this.record(organizationId, actor, 'treasury.movement.cancelled', movementId, {
      kind: current.kind,
    });
    return view(updated ?? current);
  }

  private async record(
    organizationId: string,
    actor: TreasuryActor,
    action: string,
    targetId: string,
    metadata: Record<string, string | TreasuryCurrency>,
  ): Promise<void> {
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action,
      targetType: 'treasury_movement',
      targetId,
      metadata,
    });
  }
}

/** « 10 » et « 10.00 » désignent le même montant. */
function sameAmount(a: string, b: string): boolean {
  const norm = (v: string): string => {
    const [i = '0', f = ''] = v.split('.');
    return `${BigInt(i)}.${f.padEnd(2, '0')}`;
  };
  return norm(a) === norm(b);
}

function movementNotFound(): never {
  notFound('TREASURY_MOVEMENT_NOT_FOUND', 'Mouvement introuvable.');
}
