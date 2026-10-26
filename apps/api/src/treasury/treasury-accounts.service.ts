// Comptes de trésorerie et grand livre des mouvements — ADR-0034 § 4.
//
// Le solde n'est JAMAIS stocké : il est recalculé par le moteur
// (`computeAccountBalances`) à partir du solde d'ouverture et de tous les
// mouvements — dépenses rattachées, virements, autres entrées et sorties,
// encaissements (port ADR-0031). Un solde stocké finirait par diverger.

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  computeAccountBalances,
  type AccountBalance,
  type TreasuryAccountInput,
  type TreasuryCurrency,
  type TreasuryMovementInput,
} from '@lalanda/engine';
import type { Model, Types } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { staleRevision } from '../sales/sales.errors.js';
import {
  isMongoId,
  notFound,
  rejected,
  todayKinshasa,
  type TreasuryActor,
} from './treasury.common.js';
import type { CreateAccountInput, PutAccountInput } from './treasury.dto.js';
import {
  TreasuryAccount,
  TreasuryExpense,
  TreasuryMovement,
  type TreasuryAccountDocument,
  type TreasuryExpenseDocument,
  type TreasuryMovementDocument,
} from './treasury.schemas.js';
import { TreasuryReceivablesReader } from './treasury-sources.js';

export interface TreasuryAccountView {
  id: string;
  name: string;
  kind: TreasuryAccount['kind'];
  institution: string | null;
  currency: TreasuryCurrency;
  openingBalance: string;
  openingDate: string;
  active: boolean;
  revision: number;
  /** Solde calculé par le moteur à `asOf`. */
  balance: string;
  inflows: string;
  outflows: string;
  movementCount: number;
}

export interface AccountsPage {
  asOf: string;
  items: TreasuryAccountView[];
  totalsByCurrency: Partial<Record<TreasuryCurrency, string>>;
  receiptsIntegrated: boolean;
}

type AccountLean = TreasuryAccount & { _id: Types.ObjectId };

/** Mouvement unifié du grand livre, pour l'écran « Mouvements ». */
export interface LedgerEntry {
  id: string;
  source: 'expense' | 'transfer' | 'other_in' | 'other_out' | 'receipt';
  accountId: string;
  date: string;
  direction: 'in' | 'out';
  amount: string;
  currency: TreasuryCurrency;
  label: string;
}

export interface Ledger {
  accounts: (TreasuryAccountInput & { active: boolean; name: string })[];
  movements: TreasuryMovementInput[];
  entries: LedgerEntry[];
  /** Encaissements (ADR-0031) sans compte de trésorerie : hors des soldes. */
  unassignedReceipts: { receivedOn: string; currency: TreasuryCurrency }[];
}

@Injectable()
export class TreasuryAccountsService {
  constructor(
    @InjectModel(TreasuryAccount.name) private readonly accounts: Model<TreasuryAccountDocument>,
    @InjectModel(TreasuryExpense.name) private readonly expenses: Model<TreasuryExpenseDocument>,
    @InjectModel(TreasuryMovement.name) private readonly movements: Model<TreasuryMovementDocument>,
    @Inject(TreasuryReceivablesReader) private readonly sources: TreasuryReceivablesReader,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Comptes, mouvements engine et entrées lisibles de l'organisation. */
  async ledger(organizationId: string): Promise<Ledger> {
    const [accounts, expenses, movements, receipts] = await Promise.all([
      this.accounts.find({ organizationId }).sort({ name: 1, _id: 1 }).lean<AccountLean[]>().exec(),
      this.expenses
        .find(
          { organizationId, status: 'recorded', accountId: { $type: 'string' } },
          { accountId: 1, spentOn: 1, amount: 1, currency: 1, label: 1 },
        )
        .lean<
          {
            _id: Types.ObjectId;
            accountId: string;
            spentOn: string;
            amount: string;
            currency: TreasuryCurrency;
            label: string;
          }[]
        >()
        .exec(),
      this.movements
        .find({ organizationId, status: 'recorded' })
        .lean<(TreasuryMovement & { _id: Types.ObjectId })[]>()
        .exec(),
      this.sources.listReceipts(organizationId),
    ]);

    const currencyOf = new Map(accounts.map((a) => [String(a._id), a.currency]));
    const entries: LedgerEntry[] = [];
    for (const e of expenses) {
      entries.push({
        id: String(e._id),
        source: 'expense',
        accountId: e.accountId,
        date: e.spentOn,
        direction: 'out',
        amount: e.amount,
        currency: e.currency,
        label: e.label,
      });
    }
    for (const m of movements) {
      const id = String(m._id);
      if (m.fromAccountId !== null && m.amountOut !== null) {
        entries.push({
          id,
          source: m.kind === 'transfer' ? 'transfer' : 'other_out',
          accountId: m.fromAccountId,
          date: m.date,
          direction: 'out',
          amount: m.amountOut,
          currency: currencyOf.get(m.fromAccountId) ?? 'USD',
          label: m.label,
        });
      }
      if (m.toAccountId !== null && m.amountIn !== null) {
        entries.push({
          id,
          source: m.kind === 'transfer' ? 'transfer' : 'other_in',
          accountId: m.toAccountId,
          date: m.date,
          direction: 'in',
          amount: m.amountIn,
          currency: currencyOf.get(m.toAccountId) ?? 'USD',
          label: m.label,
        });
      }
    }
    const unassignedReceipts: { receivedOn: string; currency: TreasuryCurrency }[] = [];
    for (const r of receipts) {
      if (r.accountId === null || !currencyOf.has(r.accountId)) {
        // Sans compte (ou compte inconnu) : hors des soldes, compté comme incertitude.
        unassignedReceipts.push({ receivedOn: r.receivedOn, currency: r.currency });
        continue;
      }
      entries.push({
        id: r.id,
        source: 'receipt',
        accountId: r.accountId,
        date: r.receivedOn,
        direction: 'in',
        amount: r.amount,
        currency: r.currency,
        label: r.label,
      });
    }
    entries.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

    return {
      accounts: accounts.map((a) => ({
        id: String(a._id),
        name: a.name,
        currency: a.currency,
        openingBalance: a.openingBalance,
        openingDate: a.openingDate,
        active: a.active,
      })),
      movements: entries.map((e) => ({
        accountId: e.accountId,
        date: e.date,
        direction: e.direction,
        amount: e.amount,
      })),
      entries,
      unassignedReceipts,
    };
  }

  async list(organizationId: string): Promise<AccountsPage> {
    const asOf = todayKinshasa();
    const [docs, ledger] = await Promise.all([
      this.accounts
        .find({ organizationId })
        .sort({ active: -1, name: 1, _id: 1 })
        .lean<AccountLean[]>()
        .exec(),
      this.ledger(organizationId),
    ]);
    const balances = computeAccountBalances(ledger.accounts, ledger.movements, asOf);
    const byId = new Map(balances.accounts.map((b) => [b.accountId, b]));
    return {
      asOf,
      items: docs.map((d) => viewOf(d, byId.get(String(d._id)))),
      totalsByCurrency: balances.totalsByCurrency,
      receiptsIntegrated: this.sources.receiptsIntegrated(),
    };
  }

  async get(organizationId: string, accountId: string): Promise<TreasuryAccountView> {
    const page = await this.list(organizationId);
    const found = page.items.find((a) => a.id === accountId);
    if (!found) accountNotFound();
    return found;
  }

  async create(
    organizationId: string,
    input: CreateAccountInput,
    actor: TreasuryActor,
  ): Promise<TreasuryAccountView> {
    const doc = await this.accounts.create({
      organizationId,
      ...input,
      active: true,
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'treasury.account.created',
      targetType: 'treasury_account',
      targetId: String(doc._id),
      metadata: { currency: input.currency, kind: input.kind },
    });
    return this.get(organizationId, String(doc._id));
  }

  /** Devise et date d'ouverture ne se modifient pas (mouvements déjà rattachés). */
  async put(
    organizationId: string,
    accountId: string,
    input: PutAccountInput,
    actor: TreasuryActor,
  ): Promise<TreasuryAccountView> {
    const current = await this.requireOwn(organizationId, accountId);
    if (current.revision !== input.expectedRevision) staleRevision(current.revision);
    const { expectedRevision, ...fields } = input;
    const updated = await this.accounts
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: expectedRevision },
        { $set: { ...fields, updatedBy: actor.userId }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<AccountLean>()
      .exec();
    if (!updated) staleRevision((await this.requireOwn(organizationId, accountId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'treasury.account.updated',
      targetType: 'treasury_account',
      targetId: accountId,
      metadata: { active: input.active },
    });
    return this.get(organizationId, accountId);
  }

  async requireOwn(organizationId: string, accountId: string): Promise<AccountLean> {
    if (!isMongoId(accountId)) accountNotFound();
    const doc = await this.accounts
      .findOne({ _id: accountId, organizationId })
      .lean<AccountLean>()
      .exec();
    if (!doc) accountNotFound();
    return doc;
  }

  /**
   * Compte utilisable pour un mouvement : de l'organisation (404 sinon), actif,
   * de la devise attendue, ouvert à la date du mouvement.
   */
  async requireUsable(
    organizationId: string,
    accountId: string,
    expected: { currency?: TreasuryCurrency; date: string },
  ): Promise<AccountLean> {
    const account = await this.requireOwn(organizationId, accountId);
    if (!account.active) {
      rejected('ACCOUNT_INACTIVE', `Le compte « ${account.name} » est désactivé.`);
    }
    if (expected.currency !== undefined && account.currency !== expected.currency) {
      rejected(
        'EXPENSE_ACCOUNT_CURRENCY_MISMATCH',
        `Le compte « ${account.name} » est tenu en ${account.currency} : le montant doit être dans cette devise.`,
      );
    }
    if (expected.date < account.openingDate) {
      rejected(
        'EXPENSE_BEFORE_ACCOUNT_OPENING',
        `Le compte « ${account.name} » est ouvert depuis le ${account.openingDate} : un mouvement antérieur n'y a pas sa place.`,
      );
    }
    return account;
  }
}

function accountNotFound(): never {
  notFound('TREASURY_ACCOUNT_NOT_FOUND', 'Compte de trésorerie introuvable.');
}

function viewOf(doc: AccountLean, balance: AccountBalance | undefined): TreasuryAccountView {
  return {
    id: String(doc._id),
    name: doc.name,
    kind: doc.kind,
    institution: doc.institution ?? null,
    currency: doc.currency,
    openingBalance: doc.openingBalance,
    openingDate: doc.openingDate,
    active: doc.active,
    revision: doc.revision,
    balance: balance?.balance ?? doc.openingBalance,
    inflows: balance?.inflows ?? '0.00',
    outflows: balance?.outflows ?? '0.00',
    movementCount: balance?.movementCount ?? 0,
  };
}
