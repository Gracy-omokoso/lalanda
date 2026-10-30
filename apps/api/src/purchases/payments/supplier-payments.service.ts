// Paiements fournisseurs, dettes et doublons — ADR-0044 § 2.6, § 3.6, § 6.2, O3.
// ADR-0044 — P5.
//
// Un paiement fournisseur EST une dépense réalisée (O2) : il crée ses dépenses de
// trésorerie DANS SA TRANSACTION, par `TreasuryExpensesService` (seul écrivain de
// `treasury_expenses`), une par part d'imputation de coût de chaque facture
// (`splitAllocation`, plus fort reste, somme exacte au centime). Ces dépenses sont
// POSSÉDÉES par les achats (`origin`) : la trésorerie les lit, sans les modifier.
//
// Une dépense directe déjà saisie peut devenir le paiement d'une facture
// (`from-expense`, O3 b) : GARDÉE (une facture, une imputation : elle reçoit
// `origin` et la fiche) ou REMPLACÉE par les parts (dépense d'origine annulée avec
// le motif « Rattachée au paiement PF… ») — jamais recopiée : aucun double comptage
// dans le réalisé, les soldes, la marge ni la prévision.
//
// Tous les montants viennent du moteur (`checkSupplierPayment`, `payableSettlement`,
// `splitAllocation`, `payablesSchedule`, `payablesAging`, `possibleDuplicateExpenses`).
// Isolation : toute ressource d'une autre organisation répond 404, y compris par
// identifiant forgé dans un corps (`supplierId`, `invoiceId`, `accountId`, `expenseId`).
//
// Concurrence : la transaction TOUCHE d'abord les factures imputées (écriture de
// `updatedAt`) puis relit leur reste à payer : deux paiements simultanés de la même
// facture entrent en conflit d'écriture, le second est rejoué et voit le premier.

import {
  checkSupplierPayment,
  PURCHASES_VERSION,
  payablesAging,
  payablesSchedule,
  possibleDuplicateExpenses,
  splitAllocation,
  payableSettlement,
  type ExpenseCategory,
  type SupplierPaymentIssue,
} from '@lalanda/engine';
import type {
  CreateSupplierPaymentBody,
  ListSupplierPaymentsQuery,
  PayableInvoiceItem,
  PayablesQuery,
  PayablesView,
  PurchaseDuplicatesView,
  SupplierPaymentChannel,
  SupplierPaymentFromExpenseBody,
  SupplierPaymentListItem,
  SupplierPaymentPage,
  SupplierPaymentView,
} from '@lalanda/shared/purchases';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { invalidCursor, staleRevision } from '../../sales/sales.errors.js';
import {
  TreasuryExpensesService,
  type ExpenseLean,
} from '../../treasury/treasury-expenses.service.js';
import type { ExpenseOrigin } from '../../treasury/treasury.schemas.js';
import { PurchaseCountersService } from '../counters/purchase-counters.service.js';
import {
  assertNotFuture,
  beforeKeyCursor,
  conflict,
  decodeKeyCursor,
  encodeKeyCursor,
  isOid,
  notFound,
  oid,
  todayInKinshasa,
  type PurchaseActor,
} from '../invoices/purchase-p4.common.js';
import { PurchaseSettingsService } from '../settings/purchase-settings.service.js';
import {
  INVOICES,
  readInvoices,
  readValidatedInvoices,
  settlementsOf,
  supplierNamesOf,
  type InvoiceSettlement,
  type PayableInvoiceDoc,
} from './payable-settlements.js';
import {
  SupplierPayment,
  type SupplierPaymentDocument,
  type SupplierPaymentLean,
} from './supplier-payment.schema.js';

const SUPPLIERS = 'suppliers';
const LABEL_MAX = 200;

/** Codes du moteur qui disent un conflit avec l'état (et non une saisie invalide). */
const CONFLICT_ISSUES = new Set(['SUPPLIER_PAYMENT_EXCEEDS_REMAINING']);

interface Allocation {
  invoiceId: string;
  amount: string;
}

/** Une dépense à créer : montants rendus par le moteur. */
interface ExpensePart {
  invoice: PayableInvoiceDoc;
  allocationIndex: number;
  amount: string;
  deductibleVat: string | null;
}

interface SupplierCard {
  id: string;
  name: string;
  paymentMethodIds: string[];
}

@Injectable()
export class SupplierPaymentsService {
  constructor(
    @InjectModel(SupplierPayment.name) private readonly payments: Model<SupplierPaymentDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(TreasuryExpensesService) private readonly expenses: TreasuryExpensesService,
    @Inject(PurchaseCountersService) private readonly counters: PurchaseCountersService,
    @Inject(PurchaseSettingsService) private readonly settings: PurchaseSettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Enregistrer ──────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    input: CreateSupplierPaymentBody,
    actor: PurchaseActor,
  ): Promise<SupplierPaymentView> {
    assertNotFuture(input.paidOn, 'paidOn');
    const supplier = await this.requireSupplier(organizationId, input.supplierId);
    const paymentMethodId = input.paymentMethodId ?? null;
    if (paymentMethodId !== null && !supplier.paymentMethodIds.includes(paymentMethodId)) {
      notFound(
        'SUPPLIER_PAYMENT_METHOD_NOT_FOUND',
        'Ce moyen de paiement n’existe pas sur la fiche du fournisseur.',
      );
    }
    const invoices = await this.requirePayableInvoices(
      organizationId,
      input.allocations,
      supplier.id,
    );
    const currency = this.commonCurrency(invoices);
    await this.checkAgainstRemaining(organizationId, input.amount, input.allocations, invoices);

    const now = new Date();
    const paymentId = new Types.ObjectId();
    const saved = await this.inTransaction(async (session) => {
      await this.lockInvoices(organizationId, invoices, session);
      await this.checkAgainstRemaining(
        organizationId,
        input.amount,
        input.allocations,
        invoices,
        session,
      );
      const number = await this.counters.next(organizationId, 'payment', now, session);
      const origin = (inv: PayableInvoiceDoc, allocationIndex: number): ExpenseOrigin => ({
        kind: 'supplier_payment',
        paymentId: String(paymentId),
        paymentNumber: number,
        invoiceId: String(inv._id),
        allocationIndex,
      });
      const expenseIds: string[] = [];
      for (const part of this.partsOf(input.allocations, invoices)) {
        const expense = await this.expenses.recordOwnedBySupplierPayment(session, {
          organizationId,
          spentOn: input.paidOn,
          amount: part.amount,
          currency,
          category: part.invoice.costAllocations[part.allocationIndex]!.category as ExpenseCategory,
          label: expenseLabel(part.invoice),
          supplierId: supplier.id,
          supplierName: supplier.name,
          accountId: input.accountId ?? null,
          deductibleVat: part.deductibleVat,
          reference: input.reference ?? null,
          workProjectId: part.invoice.costAllocations[part.allocationIndex]!.workProjectId ?? null,
          origin: origin(part.invoice, part.allocationIndex),
          actor,
        });
        expenseIds.push(String(expense._id));
      }
      const [doc] = await this.payments.create(
        [
          {
            _id: paymentId,
            organizationId,
            number,
            supplierId: supplier.id,
            currency,
            paidOn: input.paidOn,
            amount: input.amount,
            accountId: input.accountId ?? null,
            method: input.method,
            paymentMethodId,
            reference: input.reference ?? null,
            allocations: input.allocations.map((a) => ({
              invoiceId: a.invoiceId,
              amount: a.amount,
            })),
            expenseIds,
            origin: 'recorded',
            linkedExpense: null,
            status: 'recorded',
            cancellation: null,
            revision: 1,
            createdBy: actor.userId,
            updatedBy: actor.userId,
            _schemaVersion: 1,
          },
        ],
        { session },
      );
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'supplier_payment.recorded',
          targetType: 'supplier_payment',
          targetId: String(paymentId),
          metadata: {
            number,
            supplierId: supplier.id,
            currency,
            amount: input.amount,
            accountId: input.accountId ?? null,
            method: input.method,
            origin: 'recorded',
            allocations: input.allocations,
            expenseIds,
          },
        },
        { session },
      );
      return doc!.toObject() as SupplierPaymentLean;
    });
    return this.viewOf(organizationId, saved);
  }

  /**
   * `from-expense` (O3 b) : la dépense directe DEVIENT le paiement ; son montant, sa
   * devise, sa date, son compte et sa référence font foi.
   */
  async fromExpense(
    organizationId: string,
    input: SupplierPaymentFromExpenseBody,
    actor: PurchaseActor,
  ): Promise<SupplierPaymentView> {
    const expense = await this.expenses.requireOwn(organizationId, input.expenseId);
    if (expense.origin) {
      conflict(
        'EXPENSE_OWNED_BY_PURCHASES',
        `Cette dépense est déjà le paiement fournisseur ${expense.origin.paymentNumber}.`,
        { paymentId: expense.origin.paymentId },
      );
    }
    if (expense.status === 'cancelled') {
      conflict('EXPENSE_CANCELLED', 'Cette dépense est annulée : elle ne se rattache plus.');
    }
    if (expense.revision !== input.expectedRevision) staleRevision(expense.revision);
    const invoices = await this.requirePayableInvoices(organizationId, input.allocations, null);
    const supplierIds = new Set(invoices.map((i) => i.supplierId));
    if (supplierIds.size !== 1) {
      conflict(
        'SUPPLIER_PAYMENT_SUPPLIER_MISMATCH',
        'Un paiement ne règle que les factures d’un seul fournisseur.',
      );
    }
    const supplier = await this.requireSupplier(organizationId, invoices[0]!.supplierId);
    if (expense.supplierId && expense.supplierId !== supplier.id) {
      conflict(
        'EXPENSE_SUPPLIER_MISMATCH',
        'Cette dépense est rattachée à un autre fournisseur que celui des factures.',
        { expenseSupplierId: expense.supplierId, supplierId: supplier.id },
      );
    }
    const currency = this.commonCurrency(invoices);
    if (expense.currency !== currency) {
      conflict(
        'SUPPLIER_PAYMENT_CURRENCY_MISMATCH',
        'La dépense et les factures ne sont pas dans la même devise : aucune conversion n’est faite.',
      );
    }
    await this.checkAgainstRemaining(organizationId, expense.amount, input.allocations, invoices);
    const firstInvoice = invoices.find((i) => String(i._id) === input.allocations[0]!.invoiceId)!;
    const mode: 'kept' | 'replaced' =
      input.allocations.length === 1 && firstInvoice.costAllocations.length === 1
        ? 'kept'
        : 'replaced';
    const method: SupplierPaymentChannel = input.method ?? 'other';

    const now = new Date();
    const paymentId = new Types.ObjectId();
    const saved = await this.inTransaction(async (session) => {
      await this.lockInvoices(organizationId, invoices, session);
      await this.checkAgainstRemaining(
        organizationId,
        expense.amount,
        input.allocations,
        invoices,
        session,
      );
      const number = await this.counters.next(organizationId, 'payment', now, session);
      const expenseIds: string[] = [];
      if (mode === 'kept') {
        await this.expenses.linkToSupplierPayment(
          session,
          organizationId,
          input.expenseId,
          input.expectedRevision,
          {
            origin: {
              kind: 'supplier_payment',
              paymentId: String(paymentId),
              paymentNumber: number,
              invoiceId: String(firstInvoice._id),
              allocationIndex: 0,
            },
            supplierId: supplier.id,
            supplierName: supplier.name,
          },
          actor,
        );
        expenseIds.push(input.expenseId);
      } else {
        await this.expenses.replaceBySupplierPayment(
          session,
          organizationId,
          input.expenseId,
          input.expectedRevision,
          `Rattachée au paiement ${number}`,
          actor,
        );
        for (const part of this.partsOf(input.allocations, invoices)) {
          const allocation = part.invoice.costAllocations[part.allocationIndex]!;
          const created = await this.expenses.recordOwnedBySupplierPayment(session, {
            organizationId,
            spentOn: expense.spentOn,
            amount: part.amount,
            currency,
            category: allocation.category as ExpenseCategory,
            label: expenseLabel(part.invoice),
            supplierId: supplier.id,
            supplierName: supplier.name,
            accountId: expense.accountId ?? null,
            deductibleVat: part.deductibleVat,
            reference: expense.reference ?? null,
            workProjectId: allocation.workProjectId ?? null,
            origin: {
              kind: 'supplier_payment',
              paymentId: String(paymentId),
              paymentNumber: number,
              invoiceId: String(part.invoice._id),
              allocationIndex: part.allocationIndex,
            },
            actor,
          });
          expenseIds.push(String(created._id));
        }
      }
      const [doc] = await this.payments.create(
        [
          {
            _id: paymentId,
            organizationId,
            number,
            supplierId: supplier.id,
            currency,
            paidOn: expense.spentOn,
            amount: expense.amount,
            accountId: expense.accountId ?? null,
            method,
            paymentMethodId: null,
            reference: expense.reference ?? null,
            allocations: input.allocations.map((a) => ({
              invoiceId: a.invoiceId,
              amount: a.amount,
            })),
            expenseIds,
            origin: 'linked_expense',
            linkedExpense: { id: input.expenseId, mode },
            status: 'recorded',
            cancellation: null,
            revision: 1,
            createdBy: actor.userId,
            updatedBy: actor.userId,
            _schemaVersion: 1,
          },
        ],
        { session },
      );
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'supplier_payment.recorded',
          targetType: 'supplier_payment',
          targetId: String(paymentId),
          metadata: {
            number,
            supplierId: supplier.id,
            currency,
            amount: expense.amount,
            accountId: expense.accountId ?? null,
            method,
            origin: 'linked_expense',
            linkedExpense: { id: input.expenseId, mode },
            allocations: input.allocations,
            expenseIds,
          },
        },
        { session },
      );
      return doc!.toObject() as SupplierPaymentLean;
    });
    return this.viewOf(organizationId, saved);
  }

  /**
   * Annulation (§ 2.6) : le paiement et, dans la même transaction, les dépenses qu'il
   * a créées ; une dépense rattachée redevient directe (gardée) ou est rétablie
   * (remplacée).
   */
  async cancel(
    organizationId: string,
    paymentId: string,
    reason: string,
    expectedRevision: number,
    actor: PurchaseActor,
  ): Promise<SupplierPaymentView> {
    const current = await this.requireOwn(organizationId, paymentId);
    if (current.status === 'cancelled') {
      conflict('SUPPLIER_PAYMENT_CANCELLED', 'Ce paiement est déjà annulé.');
    }
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    const linked = current.linkedExpense ?? null;
    const saved = await this.inTransaction(async (session) => {
      const doc = await this.payments
        .findOneAndUpdate(
          { _id: current._id, organizationId, revision: expectedRevision, status: 'recorded' },
          {
            $set: {
              status: 'cancelled',
              cancellation: { at: new Date(), by: actor.userId, reason },
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { new: true, session },
        )
        .lean<SupplierPaymentLean>()
        .exec();
      if (!doc) staleRevision((await this.requireOwn(organizationId, paymentId)).revision);
      await this.expenses.releaseFromSupplierPayment(
        session,
        organizationId,
        paymentId,
        {
          createdIds: linked?.mode === 'kept' ? [] : current.expenseIds,
          keptId: linked?.mode === 'kept' ? linked.id : null,
          replacedId: linked?.mode === 'replaced' ? linked.id : null,
        },
        `Paiement ${current.number} annulé : ${reason}`.slice(0, 300),
        actor,
      );
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'supplier_payment.cancelled',
          targetType: 'supplier_payment',
          targetId: paymentId,
          metadata: {
            number: current.number,
            reason,
            amount: current.amount,
            currency: current.currency,
            expenseIds: current.expenseIds,
            linkedExpense: linked ? { id: linked.id, mode: linked.mode } : null,
          },
        },
        { session },
      );
      return doc;
    });
    return this.viewOf(organizationId, saved);
  }

  // ── Lire ─────────────────────────────────────────────────────────────────

  async get(organizationId: string, paymentId: string): Promise<SupplierPaymentView> {
    return this.viewOf(organizationId, await this.requireOwn(organizationId, paymentId));
  }

  async list(
    organizationId: string,
    query: ListSupplierPaymentsQuery,
  ): Promise<SupplierPaymentPage> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.supplierId) and.push({ supplierId: query.supplierId });
    if (query.invoiceId) and.push({ 'allocations.invoiceId': query.invoiceId });
    if (query.status) and.push({ status: query.status });
    if (query.from) and.push({ paidOn: { $gte: query.from } });
    if (query.to) and.push({ paidOn: { $lte: query.to } });
    if (query.cursor !== undefined) {
      const c = decodeKeyCursor(query.cursor);
      if (c === null) invalidCursor();
      and.push(beforeKeyCursor('paidOn', c));
    }
    const docs = await this.payments
      .find({ $and: and })
      .sort({ paidOn: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<SupplierPaymentLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    const [names, invoices] = await Promise.all([
      supplierNamesOf(
        this.connection,
        organizationId,
        page.map((p) => p.supplierId),
      ),
      this.invoiceRefs(
        organizationId,
        page.flatMap((p) => p.allocations.map((a) => a.invoiceId)),
      ),
    ]);
    return {
      items: page.map((p) => this.listItemOf(p, names, invoices)),
      nextCursor:
        docs.length > query.limit && last ? encodeKeyCursor(last.paidOn, String(last._id)) : null,
    };
  }

  /**
   * Échéancier des dettes (§ 3.6) : factures validées au reste non nul, par devise,
   * en retard, bientôt, semaines puis mois (`payablesSchedule`) et ancienneté
   * (`payablesAging`) ; litiges à part.
   */
  async payables(
    organizationId: string,
    query: PayablesQuery,
    opts: { withDuplicates: boolean },
  ): Promise<PayablesView> {
    const asOf = query.asOf ?? todayInKinshasa();
    const effective = await this.settings.effective(organizationId);
    const invoices = await readValidatedInvoices(this.connection, organizationId, query.supplierId);
    const [settlements, names] = await Promise.all([
      settlementsOf(this.connection, organizationId, invoices),
      supplierNamesOf(
        this.connection,
        organizationId,
        invoices.map((i) => i.supplierId),
      ),
    ]);
    const open = invoices
      .map((inv) => ({ inv, s: settlements.get(String(inv._id)) }))
      .filter((x): x is { inv: PayableInvoiceDoc; s: InvoiceSettlement } =>
        Boolean(x.s && x.s.remaining !== '0.00'),
      );
    const inputs = open.map(({ inv, s }) => ({
      id: String(inv._id),
      currency: inv.currency,
      dueDate: inv.dueDate,
      remaining: s.remaining,
      disputed: inv.disputed !== null && inv.disputed !== undefined,
    }));
    const schedule = payablesSchedule(inputs, asOf, effective.dueSoonDays);
    const aging = payablesAging(inputs, asOf);
    let duplicates: PayablesView['duplicates'] = { status: 'hidden', count: 0 };
    if (opts.withDuplicates) {
      const found = await this.duplicates(organizationId, { supplierId: query.supplierId });
      duplicates = {
        status: found.duplicates.length > 0 ? 'known' : 'empty',
        count: found.duplicates.length,
      };
    }
    const items: PayableInvoiceItem[] = open.map(({ inv, s }) => ({
      id: String(inv._id),
      internalNumber: inv.internalNumber,
      supplierId: inv.supplierId,
      supplierName: names.get(inv.supplierId) ?? null,
      supplierReference: inv.supplierReference,
      currency: inv.currency,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      total: inv.total,
      paid: s.paid,
      credited: s.credited,
      remaining: s.remaining,
      settlementStatus: s.status,
      disputed: inv.disputed !== null && inv.disputed !== undefined,
      overdue: inv.dueDate < asOf,
    }));
    return {
      version: schedule.version,
      asOf: schedule.asOf,
      dueSoonDays: schedule.dueSoonDays,
      dueSoonUntil: schedule.dueSoonUntil,
      schedule: schedule.byCurrency,
      aging: aging.byCurrency,
      invoices: items,
      duplicates,
    };
  }

  /**
   * Doublons probables (O3 c) : paiement SAISI dans les achats ↔ dépense DIRECTE chez
   * la même fiche, même devise, même montant, à trois jours ou moins
   * (`possibleDuplicateExpenses`). Signalés, jamais annulés.
   */
  async duplicates(
    organizationId: string,
    query: { supplierId?: string | undefined },
  ): Promise<PurchaseDuplicatesView> {
    const payments = await this.payments
      .find({
        organizationId,
        status: 'recorded',
        origin: 'recorded',
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      })
      .lean<SupplierPaymentLean[]>()
      .exec();
    const supplierIds = [...new Set(payments.map((p) => p.supplierId))];
    const expenses: ExpenseLean[] =
      supplierIds.length === 0
        ? []
        : await this.expenses.directSupplierExpenses(organizationId, supplierIds);
    const result = possibleDuplicateExpenses(
      payments.map((p) => ({
        id: String(p._id),
        supplierId: p.supplierId,
        currency: p.currency,
        amount: p.amount,
        paidOn: p.paidOn,
      })),
      expenses.map((e) => ({
        id: String(e._id),
        supplierId: e.supplierId ?? null,
        currency: e.currency,
        amount: e.amount,
        spentOn: e.spentOn,
      })),
    );
    const byPayment = new Map(payments.map((p) => [String(p._id), p]));
    const byExpense = new Map(expenses.map((e) => [String(e._id), e]));
    const names = await supplierNamesOf(this.connection, organizationId, supplierIds);
    return {
      version: result.version,
      windowDays: result.windowDays,
      duplicates: result.duplicates.map((d) => ({
        ...d,
        paymentNumber: byPayment.get(d.paymentId)?.number ?? null,
        paidOn: byPayment.get(d.paymentId)?.paidOn ?? null,
        spentOn: byExpense.get(d.expenseId)?.spentOn ?? null,
        expenseLabel: byExpense.get(d.expenseId)?.label ?? null,
        supplierName: names.get(d.supplierId) ?? null,
      })),
    };
  }

  // ── Contrôles ────────────────────────────────────────────────────────────

  async requireOwn(organizationId: string, paymentId: string): Promise<SupplierPaymentLean> {
    const doc = isOid(paymentId)
      ? await this.payments
          .findOne({ _id: oid(paymentId), organizationId })
          .lean<SupplierPaymentLean>()
          .exec()
      : null;
    if (!doc) notFound('SUPPLIER_PAYMENT_NOT_FOUND', 'Paiement fournisseur introuvable.');
    return doc;
  }

  private async requireSupplier(organizationId: string, supplierId: string): Promise<SupplierCard> {
    const doc = isOid(supplierId)
      ? await this.connection
          .collection(SUPPLIERS)
          .findOne(
            { _id: oid(supplierId), organizationId },
            { projection: { name: 1, mergedInto: 1, 'paymentMethods.id': 1 } },
          )
      : null;
    if (!doc) notFound('SUPPLIER_NOT_FOUND', 'Fournisseur introuvable.');
    if (doc['mergedInto']) {
      conflict('SUPPLIER_MERGED', 'Ce fournisseur a été fusionné dans une autre fiche.', {
        mergedInto: String(doc['mergedInto']),
      });
    }
    return {
      id: String(doc._id),
      name: String(doc['name']),
      paymentMethodIds: ((doc['paymentMethods'] ?? []) as { id: string }[]).map((m) => m.id),
    };
  }

  /**
   * Factures imputées : de l'organisation (404 sinon), validées, de type `invoice`,
   * non en litige, du fournisseur du paiement (`supplierId` posé), même devise.
   */
  private async requirePayableInvoices(
    organizationId: string,
    allocations: readonly Allocation[],
    supplierId: string | null,
  ): Promise<PayableInvoiceDoc[]> {
    const docs = await readInvoices(
      this.connection,
      organizationId,
      allocations.map((a) => a.invoiceId),
    );
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    return allocations.map((a, index) => {
      const inv = byId.get(a.invoiceId);
      if (!inv) {
        notFound('SUPPLIER_INVOICE_NOT_FOUND', 'Facture fournisseur introuvable.');
      }
      if (inv.kind !== 'invoice' || inv.status !== 'validated') {
        conflict(
          'SUPPLIER_INVOICE_NOT_PAYABLE',
          'Seule une facture fournisseur validée se paie (ni brouillon, ni avoir, ni facture annulée).',
          { invoiceId: a.invoiceId, allocationIndex: index },
        );
      }
      if (inv.disputed) {
        conflict(
          'SUPPLIER_INVOICE_DISPUTED',
          'Cette facture est en litige : réglez le litige avant de la payer.',
          { invoiceId: a.invoiceId },
        );
      }
      if (supplierId !== null && inv.supplierId !== supplierId) {
        conflict(
          'SUPPLIER_PAYMENT_SUPPLIER_MISMATCH',
          'Cette facture appartient à un autre fournisseur que celui du paiement.',
          { invoiceId: a.invoiceId },
        );
      }
      return inv;
    });
  }

  private commonCurrency(invoices: readonly PayableInvoiceDoc[]): 'CDF' | 'USD' {
    const currencies = new Set(invoices.map((i) => i.currency));
    if (currencies.size !== 1) {
      conflict(
        'SUPPLIER_PAYMENT_CURRENCY_MISMATCH',
        'Un paiement règle des factures d’une seule devise : aucune conversion n’est faite.',
      );
    }
    return invoices[0]!.currency;
  }

  /** Σ des imputations = montant, aucune au-delà du reste à payer (moteur). */
  private async checkAgainstRemaining(
    organizationId: string,
    amount: string,
    allocations: readonly Allocation[],
    invoices: readonly PayableInvoiceDoc[],
    session?: ClientSession,
  ): Promise<void> {
    const settlements = await settlementsOf(this.connection, organizationId, invoices, session);
    const remainingByInvoice: Record<string, string> = {};
    for (const inv of invoices) {
      remainingByInvoice[String(inv._id)] = settlements.get(String(inv._id))?.remaining ?? '0.00';
    }
    const check = checkSupplierPayment({ amount, allocations, remainingByInvoice });
    if (check.ok) return;
    throw paymentIssue(check.issues[0]!, check.issues);
  }

  /**
   * Conflit d'écriture volontaire sur les factures imputées (voir l'en-tête) ; une
   * facture annulée ou mise en litige entre-temps fait échouer le paiement.
   */
  private async lockInvoices(
    organizationId: string,
    invoices: readonly PayableInvoiceDoc[],
    session: ClientSession,
  ): Promise<void> {
    const res = await this.connection.collection(INVOICES).updateMany(
      {
        organizationId,
        _id: { $in: invoices.map((i) => i._id) },
        status: 'validated',
        disputed: null,
      },
      { $currentDate: { updatedAt: true } },
      { session },
    );
    if (res.matchedCount !== new Set(invoices.map((i) => String(i._id))).size) {
      conflict(
        'SUPPLIER_INVOICE_NOT_PAYABLE',
        'Une facture imputée a changé entre-temps (annulée ou en litige) : rechargez-la.',
      );
    }
  }

  /**
   * Parts de dépense (§ 6.2) : le montant imputé à chaque facture, réparti au prorata
   * de ses imputations de coût (`splitAllocation`) ; la TVA déductible DÉCLARÉE de la
   * facture, répartie de même au prorata du montant payé (aucun calcul de
   * déductibilité : simple répartition d'un montant saisi). Une part nulle ne crée
   * pas de dépense.
   */
  private partsOf(
    allocations: readonly Allocation[],
    invoices: readonly PayableInvoiceDoc[],
  ): ExpensePart[] {
    const byId = new Map(invoices.map((i) => [String(i._id), i]));
    const parts: ExpensePart[] = [];
    for (const a of allocations) {
      const inv = byId.get(a.invoiceId)!;
      const shares = splitAllocation(a.amount, inv.costAllocations).shares;
      let vatShares: string[] | null = null;
      if (inv.deductibleVat !== null && inv.deductibleVat !== undefined) {
        // Part de la TVA déclarée qui revient au montant payé : poids « payé » et
        // « reste de la facture après ce paiement » (moteur).
        const restAfter = payableSettlement({ total: inv.total }, [a.amount], []).remaining;
        const paidVat = splitAllocation(inv.deductibleVat, [
          { amount: a.amount },
          { amount: restAfter },
        ]).shares[0]!;
        vatShares = splitAllocation(paidVat, inv.costAllocations).shares;
      }
      shares.forEach((amount, allocationIndex) => {
        if (amount === '0.00') return;
        parts.push({
          invoice: inv,
          allocationIndex,
          amount,
          deductibleVat: vatShares ? (vatShares[allocationIndex] ?? null) : null,
        });
      });
    }
    return parts;
  }

  // ── Vues ─────────────────────────────────────────────────────────────────

  private async invoiceRefs(
    organizationId: string,
    ids: readonly string[],
  ): Promise<Map<string, { internalNumber: string; supplierReference: string }>> {
    const docs = await readInvoices(this.connection, organizationId, ids);
    return new Map(
      docs.map((d) => [
        String(d._id),
        { internalNumber: d.internalNumber, supplierReference: d.supplierReference },
      ]),
    );
  }

  private listItemOf(
    p: SupplierPaymentLean,
    names: Map<string, string>,
    invoices: Map<string, { internalNumber: string; supplierReference: string }>,
  ): SupplierPaymentListItem {
    return {
      id: String(p._id),
      number: p.number,
      supplierId: p.supplierId,
      supplierName: names.get(p.supplierId) ?? null,
      currency: p.currency,
      paidOn: p.paidOn,
      amount: p.amount,
      accountId: p.accountId ?? null,
      method: p.method,
      reference: p.reference ?? null,
      origin: p.origin,
      status: p.status,
      allocations: p.allocations.map((a) => ({
        invoiceId: a.invoiceId,
        internalNumber: invoices.get(a.invoiceId)?.internalNumber ?? null,
        supplierReference: invoices.get(a.invoiceId)?.supplierReference ?? null,
        amount: a.amount,
      })),
      updatedAt: new Date(p.updatedAt).toISOString(),
    };
  }

  private async viewOf(
    organizationId: string,
    p: SupplierPaymentLean,
  ): Promise<SupplierPaymentView> {
    const [names, invoices, expenses] = await Promise.all([
      supplierNamesOf(this.connection, organizationId, [p.supplierId]),
      this.invoiceRefs(
        organizationId,
        p.allocations.map((a) => a.invoiceId),
      ),
      this.expenses.findByIds(organizationId, p.expenseIds),
    ]);
    const byId = new Map(expenses.map((e) => [String(e._id), e]));
    return {
      ...this.listItemOf(p, names, invoices),
      paymentMethodId: p.paymentMethodId ?? null,
      expenseIds: [...p.expenseIds],
      expenses: p.expenseIds
        .map((id) => byId.get(id))
        .filter((e): e is ExpenseLean => e !== undefined)
        .map((e) => ({
          id: String(e._id),
          invoiceId: e.origin?.invoiceId ?? null,
          allocationIndex: e.origin?.allocationIndex ?? null,
          amount: e.amount,
          category: e.category,
          workProjectId: e.workProjectId ?? null,
          status: e.status,
        })),
      linkedExpense: p.linkedExpense ?? null,
      cancellation: p.cancellation
        ? {
            at: new Date(p.cancellation.at).toISOString(),
            by: p.cancellation.by,
            reason: p.cancellation.reason,
          }
        : null,
      revision: p.revision,
      createdBy: p.createdBy,
      createdAt: new Date(p.createdAt).toISOString(),
    };
  }

  private async inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let out!: T;
      await session.withTransaction(async () => {
        out = await fn(session);
      });
      return out;
    } finally {
      await session.endSession();
    }
  }
}

/** « Paiement FF… — <référence fournisseur> » (§ 6.2), borné au libellé d'une dépense. */
function expenseLabel(inv: Pick<PayableInvoiceDoc, 'internalNumber' | 'supplierReference'>) {
  return `Paiement ${inv.internalNumber} — ${inv.supplierReference}`.slice(0, LABEL_MAX);
}

/** Refus du moteur au format des contrôleurs : 409 pour un conflit d'état, 400 sinon. */
function paymentIssue(first: SupplierPaymentIssue, all: SupplierPaymentIssue[]): Error {
  const body = {
    code: first.code,
    message: first.message,
    details: { issues: all, engineVersion: PURCHASES_VERSION },
  };
  return CONFLICT_ISSUES.has(first.code)
    ? new ConflictException(body)
    : new BadRequestException(body);
}
