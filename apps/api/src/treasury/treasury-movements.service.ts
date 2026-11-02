// Virements internes et mouvements hors dépenses et hors ventes — ADR-0034 § 4.
//
// Un virement entre deux comptes de MÊME devise ne change pas le total : montant
// sorti = montant entré. Entre deux devises, l'utilisateur saisit les deux montants
// constatés ; aucun taux ni écart de change n'est calculé (décision ouverte n° 3).
//
// ADR-0051 — H11 (§ 7.1) : un mouvement peut être POSSÉDÉ par les RH (versement
// d'une avance au personnel, retour du reliquat en espèces). Seul
// `recordOwnedByAdvance` l'écrit, dans la transaction du service RH ; la trésorerie
// ne l'annule pas (`409 MOVEMENT_OWNED_BY_HR`). Une avance n'est pas une charge :
// aucune dépense, rien au réalisé.

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { treasuryCentsOf, type TreasuryCurrency } from '@lalanda/engine';
import type { ClientSession, Model, Types } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { TreasuryAccountsService, type LedgerEntry } from './treasury-accounts.service.js';
import {
  conflict,
  isMongoId,
  noFutureDate,
  notFound,
  rejected,
  type TreasuryActor,
} from './treasury.common.js';
import type { OtherMovementInput, TransferInput } from './treasury.dto.js';
import {
  TreasuryMovement,
  type MovementOrigin,
  type TreasuryMovementDocument,
} from './treasury.schemas.js';

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
  /** ADR-0051 — H11 : `null` = saisi en trésorerie ; sinon possédé par les RH. */
  origin: MovementOrigin | null;
  status: 'recorded' | 'cancelled';
  cancelReason: string | null;
}

/**
 * ADR-0051 — H11 (§ 3.2, § 3.3) : versement d'une avance (`other_out`, sans
 * `settlementId`) ou retour du reliquat en espèces (`other_in`, régularisation
 * `cash_return`). Le libellé est NEUTRE, posé par la trésorerie : numéro de
 * l'avance seul, jamais le nom ni la nature (« sur salaire »).
 */
export interface HrAdvanceMovementInput {
  organizationId: string;
  kind: 'other_out' | 'other_in';
  advanceId: string;
  advanceNumber: string;
  settlementId: string | null;
  accountId: string;
  currency: TreasuryCurrency;
  date: string;
  amount: string;
  reference: string | null;
  actor: TreasuryActor;
}

export type MovementLean = TreasuryMovement & { _id: Types.ObjectId };

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
    origin: d.origin ?? null,
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
    assertMovementNotOwned(current);
    if (current.status === 'cancelled') return view(current);
    const updated = await this.movements
      .findOneAndUpdate(
        { _id: current._id, organizationId, status: 'recorded', origin: null },
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

  // ─── ADR-0051 — H11 : mouvements possédés par les RH (§ 7.1) ──────────────

  /**
   * Versement d'une avance (`other_out`) ou retour du reliquat (`other_in`), dans la
   * transaction du service RH, avec les règles de la trésorerie (compte de
   * l'organisation, actif, de la devise de l'avance, ouvert à la date ; jamais futur).
   */
  async recordOwnedByAdvance(
    session: ClientSession,
    input: HrAdvanceMovementInput,
  ): Promise<MovementView> {
    const { organizationId, actor } = input;
    const incoming = input.kind === 'other_in';
    if (incoming !== (input.settlementId !== null)) {
      rejected(
        'ADVANCE_MOVEMENT_INVALID',
        'Un versement d’avance n’a pas de régularisation ; un retour en espèces en a une.',
      );
    }
    const cents = treasuryCentsOf(input.amount);
    if (cents === null || cents <= 0n) {
      rejected('ADVANCE_MOVEMENT_INVALID', 'Le montant d’une avance est strictement positif.');
    }
    noFutureDate(input.date, 'MOVEMENT_IN_FUTURE', 'Un mouvement');
    await this.accounts.requireUsable(organizationId, input.accountId, {
      currency: input.currency,
      date: input.date,
    });
    const origin: MovementOrigin = {
      kind: 'employee_advance',
      advanceId: input.advanceId,
      advanceNumber: input.advanceNumber,
      settlementId: input.settlementId,
    };
    const [doc] = await this.movements.create(
      [
        {
          organizationId,
          kind: input.kind,
          date: input.date,
          label: incoming
            ? `Retour d’avance au personnel ${input.advanceNumber}`
            : `Avance au personnel ${input.advanceNumber}`,
          fromAccountId: incoming ? null : input.accountId,
          toAccountId: incoming ? input.accountId : null,
          amountOut: incoming ? null : input.amount,
          amountIn: incoming ? input.amount : null,
          reference: input.reference,
          origin,
          status: 'recorded',
          cancelReason: null,
          createdBy: actor.userId,
          updatedBy: actor.userId,
          _schemaVersion: 1,
        },
      ],
      { session },
    );
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'treasury.movement.recorded',
        targetType: 'treasury_movement',
        targetId: String(doc!._id),
        metadata: { kind: input.kind, advanceId: input.advanceId },
      },
      { session },
    );
    return view(doc!.toObject() as MovementLean);
  }

  /**
   * Annulation par les RH d'un versement ou d'un retour : les mouvements
   * ENREGISTRÉS de l'avance sont annulés (ils gardent `origin`). `settlementId` :
   * `undefined` = tous, `null` = le seul versement, un identifiant = ce seul retour.
   * Rend le nombre de mouvements annulés.
   */
  async cancelOwnedByAdvance(
    session: ClientSession,
    organizationId: string,
    advanceId: string,
    scope: { settlementId?: string | null },
    reason: string,
    actor: TreasuryActor,
  ): Promise<number> {
    const filter: Record<string, unknown> = {
      organizationId,
      'origin.kind': 'employee_advance',
      'origin.advanceId': advanceId,
      status: 'recorded',
    };
    if (scope.settlementId !== undefined) filter['origin.settlementId'] = scope.settlementId;
    const res = await this.movements
      .updateMany(
        filter,
        { $set: { status: 'cancelled', cancelReason: reason, updatedBy: actor.userId } },
        { session },
      )
      .exec();
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'treasury.movement.released_by_advance',
        targetType: 'hr_advance',
        targetId: advanceId,
        metadata: { cancelled: res.modifiedCount, reason: reason.slice(0, 200) },
      },
      { session },
    );
    return res.modifiedCount;
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

/** ADR-0051 — H11 : un mouvement possédé par les RH ne s'annule que depuis les RH. */
function assertMovementNotOwned(doc: Pick<MovementLean, 'origin'>): void {
  if (!doc.origin) return;
  conflict(
    'MOVEMENT_OWNED_BY_HR',
    `Ce mouvement est l’avance au personnel ${doc.origin.advanceNumber} : annulez-le depuis les ressources humaines.`,
    { advanceId: doc.origin.advanceId, advanceNumber: doc.origin.advanceNumber },
  );
}

function movementNotFound(): never {
  notFound('TREASURY_MOVEMENT_NOT_FOUND', 'Mouvement introuvable.');
}
