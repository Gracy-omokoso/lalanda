// Dépenses récurrentes — ADR-0034 § 3.
//
// Une règle PRÉVOIT ; elle ne paie rien. Chaque occurrence passée est
// confirmée par l'utilisateur et devient alors une dépense ordinaire, liée à
// (règle, date) par un index unique : confirmer deux fois ne crée qu'une dépense.

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  EXPENSE_CATEGORIES,
  isOccurrenceOf,
  occurrencesOf,
  OVERDUE_RECURRING_LOOKBACK_DAYS,
  treasuryAddDays,
  type ExpenseCategory,
  type RecurrenceFrequency,
  type RecurringExpenseInput,
  type TreasuryCurrency,
} from '@lalanda/engine';
import type { Model, Types } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { isDuplicateKey, staleRevision } from '../sales/sales.errors.js';
import { TreasuryAccountsService } from './treasury-accounts.service.js';
import {
  expenseView,
  TreasuryExpensesService,
  type ExpenseView,
} from './treasury-expenses.service.js';
import {
  isMongoId,
  notFound,
  rejected,
  todayKinshasa,
  type TreasuryActor,
} from './treasury.common.js';
import type { RecurringExpenseInputDto } from './treasury.dto.js';
import {
  TreasuryExpense,
  TreasuryRecurringExpense,
  type TreasuryExpenseDocument,
  type TreasuryRecurringExpenseDocument,
} from './treasury.schemas.js';

export interface RecurringExpenseView {
  id: string;
  label: string;
  amount: string;
  currency: TreasuryCurrency;
  category: ExpenseCategory;
  categoryLabel: string;
  supplierName: string | null;
  /** ADR-0044 — P2 : fiche fournisseur, ou `null`. */
  supplierId: string | null;
  accountId: string | null;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate: string | null;
  active: boolean;
  revision: number;
  /** Prochaine occurrence à venir (après aujourd'hui), `null` si la règle est terminée. */
  nextOccurrence: string | null;
}

export interface DueOccurrence {
  recurringExpenseId: string;
  label: string;
  occurrenceDate: string;
  amount: string;
  currency: TreasuryCurrency;
  category: ExpenseCategory;
}

type RuleLean = TreasuryRecurringExpense & { _id: Types.ObjectId };

const CATEGORY_LABELS = new Map<string, string>(EXPENSE_CATEGORIES.map((c) => [c.code, c.label]));

@Injectable()
export class TreasuryRecurringService {
  constructor(
    @InjectModel(TreasuryRecurringExpense.name)
    private readonly rules: Model<TreasuryRecurringExpenseDocument>,
    @InjectModel(TreasuryExpense.name) private readonly expenses: Model<TreasuryExpenseDocument>,
    @Inject(TreasuryAccountsService) private readonly accounts: TreasuryAccountsService,
    @Inject(TreasuryExpensesService) private readonly expenseService: TreasuryExpensesService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<RecurringExpenseView[]> {
    const docs = await this.rules
      .find({ organizationId })
      .sort({ active: -1, label: 1, _id: 1 })
      .lean<RuleLean[]>()
      .exec();
    const today = todayKinshasa();
    return docs.map((d) => this.view(d, today));
  }

  /** Règles au format moteur (prévision). */
  async engineRules(organizationId: string): Promise<RecurringExpenseInput[]> {
    const docs = await this.rules.find({ organizationId }).lean<RuleLean[]>().exec();
    return docs.map((d) => ({
      id: String(d._id),
      label: d.label,
      category: d.category,
      currency: d.currency,
      amount: d.amount,
      frequency: d.frequency,
      startDate: d.startDate,
      endDate: d.endDate ?? null,
      active: d.active,
    }));
  }

  /** Occurrences déjà confirmées (dépenses non annulées liées à une règle). */
  async confirmedOccurrences(
    organizationId: string,
  ): Promise<{ recurringExpenseId: string; occurrenceDate: string }[]> {
    const docs = await this.expenses
      .find(
        { organizationId, status: 'recorded', recurringExpenseId: { $type: 'string' } },
        { recurringExpenseId: 1, occurrenceDate: 1 },
      )
      .lean<{ recurringExpenseId: string; occurrenceDate: string }[]>()
      .exec();
    return docs.map((d) => ({
      recurringExpenseId: d.recurringExpenseId,
      occurrenceDate: d.occurrenceDate,
    }));
  }

  async create(
    organizationId: string,
    input: RecurringExpenseInputDto,
    actor: TreasuryActor,
  ): Promise<RecurringExpenseView> {
    await this.assertAccount(organizationId, input);
    // ADR-0044 — P2 : fiche fournisseur (même règle que les dépenses).
    const supplier = await this.expenseService.resolveSupplier(organizationId, input, null);
    const doc = await this.rules.create({
      organizationId,
      ...input,
      ...supplier,
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'treasury.recurring.created',
      targetType: 'treasury_recurring_expense',
      targetId: String(doc._id),
      metadata: { frequency: input.frequency, currency: input.currency },
    });
    return this.view(doc.toObject() as RuleLean, todayKinshasa());
  }

  async put(
    organizationId: string,
    ruleId: string,
    expectedRevision: number,
    input: RecurringExpenseInputDto,
    actor: TreasuryActor,
  ): Promise<RecurringExpenseView> {
    const current = await this.requireOwn(organizationId, ruleId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    await this.assertAccount(organizationId, input);
    // ADR-0044 — P2 : fiche fournisseur (posée, retirée, conservée ou rattachée).
    const supplier = await this.expenseService.resolveSupplier(organizationId, input, {
      supplierId: current.supplierId ?? null,
      supplierName: current.supplierName ?? null,
    });
    const updated = await this.rules
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: expectedRevision },
        { $set: { ...input, ...supplier, updatedBy: actor.userId }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<RuleLean>()
      .exec();
    if (!updated) staleRevision((await this.requireOwn(organizationId, ruleId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'treasury.recurring.updated',
      targetType: 'treasury_recurring_expense',
      targetId: ruleId,
      metadata: { active: input.active },
    });
    return this.view(updated, todayKinshasa());
  }

  /**
   * Occurrences PASSÉES (90 jours au plus, aujourd'hui compris) des règles
   * actives, non encore confirmées — la liste « à confirmer ».
   */
  async due(organizationId: string): Promise<DueOccurrence[]> {
    const today = todayKinshasa();
    const from = treasuryAddDays(today, -OVERDUE_RECURRING_LOOKBACK_DAYS);
    const [rules, confirmed] = await Promise.all([
      this.rules.find({ organizationId, active: true }).lean<RuleLean[]>().exec(),
      this.confirmedOccurrences(organizationId),
    ]);
    const done = new Set(confirmed.map((c) => `${c.recurringExpenseId}|${c.occurrenceDate}`));
    const out: DueOccurrence[] = [];
    for (const rule of rules) {
      const id = String(rule._id);
      for (const date of occurrencesOf(this.ruleOf(rule), from, today)) {
        if (done.has(`${id}|${date}`)) continue;
        out.push({
          recurringExpenseId: id,
          label: rule.label,
          occurrenceDate: date,
          amount: rule.amount,
          currency: rule.currency,
          category: rule.category,
        });
      }
    }
    return out.sort(
      (a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate) || a.label.localeCompare(b.label),
    );
  }

  /**
   * Confirme une occurrence passée : crée la dépense (idempotent). Le montant, la
   * date de paiement, le compte et la référence réels peuvent différer de la règle.
   */
  async confirm(
    organizationId: string,
    ruleId: string,
    occurrenceDate: string,
    overrides: {
      amount?: string;
      spentOn?: string;
      accountId?: string | null;
      reference: string | null;
    },
    actor: TreasuryActor,
  ): Promise<{ expense: ExpenseView; alreadyConfirmed: boolean }> {
    const rule = await this.requireOwn(organizationId, ruleId);
    if (!isOccurrenceOf(this.ruleOf(rule), occurrenceDate)) {
      rejected(
        'NOT_AN_OCCURRENCE',
        `Le ${occurrenceDate} n'est pas une échéance de « ${rule.label} ».`,
      );
    }
    if (occurrenceDate > todayKinshasa()) {
      rejected(
        'OCCURRENCE_IN_FUTURE',
        'Une échéance à venir ne se confirme pas : elle n’est pas encore payée.',
      );
    }
    const existing = await this.findConfirmed(organizationId, ruleId, occurrenceDate);
    if (existing) return { expense: expenseView(existing), alreadyConfirmed: true };

    try {
      const created = await this.expenseService.create(
        organizationId,
        {
          spentOn: overrides.spentOn ?? occurrenceDate,
          amount: overrides.amount ?? rule.amount,
          currency: rule.currency,
          category: rule.category,
          label: rule.label,
          supplierName: rule.supplierName ?? null,
          // ADR-0044 — P2 : l'occurrence porte la fiche de sa règle.
          supplierId: rule.supplierId ?? null,
          accountId:
            overrides.accountId === undefined ? (rule.accountId ?? null) : overrides.accountId,
          deductibleVat: null,
          reference: overrides.reference,
        },
        actor,
        { recurringExpenseId: ruleId, occurrenceDate },
      );
      return { expense: expenseView(created), alreadyConfirmed: false };
    } catch (err) {
      // Course : une autre confirmation a gagné l'index unique — même résultat.
      if (isDuplicateKey(err)) {
        const winner = await this.findConfirmed(organizationId, ruleId, occurrenceDate);
        if (winner) return { expense: expenseView(winner), alreadyConfirmed: true };
      }
      throw err;
    }
  }

  private findConfirmed(organizationId: string, ruleId: string, occurrenceDate: string) {
    return this.expenses
      .findOne({ organizationId, recurringExpenseId: ruleId, occurrenceDate, status: 'recorded' })
      .lean<TreasuryExpense & { _id: Types.ObjectId }>()
      .exec();
  }

  private async requireOwn(organizationId: string, ruleId: string): Promise<RuleLean> {
    if (!isMongoId(ruleId)) ruleNotFound();
    const doc = await this.rules.findOne({ _id: ruleId, organizationId }).lean<RuleLean>().exec();
    if (!doc) ruleNotFound();
    return doc;
  }

  private async assertAccount(
    organizationId: string,
    input: RecurringExpenseInputDto,
  ): Promise<void> {
    if (input.accountId === null) return;
    await this.accounts.requireUsable(organizationId, input.accountId, {
      currency: input.currency,
      date: input.startDate,
    });
  }

  private ruleOf(d: RuleLean): {
    frequency: RecurrenceFrequency;
    startDate: string;
    endDate: string | null;
  } {
    return { frequency: d.frequency, startDate: d.startDate, endDate: d.endDate ?? null };
  }

  private view(d: RuleLean, today: string): RecurringExpenseView {
    const next = occurrencesOf(
      this.ruleOf(d),
      treasuryAddDays(today, 1),
      treasuryAddDays(today, 400),
    )[0];
    return {
      id: String(d._id),
      label: d.label,
      amount: d.amount,
      currency: d.currency,
      category: d.category,
      categoryLabel: CATEGORY_LABELS.get(d.category) ?? d.category,
      supplierName: d.supplierName ?? null,
      supplierId: d.supplierId ?? null,
      accountId: d.accountId ?? null,
      frequency: d.frequency,
      startDate: d.startDate,
      endDate: d.endDate ?? null,
      active: d.active,
      revision: d.revision,
      nextOccurrence: d.active ? (next ?? null) : null,
    };
  }
}

function ruleNotFound(): never {
  notFound('RECURRING_EXPENSE_NOT_FOUND', 'Dépense récurrente introuvable.');
}
