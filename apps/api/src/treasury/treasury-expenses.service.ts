// Dépenses — ADR-0034 § 2.
//
// Isolation : chaque requête porte `organizationId` ; une dépense d'une autre
// organisation est introuvable (404). Une dépense n'est jamais effacée : elle
// est annulée avec un motif. Écritures concurrentes : révision attendue.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  aggregateExpenses,
  EXPENSE_CATEGORIES,
  type ExpenseAggregation,
  type ExpenseCategory,
  type TreasuryCurrency,
} from '@lalanda/engine';
import type { FilterQuery, Model, Types } from 'mongoose';

import type { ImageAcceptance } from '../account/image-validation.js';
import { AuditService } from '../authz/audit.service.js';
import { invalidCursor, staleRevision } from '../sales/sales.errors.js';
import { escapeRegex, normalizeForSearch } from '../sales/search.js';
import { newObjectId } from '../storage/object-key.js';
import {
  ObjectStorageService,
  ObjectStorageUnavailableError,
  type StoredObject,
} from '../storage/object-storage.service.js';
import { TreasuryAccountsService } from './treasury-accounts.service.js';
import {
  conflict,
  expenseReceiptObjectKey,
  isMongoId,
  noFutureDate,
  notFound,
  type TreasuryActor,
} from './treasury.common.js';
import type { ExpenseInputDto, ListExpensesQuery } from './treasury.dto.js';
import { TreasuryExpense, type TreasuryExpenseDocument } from './treasury.schemas.js';

export interface ExpenseView {
  id: string;
  spentOn: string;
  amount: string;
  currency: TreasuryCurrency;
  category: ExpenseCategory;
  categoryLabel: string;
  label: string;
  supplierName: string | null;
  accountId: string | null;
  deductibleVat: string | null;
  reference: string | null;
  attachment: { contentType: string; size: number; uploadedAt: string } | null;
  recurringExpenseId: string | null;
  occurrenceDate: string | null;
  status: 'recorded' | 'cancelled';
  cancelReason: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExpensePage {
  items: ExpenseView[];
  nextCursor: string | null;
}

type ExpenseLean = TreasuryExpense & { _id: Types.ObjectId };

const CATEGORY_LABELS = new Map<string, string>(EXPENSE_CATEGORIES.map((c) => [c.code, c.label]));

export function expenseView(doc: ExpenseLean): ExpenseView {
  return {
    id: String(doc._id),
    spentOn: doc.spentOn,
    amount: doc.amount,
    currency: doc.currency,
    category: doc.category,
    categoryLabel: CATEGORY_LABELS.get(doc.category) ?? doc.category,
    label: doc.label,
    supplierName: doc.supplierName ?? null,
    accountId: doc.accountId ?? null,
    deductibleVat: doc.deductibleVat ?? null,
    reference: doc.reference ?? null,
    attachment: doc.attachment
      ? {
          contentType: doc.attachment.contentType,
          size: doc.attachment.size,
          uploadedAt: doc.attachment.uploadedAt.toISOString(),
        }
      : null,
    recurringExpenseId: doc.recurringExpenseId ?? null,
    occurrenceDate: doc.occurrenceDate ?? null,
    status: doc.status,
    cancelReason: doc.cancelReason ?? null,
    revision: doc.revision,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/** Curseur opaque `spentOn|id`, tri décroissant. */
function encodeExpenseCursor(spentOn: string, id: string): string {
  return Buffer.from(`${spentOn}|${id}`, 'utf8').toString('base64url');
}

function decodeExpenseCursor(raw: string): { spentOn: string; id: string } | null {
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const m = /^(\d{4}-\d{2}-\d{2})\|([0-9a-f]{24})$/.exec(text);
  return m ? { spentOn: m[1] as string, id: m[2] as string } : null;
}

@Injectable()
export class TreasuryExpensesService {
  private readonly logger = new Logger(TreasuryExpensesService.name);

  constructor(
    @InjectModel(TreasuryExpense.name) private readonly expenses: Model<TreasuryExpenseDocument>,
    @Inject(TreasuryAccountsService) private readonly accounts: TreasuryAccountsService,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, query: ListExpensesQuery): Promise<ExpensePage> {
    const and: FilterQuery<TreasuryExpenseDocument>[] = [{ organizationId }];
    if (query.status !== 'all') and.push({ status: query.status });
    if (query.from) and.push({ spentOn: { $gte: query.from } });
    if (query.to) and.push({ spentOn: { $lte: query.to } });
    if (query.category) and.push({ category: query.category });
    if (query.currency) and.push({ currency: query.currency });
    if (query.accountId) and.push({ accountId: query.accountId });
    if (query.q !== undefined && query.q.trim() !== '') {
      const term = escapeRegex(query.q.trim());
      and.push({
        $or: [
          { label: { $regex: term, $options: 'i' } },
          { supplierKey: { $regex: escapeRegex(normalizeForSearch(query.q)) } },
          { reference: { $regex: term, $options: 'i' } },
        ],
      });
    }
    if (query.cursor !== undefined) {
      const c = decodeExpenseCursor(query.cursor);
      if (c === null) invalidCursor();
      and.push({
        $or: [{ spentOn: { $lt: c.spentOn } }, { spentOn: c.spentOn, _id: { $lt: c.id } }],
      });
    }
    const docs = await this.expenses
      .find({ $and: and })
      .sort({ spentOn: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<ExpenseLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(expenseView),
      nextCursor:
        docs.length > query.limit && last
          ? encodeExpenseCursor(last.spentOn, String(last._id))
          : null,
    };
  }

  async get(organizationId: string, expenseId: string): Promise<ExpenseView> {
    return expenseView(await this.requireOwn(organizationId, expenseId));
  }

  /** Totaux par mois, devise et catégorie (moteur) — sans projet ni plan. */
  async summary(
    organizationId: string,
    range: { from?: string; to?: string },
  ): Promise<ExpenseAggregation> {
    const filter: FilterQuery<TreasuryExpenseDocument> = { organizationId, status: 'recorded' };
    if (range.from || range.to) {
      filter.spentOn = {
        ...(range.from ? { $gte: range.from } : {}),
        ...(range.to ? { $lte: range.to } : {}),
      };
    }
    const docs = await this.expenses
      .find(filter, { spentOn: 1, amount: 1, currency: 1, category: 1 })
      .lean<ExpenseLean[]>()
      .exec();
    return aggregateExpenses(
      docs.map((d) => ({
        id: String(d._id),
        spentOn: d.spentOn,
        amount: d.amount,
        currency: d.currency,
        category: d.category,
      })),
    );
  }

  /** Fournisseurs déjà saisis (texte simple, ADR-0034 § 2), pour la saisie assistée. */
  async suppliers(organizationId: string, q: string | undefined): Promise<string[]> {
    const filter: FilterQuery<TreasuryExpenseDocument> = {
      organizationId,
      supplierName: { $type: 'string' },
    };
    const term = normalizeForSearch(q ?? '');
    if (term !== '') filter.supplierKey = { $regex: escapeRegex(term) };
    const names = (await this.expenses.distinct('supplierName', filter).exec()) as string[];
    return names.sort((a, b) => a.localeCompare(b, 'fr')).slice(0, 50);
  }

  async create(
    organizationId: string,
    input: ExpenseInputDto,
    actor: TreasuryActor,
    recurrence: { recurringExpenseId: string; occurrenceDate: string } | null = null,
  ): Promise<ExpenseLean> {
    await this.assertRules(organizationId, input);
    const doc = await this.expenses.create({
      organizationId,
      ...input,
      supplierKey: input.supplierName ? normalizeForSearch(input.supplierName) : null,
      attachment: null,
      recurringExpenseId: recurrence?.recurringExpenseId ?? null,
      occurrenceDate: recurrence?.occurrenceDate ?? null,
      status: 'recorded',
      cancelReason: null,
      cancelledAt: null,
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'treasury.expense.recorded',
      targetType: 'treasury_expense',
      targetId: String(doc._id),
      metadata: {
        category: input.category,
        currency: input.currency,
        recurring: recurrence !== null,
      },
    });
    return doc.toObject() as ExpenseLean;
  }

  async put(
    organizationId: string,
    expenseId: string,
    expectedRevision: number,
    input: ExpenseInputDto,
    actor: TreasuryActor,
  ): Promise<ExpenseView> {
    const current = await this.requireOwn(organizationId, expenseId);
    if (current.status === 'cancelled') {
      conflict('EXPENSE_CANCELLED', 'Cette dépense est annulée : elle ne se modifie plus.');
    }
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    await this.assertRules(organizationId, input);
    const updated = await this.expenses
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: expectedRevision, status: 'recorded' },
        {
          $set: {
            ...input,
            supplierKey: input.supplierName ? normalizeForSearch(input.supplierName) : null,
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<ExpenseLean>()
      .exec();
    if (!updated) staleRevision((await this.requireOwn(organizationId, expenseId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'treasury.expense.updated',
      targetType: 'treasury_expense',
      targetId: expenseId,
      metadata: { category: input.category, currency: input.currency },
    });
    return expenseView(updated);
  }

  async cancel(
    organizationId: string,
    expenseId: string,
    reason: string,
    actor: TreasuryActor,
  ): Promise<ExpenseView> {
    const current = await this.requireOwn(organizationId, expenseId);
    if (current.status === 'cancelled') return expenseView(current);
    const updated = await this.expenses
      .findOneAndUpdate(
        { _id: current._id, organizationId, status: 'recorded' },
        {
          // Une occurrence annulée sort de l'index unique partiel (statut
          // `recorded`) : elle redevient « à confirmer », le lien reste lisible.
          $set: {
            status: 'cancelled',
            cancelReason: reason,
            cancelledAt: new Date(),
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<ExpenseLean>()
      .exec();
    const result = updated ?? (await this.requireOwn(organizationId, expenseId));
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'treasury.expense.cancelled',
      targetType: 'treasury_expense',
      targetId: expenseId,
      metadata: { reason: reason.slice(0, 200) },
    });
    return expenseView(result);
  }

  // ─── Pièce justificative ──────────────────────────────────────────────────

  async attach(
    organizationId: string,
    expenseId: string,
    image: ImageAcceptance,
    actor: TreasuryActor,
  ): Promise<ExpenseView> {
    const current = await this.requireOwn(organizationId, expenseId);
    if (current.status === 'cancelled') {
      conflict('EXPENSE_CANCELLED', 'Cette dépense est annulée : elle ne se modifie plus.');
    }
    const bucket = this.requireBucket();
    const objectId = newObjectId();
    // 1. l'objet, 2. le pointeur : à aucun instant la dépense ne désigne un objet absent.
    await this.storage.putObject(
      bucket,
      expenseReceiptObjectKey(objectId),
      image.bytes,
      image.contentType,
    );
    const updated = await this.expenses
      .findOneAndUpdate(
        { _id: current._id, organizationId },
        {
          $set: {
            attachment: {
              objectId,
              contentType: image.contentType,
              size: image.bytes.length,
              uploadedAt: new Date(),
              uploadedBy: actor.userId,
            },
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<ExpenseLean>()
      .exec();
    if (current.attachment) await this.dropObject(bucket, current.attachment.objectId);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'treasury.expense.attachment_uploaded',
      targetType: 'treasury_expense',
      targetId: expenseId,
      metadata: { contentType: image.contentType, size: image.bytes.length },
    });
    return expenseView(updated ?? (await this.requireOwn(organizationId, expenseId)));
  }

  async detach(
    organizationId: string,
    expenseId: string,
    actor: TreasuryActor,
  ): Promise<ExpenseView> {
    const current = await this.requireOwn(organizationId, expenseId);
    if (!current.attachment) return expenseView(current);
    const updated = await this.expenses
      .findOneAndUpdate(
        { _id: current._id, organizationId },
        { $set: { attachment: null, updatedBy: actor.userId }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<ExpenseLean>()
      .exec();
    const bucket = this.storage.uploadsBucket();
    if (bucket) await this.dropObject(bucket, current.attachment.objectId);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'treasury.expense.attachment_removed',
      targetType: 'treasury_expense',
      targetId: expenseId,
    });
    return expenseView(updated ?? (await this.requireOwn(organizationId, expenseId)));
  }

  /** Octets de la pièce, ou `null` (404 unique côté contrôleur, pas d'oracle). */
  async readAttachment(organizationId: string, expenseId: string): Promise<StoredObject | null> {
    const current = await this.requireOwn(organizationId, expenseId);
    if (!current.attachment) return null;
    const bucket = this.requireBucket();
    const object = await this.storage.getObject(
      bucket,
      expenseReceiptObjectKey(current.attachment.objectId),
    );
    if (!object) return null;
    // Le type servi est celui déduit du contenu au téléversement, jamais celui du stockage.
    return { body: object.body, contentType: current.attachment.contentType };
  }

  async requireOwn(organizationId: string, expenseId: string): Promise<ExpenseLean> {
    if (!isMongoId(expenseId)) expenseNotFound();
    const doc = await this.expenses
      .findOne({ _id: expenseId, organizationId })
      .lean<ExpenseLean>()
      .exec();
    if (!doc) expenseNotFound();
    return doc;
  }

  /** Règles qui exigent la base ou l'horloge. */
  private async assertRules(organizationId: string, input: ExpenseInputDto): Promise<void> {
    noFutureDate(input.spentOn, 'EXPENSE_IN_FUTURE', 'Une dépense');
    if (input.accountId !== null) {
      await this.accounts.requireUsable(organizationId, input.accountId, {
        currency: input.currency,
        date: input.spentOn,
      });
    }
  }

  private requireBucket(): string {
    const bucket = this.storage.uploadsBucket();
    if (!bucket) {
      const a = this.storage.availability();
      throw new ObjectStorageUnavailableError(a.available ? 'Bucket absent.' : a.reason);
    }
    return bucket;
  }

  /** Suppression best-effort : un objet orphelin vaut mieux qu'une pièce perdue. */
  private async dropObject(bucket: string, objectId: string): Promise<void> {
    try {
      await this.storage.deleteObject(bucket, expenseReceiptObjectKey(objectId));
    } catch (err) {
      this.logger.warn(`Pièce ${objectId} non supprimée du stockage : ${(err as Error).message}`);
    }
  }
}

function expenseNotFound(): never {
  notFound('EXPENSE_NOT_FOUND', 'Dépense introuvable.');
}
