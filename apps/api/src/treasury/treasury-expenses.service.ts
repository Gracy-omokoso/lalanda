// Dépenses — ADR-0034 § 2.
//
// Isolation : chaque requête porte `organizationId` ; une dépense d'une autre
// organisation est introuvable (404). Une dépense n'est jamais effacée : elle
// est annulée avec un motif. Écritures concurrentes : révision attendue.
//
// ADR-0039 § 2.10 : une dépense peut être rattachée à un projet du RUN
// (`workProjectId`). Le projet est LU en lecture seule (`work_projects`, par la
// connexion, sans importer le module « work ») : projet d'une autre organisation
// → 404 `EXPENSE_WORK_PROJECT_UNKNOWN` ; projet archivé → 409.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  aggregateExpenses,
  EXPENSE_CATEGORIES,
  type ExpenseAggregation,
  type ExpenseCategory,
  type TreasuryCurrency,
} from '@lalanda/engine';
import { Types, type ClientSession, type Connection, type FilterQuery, type Model } from 'mongoose';

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
import {
  TreasuryExpense,
  type ExpenseOrigin,
  type TreasuryExpenseDocument,
} from './treasury.schemas.js';

export interface ExpenseView {
  id: string;
  spentOn: string;
  amount: string;
  currency: TreasuryCurrency;
  category: ExpenseCategory;
  categoryLabel: string;
  label: string;
  supplierName: string | null;
  /** ADR-0044 — P2 : fiche fournisseur, ou `null` (fournisseur de passage). */
  supplierId: string | null;
  accountId: string | null;
  deductibleVat: string | null;
  reference: string | null;
  attachment: { contentType: string; size: number; uploadedAt: string } | null;
  recurringExpenseId: string | null;
  occurrenceDate: string | null;
  /** Projet du RUN rattaché (ADR-0039 § 2.10), ou `null`. */
  workProjectId: string | null;
  /**
   * ADR-0044 — P5 : `null` = dépense directe ; sinon créée ou rattachée par un
   * paiement fournisseur, en lecture seule pour la trésorerie.
   */
  origin: ExpenseOrigin | null;
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

export type ExpenseLean = TreasuryExpense & { _id: Types.ObjectId };

/** ADR-0044 — P5 : dépense créée par un paiement fournisseur (montants du moteur). */
export interface OwnedExpenseInput {
  organizationId: string;
  spentOn: string;
  amount: string;
  currency: TreasuryCurrency;
  category: ExpenseCategory;
  label: string;
  supplierId: string;
  supplierName: string;
  accountId: string | null;
  deductibleVat: string | null;
  reference: string | null;
  workProjectId: string | null;
  origin: ExpenseOrigin;
  actor: TreasuryActor;
}

/** Collection du module « work », lue en lecture seule (ADR-0039 § 2.10). */
const WORK_PROJECTS = 'work_projects';

/**
 * ADR-0044 — P2 : fiches fournisseurs, lues en lecture seule par la connexion (la
 * trésorerie n'importe pas le module des achats, motif de `work_projects`).
 */
const SUPPLIERS = 'suppliers';

/** Fournisseur d'une dépense ou d'une règle : fiche et copie d'affichage du nom. */
export interface ResolvedSupplier {
  supplierId: string | null;
  supplierName: string | null;
}

/** Élément de l'autocomplétion des fournisseurs (ADR-0044 § 3.1). */
export interface TreasurySupplierEntry {
  name: string;
  supplierId: string | null;
}

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
    supplierId: doc.supplierId ?? null,
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
    workProjectId: doc.workProjectId ?? null,
    origin: doc.origin ?? null,
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
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async list(organizationId: string, query: ListExpensesQuery): Promise<ExpensePage> {
    const and: FilterQuery<TreasuryExpenseDocument>[] = [{ organizationId }];
    if (query.status !== 'all') and.push({ status: query.status });
    if (query.from) and.push({ spentOn: { $gte: query.from } });
    if (query.to) and.push({ spentOn: { $lte: query.to } });
    if (query.category) and.push({ category: query.category });
    if (query.currency) and.push({ currency: query.currency });
    if (query.accountId) and.push({ accountId: query.accountId });
    if (query.workProjectId) and.push({ workProjectId: query.workProjectId });
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

  /**
   * ADR-0044 — P2 (§ 3.1) : les fiches fournisseurs actives ET les textes libres
   * restants (dépenses sans fiche), chaque élément avec `supplierId | null`. Fiches
   * d'abord, puis textes, chacun trié ; 50 au plus.
   */
  async supplierEntries(
    organizationId: string,
    q: string | undefined,
  ): Promise<TreasurySupplierEntry[]> {
    const term = normalizeForSearch(q ?? '');
    const cards = await this.connection
      .collection(SUPPLIERS)
      .find(
        {
          organizationId,
          active: true,
          mergedInto: null,
          ...(term !== '' ? { searchKey: { $regex: escapeRegex(term) } } : {}),
        },
        { projection: { name: 1, sortName: 1 } },
      )
      .sort({ sortName: 1, _id: 1 })
      .limit(50)
      .toArray();
    const filter: FilterQuery<TreasuryExpenseDocument> = {
      organizationId,
      supplierName: { $type: 'string' },
      $or: [{ supplierId: null }, { supplierId: { $exists: false } }],
    };
    if (term !== '') filter.supplierKey = { $regex: escapeRegex(term) };
    const texts = (await this.expenses.distinct('supplierName', filter).exec()) as string[];
    const cardKeys = new Set(cards.map((c) => normalizeForSearch(String(c['name']))));
    return [
      ...cards.map((c) => ({ name: String(c['name']), supplierId: String(c._id) })),
      ...texts
        .filter((t) => !cardKeys.has(normalizeForSearch(t)))
        .sort((a, b) => a.localeCompare(b, 'fr'))
        .map((name) => ({ name, supplierId: null })),
    ].slice(0, 50);
  }

  /**
   * ADR-0044 — P2 (§ 2.8, § 2.9) : fiche fournisseur d'une écriture de la trésorerie.
   *
   * - `supplierId` posé : fiche de l'organisation (404 sinon), non fusionnée (409),
   *   active à l'écriture (409), sauf si c'est déjà celle de l'écriture courante ;
   *   `supplierName` devient la copie du nom de la fiche ;
   * - `supplierId: null` : fournisseur de passage, texte libre seul ;
   * - absent : la fiche courante est conservée si le texte n'a pas changé ; sinon le
   *   texte est rattaché par clé EXACTE à la fiche active qui la porte dans
   *   `legacyKeys` (aucun rapprochement approché), ou reste libre.
   */
  async resolveSupplier(
    organizationId: string,
    input: { supplierId?: string | null | undefined; supplierName: string | null },
    current: ResolvedSupplier | null,
  ): Promise<ResolvedSupplier> {
    if (input.supplierId === null) return { supplierId: null, supplierName: input.supplierName };
    if (typeof input.supplierId === 'string') {
      const card = Types.ObjectId.isValid(input.supplierId)
        ? await this.connection
            .collection(SUPPLIERS)
            .findOne(
              { _id: new Types.ObjectId(input.supplierId), organizationId },
              { projection: { name: 1, active: 1, mergedInto: 1 } },
            )
        : null;
      if (!card)
        notFound('EXPENSE_SUPPLIER_UNKNOWN', 'Fournisseur introuvable dans cette organisation.');
      const id = String(card._id);
      if (card['mergedInto']) {
        conflict('SUPPLIER_MERGED', 'Ce fournisseur a été fusionné dans une autre fiche.', {
          mergedInto: String(card['mergedInto']),
        });
      }
      if (card['active'] === false && current?.supplierId !== id) {
        conflict(
          'SUPPLIER_ARCHIVED',
          'Ce fournisseur est archivé : restaurez-le avant de l’utiliser.',
        );
      }
      return { supplierId: id, supplierName: String(card['name']) };
    }
    if (current?.supplierId && input.supplierName === current.supplierName) return current;
    if (input.supplierName === null) return { supplierId: null, supplierName: null };
    const card = await this.connection.collection(SUPPLIERS).findOne(
      {
        organizationId,
        legacyKeys: normalizeForSearch(input.supplierName),
        mergedInto: null,
        active: true,
      },
      { sort: { _id: 1 }, projection: { _id: 1 } },
    );
    return { supplierId: card ? String(card._id) : null, supplierName: input.supplierName };
  }

  async create(
    organizationId: string,
    input: ExpenseInputDto,
    actor: TreasuryActor,
    recurrence: { recurringExpenseId: string; occurrenceDate: string } | null = null,
  ): Promise<ExpenseLean> {
    await this.assertRules(organizationId, input);
    const { workProjectId, supplierId: _supplierId, ...fields } = input;
    if (workProjectId) await this.assertWorkProject(organizationId, workProjectId);
    // ADR-0044 — P2 : l'occurrence d'une règle garde la fiche de sa règle, même archivée.
    const supplier = await this.resolveSupplier(
      organizationId,
      input,
      recurrence && input.supplierId
        ? { supplierId: input.supplierId, supplierName: input.supplierName }
        : null,
    );
    const doc = await this.expenses.create({
      organizationId,
      ...fields,
      ...supplier,
      workProjectId: workProjectId ?? null,
      supplierKey: supplier.supplierName ? normalizeForSearch(supplier.supplierName) : null,
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
        workProjectId: workProjectId ?? null,
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
    assertNotOwned(current);
    if (current.status === 'cancelled') {
      conflict('EXPENSE_CANCELLED', 'Cette dépense est annulée : elle ne se modifie plus.');
    }
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    await this.assertRules(organizationId, input);
    // Absent : rattachement inchangé ; seul un NOUVEAU projet est contrôlé (un
    // projet archivé depuis reste lisible sur la dépense).
    const { workProjectId, supplierId: _supplierId, ...fields } = input;
    if (workProjectId && workProjectId !== (current.workProjectId ?? null)) {
      await this.assertWorkProject(organizationId, workProjectId);
    }
    // ADR-0044 — P2 : fiche fournisseur (posée, retirée, conservée ou rattachée).
    const supplier = await this.resolveSupplier(organizationId, input, {
      supplierId: current.supplierId ?? null,
      supplierName: current.supplierName ?? null,
    });
    const updated = await this.expenses
      .findOneAndUpdate(
        {
          _id: current._id,
          organizationId,
          revision: expectedRevision,
          status: 'recorded',
          origin: null,
        },
        {
          $set: {
            ...fields,
            ...supplier,
            ...(workProjectId !== undefined ? { workProjectId } : {}),
            supplierKey: supplier.supplierName ? normalizeForSearch(supplier.supplierName) : null,
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
      metadata: {
        category: input.category,
        currency: input.currency,
        ...(workProjectId !== undefined ? { workProjectId } : {}),
      },
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
    assertNotOwned(current);
    if (current.status === 'cancelled') return expenseView(current);
    const updated = await this.expenses
      .findOneAndUpdate(
        { _id: current._id, organizationId, status: 'recorded', origin: null },
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

  // ─── ADR-0044 — P5 : dépenses possédées par les achats (§ 6.2) ─────────────
  //
  // La trésorerie reste le SEUL écrivain de `treasury_expenses` : le service des
  // paiements fournisseurs appelle ces méthodes DANS SA TRANSACTION (`session`),
  // avec les règles de la trésorerie (compte actif, même devise, postérieure à
  // l'ouverture, jamais future). Les montants viennent du moteur des achats.

  /** Crée une dépense possédée par un paiement fournisseur (`spentOn` = `paidOn`). */
  async recordOwnedBySupplierPayment(
    session: ClientSession,
    input: OwnedExpenseInput,
  ): Promise<ExpenseLean> {
    const { organizationId, actor } = input;
    noFutureDate(input.spentOn, 'EXPENSE_IN_FUTURE', 'Une dépense');
    if (input.accountId !== null) {
      await this.accounts.requireUsable(organizationId, input.accountId, {
        currency: input.currency,
        date: input.spentOn,
      });
    }
    const [doc] = await this.expenses.create(
      [
        {
          organizationId,
          spentOn: input.spentOn,
          amount: input.amount,
          currency: input.currency,
          category: input.category,
          label: input.label,
          supplierId: input.supplierId,
          supplierName: input.supplierName,
          supplierKey: input.supplierName ? normalizeForSearch(input.supplierName) : null,
          accountId: input.accountId,
          deductibleVat: input.deductibleVat,
          reference: input.reference,
          attachment: null,
          recurringExpenseId: null,
          occurrenceDate: null,
          workProjectId: input.workProjectId,
          origin: input.origin,
          status: 'recorded',
          cancelReason: null,
          cancelledAt: null,
          revision: 1,
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
        action: 'treasury.expense.recorded',
        targetType: 'treasury_expense',
        targetId: String(doc!._id),
        metadata: {
          category: input.category,
          currency: input.currency,
          recurring: false,
          workProjectId: input.workProjectId,
          supplierPaymentId: input.origin.paymentId,
        },
      },
      { session },
    );
    return doc!.toObject() as ExpenseLean;
  }

  /**
   * `from-expense` (O3 b), dépense GARDÉE : la dépense directe reçoit `origin` et la
   * fiche fournisseur, rien d'autre. Révision attendue ; une dépense déjà possédée
   * ou annulée est refusée.
   */
  async linkToSupplierPayment(
    session: ClientSession,
    organizationId: string,
    expenseId: string,
    expectedRevision: number,
    link: { origin: ExpenseOrigin; supplierId: string; supplierName: string },
    actor: TreasuryActor,
  ): Promise<ExpenseLean> {
    const updated = await this.expenses
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(expenseId),
          organizationId,
          revision: expectedRevision,
          status: 'recorded',
          origin: null,
        },
        {
          $set: {
            origin: link.origin,
            supplierId: link.supplierId,
            supplierName: link.supplierName,
            supplierKey: normalizeForSearch(link.supplierName),
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
        { new: true, session },
      )
      .lean<ExpenseLean>()
      .exec();
    if (!updated) await this.directConflict(organizationId, expenseId, expectedRevision);
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'treasury.expense.linked_to_supplier_payment',
        targetType: 'treasury_expense',
        targetId: expenseId,
        metadata: { supplierPaymentId: link.origin.paymentId, invoiceId: link.origin.invoiceId },
      },
      { session },
    );
    return updated as ExpenseLean;
  }

  /**
   * `from-expense` (O3 b), dépense REMPLACÉE par les parts d'une facture à plusieurs
   * imputations : la dépense directe est annulée avec le motif « Rattachée au
   * paiement PF… », dans la transaction qui crée les parts.
   */
  async replaceBySupplierPayment(
    session: ClientSession,
    organizationId: string,
    expenseId: string,
    expectedRevision: number,
    reason: string,
    actor: TreasuryActor,
  ): Promise<ExpenseLean> {
    const updated = await this.expenses
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(expenseId),
          organizationId,
          revision: expectedRevision,
          status: 'recorded',
          origin: null,
        },
        {
          $set: {
            status: 'cancelled',
            cancelReason: reason,
            cancelledAt: new Date(),
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
        { new: true, session },
      )
      .lean<ExpenseLean>()
      .exec();
    if (!updated) await this.directConflict(organizationId, expenseId, expectedRevision);
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'treasury.expense.cancelled',
        targetType: 'treasury_expense',
        targetId: expenseId,
        metadata: { reason: reason.slice(0, 200) },
      },
      { session },
    );
    return updated as ExpenseLean;
  }

  /**
   * Annulation d'un paiement fournisseur (§ 2.6) : ses dépenses CRÉÉES sont annulées
   * (elles gardent `origin`, donc restent verrouillées) ; une dépense GARDÉE par
   * `from-expense` redevient directe ; une dépense REMPLACÉE est rétablie.
   */
  async releaseFromSupplierPayment(
    session: ClientSession,
    organizationId: string,
    paymentId: string,
    release: { createdIds: string[]; keptId: string | null; replacedId: string | null },
    reason: string,
    actor: TreasuryActor,
  ): Promise<void> {
    const at = new Date();
    if (release.createdIds.length > 0) {
      await this.expenses
        .updateMany(
          {
            organizationId,
            _id: { $in: release.createdIds.map((id) => new Types.ObjectId(id)) },
            'origin.paymentId': paymentId,
            status: 'recorded',
          },
          {
            $set: {
              status: 'cancelled',
              cancelReason: reason,
              cancelledAt: at,
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
    }
    if (release.keptId) {
      await this.expenses
        .updateOne(
          {
            organizationId,
            _id: new Types.ObjectId(release.keptId),
            'origin.paymentId': paymentId,
          },
          { $set: { origin: null, updatedBy: actor.userId }, $inc: { revision: 1 } },
          { session },
        )
        .exec();
    }
    if (release.replacedId) {
      await this.expenses
        .updateOne(
          {
            organizationId,
            _id: new Types.ObjectId(release.replacedId),
            origin: null,
            status: 'cancelled',
          },
          {
            $set: {
              status: 'recorded',
              cancelReason: null,
              cancelledAt: null,
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
    }
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'treasury.expense.released_by_supplier_payment',
        targetType: 'supplier_payment',
        targetId: paymentId,
        metadata: {
          cancelled: release.createdIds.length,
          unlinked: release.keptId,
          restored: release.replacedId,
        },
      },
      { session },
    );
  }

  /** Dépenses par identifiants, de l'organisation (lecture des paiements). */
  async findByIds(organizationId: string, ids: readonly string[]): Promise<ExpenseLean[]> {
    const valid = ids.filter(isMongoId);
    if (valid.length === 0) return [];
    return this.expenses
      .find({ organizationId, _id: { $in: valid.map((id) => new Types.ObjectId(id)) } })
      .lean<ExpenseLean[]>()
      .exec();
  }

  /** Dépenses DIRECTES enregistrées chez des fiches fournisseurs (doublons, O3 c). */
  async directSupplierExpenses(
    organizationId: string,
    supplierIds: readonly string[] | null,
  ): Promise<ExpenseLean[]> {
    return this.expenses
      .find({
        organizationId,
        status: 'recorded',
        origin: null,
        supplierId: supplierIds === null ? { $type: 'string' } : { $in: [...supplierIds] },
      })
      .lean<ExpenseLean[]>()
      .exec();
  }

  /** Raison précise d'un refus d'écriture sur une dépense directe. */
  private async directConflict(
    organizationId: string,
    expenseId: string,
    expectedRevision: number,
  ): Promise<never> {
    const doc = await this.requireOwn(organizationId, expenseId);
    assertNotOwned(doc);
    if (doc.status === 'cancelled') {
      conflict('EXPENSE_CANCELLED', 'Cette dépense est annulée : elle ne se rattache plus.');
    }
    if (doc.revision !== expectedRevision) staleRevision(doc.revision);
    return staleRevision(doc.revision);
  }

  // ─── Pièce justificative ──────────────────────────────────────────────────

  async attach(
    organizationId: string,
    expenseId: string,
    image: ImageAcceptance,
    actor: TreasuryActor,
  ): Promise<ExpenseView> {
    const current = await this.requireOwn(organizationId, expenseId);
    assertNotOwned(current);
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
    assertNotOwned(current);
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

  /**
   * Projet du RUN de l'organisation, non archivé (ADR-0039 § 2.10). Lu par la
   * connexion : la trésorerie n'importe pas le module « work ».
   */
  private async assertWorkProject(organizationId: string, workProjectId: string): Promise<void> {
    const project = Types.ObjectId.isValid(workProjectId)
      ? await this.connection
          .collection(WORK_PROJECTS)
          .findOne(
            { _id: new Types.ObjectId(workProjectId), organizationId },
            { projection: { status: 1 } },
          )
      : null;
    if (!project) {
      notFound('EXPENSE_WORK_PROJECT_UNKNOWN', 'Projet introuvable dans cette organisation.');
    }
    if (project['status'] === 'archived') {
      conflict(
        'WORK_PROJECT_ARCHIVED',
        'Ce projet est archivé : restaurez-le avant d’y rattacher une dépense.',
      );
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

/**
 * ADR-0044 — P5 (§ 2.8) : une dépense créée ou rattachée par un paiement fournisseur
 * appartient aux achats ; la trésorerie la lit, mais ne la modifie pas.
 */
function assertNotOwned(doc: Pick<ExpenseLean, 'origin'>): void {
  if (doc.origin) {
    conflict(
      'EXPENSE_OWNED_BY_PURCHASES',
      `Cette dépense est le paiement fournisseur ${doc.origin.paymentNumber} : modifiez-la ou annulez-la depuis les achats.`,
      { paymentId: doc.origin.paymentId, paymentNumber: doc.origin.paymentNumber },
    );
  }
}

function expenseNotFound(): never {
  notFound('EXPENSE_NOT_FOUND', 'Dépense introuvable.');
}
