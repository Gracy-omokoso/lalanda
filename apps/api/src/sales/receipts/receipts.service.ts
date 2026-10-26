// Encaissements — ADR-0031 § 1.
//
// Chaque écriture (création, modification, annulation) se fait dans UNE
// transaction MongoDB qui :
//   1. relit le règlement des factures lettrées (session) ;
//   2. fait contrôler l'encaissement par le moteur (`checkReceipt`) contre le
//      reste à encaisser de chacune ;
//   3. incrémente `sales_invoice_settlements.revision` de chaque facture touchée :
//      deux transactions concurrentes écrivent le même document, MongoDB en
//      rejoue une, qui relit alors l'état validé par l'autre ;
//   4. écrit l'encaissement et sa trace d'audit.
// Aucune opération sur un montant ici : le moteur décide.

import {
  aggregateReceiptsByMonth,
  checkReceipt,
  RECEIVABLES_VERSION,
  type MonthlyCurrencyTotal,
  type ReceiptIssue,
} from '@lalanda/engine';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { inFiscalTransactionWithReplay } from '../../fiscal/fiscal-transaction.js';
import type { InvoiceActor } from '../invoices/invoice.types.js';
import {
  SalesInvoiceSettlement,
  type SalesInvoiceSettlementDocument,
} from './invoice-settlement.schema.js';
import { kinshasaDayOf } from './kinshasa-day.js';
import {
  SalesReceipt,
  type SalesReceiptDocument,
  type SalesReceiptLean,
  type StoredAllocation,
} from './receipt.schema.js';
import type { ListReceiptsQuery, ReceiptBody } from './receipts.dto.js';
import { SettlementsService } from './settlements.service.js';

export interface ReceiptView {
  id: string;
  status: 'recorded' | 'cancelled';
  receivedOn: string;
  amount: string;
  currency: 'CDF' | 'USD';
  method: string;
  reference: string | null;
  note: string | null;
  accountId: string | null;
  allocations: StoredAllocation[];
  cancellation: { at: string; by: string; reason: string } | null;
  calculationVersion: string;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptsSummary {
  from: string | null;
  to: string | null;
  months: MonthlyCurrencyTotal[];
  version: string;
}

function toView(r: SalesReceiptLean): ReceiptView {
  return {
    id: String(r._id),
    status: r.status,
    receivedOn: r.receivedOn,
    amount: r.amount,
    currency: r.currency,
    method: r.method,
    reference: r.reference,
    note: r.note,
    accountId: r.accountId ?? null,
    allocations: r.allocations.map((a) => ({
      invoiceId: a.invoiceId,
      invoiceNumber: a.invoiceNumber,
      amount: a.amount,
    })),
    cancellation: r.cancellation
      ? {
          at: new Date(r.cancellation.at).toISOString(),
          by: r.cancellation.by,
          reason: r.cancellation.reason,
        }
      : null,
    calculationVersion: r.calculationVersion,
    revision: r.revision,
    createdBy: r.createdBy,
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
  };
}

function receiptNotFound(): never {
  throw new NotFoundException({ code: 'RECEIPT_NOT_FOUND', message: 'Encaissement introuvable.' });
}

function invalidReceipt(issues: readonly ReceiptIssue[]): never {
  throw new UnprocessableEntityException({
    code: 'RECEIPT_INVALID',
    message: 'Encaissement refusé : voir le détail.',
    details: { issues },
  });
}

@Injectable()
export class ReceiptsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SalesReceipt.name) private readonly receipts: Model<SalesReceiptDocument>,
    @InjectModel(SalesInvoiceSettlement.name)
    private readonly settlementDocs: Model<SalesInvoiceSettlementDocument>,
    @Inject(SettlementsService) private readonly settlements: SettlementsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, query: ListReceiptsQuery): Promise<ReceiptView[]> {
    const filter: Record<string, unknown> = { organizationId };
    if (query.status !== 'all') filter['status'] = query.status;
    if (query.invoiceId) filter['invoiceIds'] = query.invoiceId;
    if (query.from || query.to) {
      filter['receivedOn'] = {
        ...(query.from ? { $gte: query.from } : {}),
        ...(query.to ? { $lte: query.to } : {}),
      };
    }
    const docs = (await this.receipts
      .find(filter)
      .sort({ receivedOn: -1, _id: -1 })
      .limit(query.limit)
      .lean()
      .exec()) as unknown as SalesReceiptLean[];
    return docs.map(toView);
  }

  async get(organizationId: string, receiptId: string): Promise<ReceiptView> {
    return toView(await this.load(organizationId, receiptId));
  }

  /** Totaux mensuels par devise des encaissements non annulés (moteur). */
  async summary(
    organizationId: string,
    from: string | undefined,
    to: string | undefined,
  ): Promise<ReceiptsSummary> {
    const filter: Record<string, unknown> = { organizationId, status: 'recorded' };
    if (from || to) {
      filter['receivedOn'] = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    }
    const docs = await this.receipts
      .find(filter, { receivedOn: 1, currency: 1, amount: 1 })
      .lean()
      .exec();
    return {
      from: from ?? null,
      to: to ?? null,
      months: aggregateReceiptsByMonth(
        docs.map((d) => ({ receivedOn: d.receivedOn, currency: d.currency, amount: d.amount })),
      ),
      version: RECEIVABLES_VERSION,
    };
  }

  async create(
    organizationId: string,
    body: ReceiptBody,
    actor: InvoiceActor,
  ): Promise<ReceiptView> {
    const created = await inFiscalTransactionWithReplay(this.connection, async (session) => {
      const allocations = await this.validate(organizationId, body, session, null, []);
      const [doc] = await this.receipts.create(
        [
          {
            organizationId,
            status: 'recorded',
            receivedOn: body.receivedOn,
            amount: body.amount,
            currency: body.currency,
            method: body.method,
            reference: body.reference,
            note: body.note,
            accountId: body.accountId,
            allocations,
            invoiceIds: allocations.map((a) => a.invoiceId),
            cancellation: null,
            calculationVersion: RECEIVABLES_VERSION,
            revision: 1,
            createdBy: actor.userId,
            updatedBy: actor.userId,
            _schemaVersion: 1,
          },
        ],
        { session },
      );
      const id = String(doc!._id);
      await this.trace(organizationId, actor, 'sales.receipt.recorded', id, body, session);
      return id;
    });
    return this.get(organizationId, created);
  }

  async update(
    organizationId: string,
    receiptId: string,
    expectedRevision: number,
    body: ReceiptBody,
    actor: InvoiceActor,
  ): Promise<ReceiptView> {
    await inFiscalTransactionWithReplay(this.connection, async (session) => {
      const current = await this.load(organizationId, receiptId, session);
      this.assertWritable(current, expectedRevision);
      const allocations = await this.validate(
        organizationId,
        body,
        session,
        receiptId,
        current.invoiceIds,
      );
      const res = await this.receipts.updateOne(
        { _id: current._id, organizationId, status: 'recorded', revision: expectedRevision },
        {
          $set: {
            receivedOn: body.receivedOn,
            amount: body.amount,
            currency: body.currency,
            method: body.method,
            reference: body.reference,
            note: body.note,
            accountId: body.accountId,
            allocations,
            invoiceIds: allocations.map((a) => a.invoiceId),
            calculationVersion: RECEIVABLES_VERSION,
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
        { session },
      );
      if (res.modifiedCount !== 1) this.stale(current.revision);
      await this.trace(organizationId, actor, 'sales.receipt.updated', receiptId, body, session);
    });
    return this.get(organizationId, receiptId);
  }

  async cancel(
    organizationId: string,
    receiptId: string,
    expectedRevision: number,
    reason: string,
    actor: InvoiceActor,
  ): Promise<ReceiptView> {
    await inFiscalTransactionWithReplay(this.connection, async (session) => {
      const current = await this.load(organizationId, receiptId, session);
      this.assertWritable(current, expectedRevision);
      await this.lockInvoices(organizationId, current.invoiceIds, session);
      const res = await this.receipts.updateOne(
        { _id: current._id, organizationId, status: 'recorded', revision: expectedRevision },
        {
          $set: {
            status: 'cancelled',
            cancellation: { at: new Date(), by: actor.userId, reason },
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
        { session },
      );
      if (res.modifiedCount !== 1) this.stale(current.revision);
      await this.audit.record(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'sales.receipt.cancelled',
          targetType: 'sales_receipt',
          targetId: receiptId,
          metadata: { amount: current.amount, currency: current.currency, reason },
        },
        { session },
      );
    });
    return this.get(organizationId, receiptId);
  }

  // ── interne ──────────────────────────────────────────────────────────────

  private async load(
    organizationId: string,
    receiptId: string,
    session?: ClientSession,
  ): Promise<SalesReceiptLean> {
    if (!Types.ObjectId.isValid(receiptId)) receiptNotFound();
    const doc = (await this.receipts
      .findOne({ _id: new Types.ObjectId(receiptId), organizationId })
      .session(session ?? null)
      .lean()
      .exec()) as unknown as SalesReceiptLean | null;
    if (!doc) receiptNotFound();
    return doc;
  }

  private assertWritable(current: SalesReceiptLean, expectedRevision: number): void {
    if (current.status === 'cancelled') {
      throw new ConflictException({
        code: 'RECEIPT_CANCELLED',
        message: 'Cet encaissement est annulé : il ne se modifie plus.',
      });
    }
    if (current.revision !== expectedRevision) this.stale(current.revision);
  }

  private stale(currentRevision: number): never {
    throw new ConflictException({
      code: 'STALE_REVISION',
      message: 'Cet encaissement a été modifié entre-temps : rechargez-le avant de continuer.',
      details: { currentRevision },
    });
  }

  /**
   * Contrôles de l'encaissement contre l'état des factures dans la transaction,
   * puis verrou de règlement. Rend les lettrages à stocker.
   */
  private async validate(
    organizationId: string,
    body: ReceiptBody,
    session: ClientSession,
    excludeReceiptId: string | null,
    previousInvoiceIds: readonly string[],
  ): Promise<StoredAllocation[]> {
    const today = this.settlements.today();
    if (body.receivedOn > today) {
      throw new BadRequestException({
        code: 'RECEIPT_DATE_IN_FUTURE',
        message: 'La date de réception ne peut pas être dans le futur.',
      });
    }
    if (body.accountId !== null) {
      await this.assertTreasuryAccount(organizationId, body, session);
    }
    const ids = body.allocations.map((a) => a.invoiceId);
    const contexts = await this.settlements.contexts(organizationId, ids, {
      session,
      ...(excludeReceiptId ? { excludeReceiptId } : {}),
    });
    const outstanding: Record<string, string> = {};
    for (const id of ids) {
      const context = contexts.get(id);
      if (!context) {
        throw new NotFoundException({
          code: 'INVOICE_NOT_FOUND',
          message: 'Facture introuvable.',
          details: { invoiceId: id },
        });
      }
      if (context.applicable !== null) {
        throw new ConflictException({
          code: 'INVOICE_NOT_SETTLEABLE',
          message:
            'On n’encaisse que sur une facture définitive de la série réelle, jamais sur un avoir ni un brouillon.',
          details: { invoiceId: id, reason: context.applicable },
        });
      }
      if (context.invoice.currency !== body.currency) {
        throw new ConflictException({
          code: 'RECEIPT_CURRENCY_MISMATCH',
          message: `La facture est en ${context.invoice.currency} : l’encaissement doit être dans la même devise (aucun taux n’est appliqué).`,
          details: { invoiceId: id, invoiceCurrency: context.invoice.currency },
        });
      }
      const issuedOn = context.invoice.issuedAt ? kinshasaDayOf(context.invoice.issuedAt) : null;
      if (issuedOn !== null && body.receivedOn < issuedOn) {
        throw new UnprocessableEntityException({
          code: 'RECEIPT_BEFORE_INVOICE',
          message: 'La date de réception précède l’émission de la facture.',
          details: { invoiceId: id, issuedOn },
        });
      }
      outstanding[id] = SettlementsService.compute(context, today).outstanding;
    }
    const check = checkReceipt({
      amount: body.amount,
      method: body.method,
      allocations: body.allocations,
      outstandingByInvoice: outstanding,
    });
    if (!check.ok) invalidReceipt(check.issues);
    await this.lockInvoices(organizationId, [...new Set([...ids, ...previousInvoiceIds])], session);
    return body.allocations.map((a) => ({
      invoiceId: a.invoiceId,
      invoiceNumber: contexts.get(a.invoiceId)?.invoice.number ?? null,
      amount: a.amount,
    }));
  }

  /**
   * Compte de trésorerie qui reçoit l'argent (ADR-0034 § 4, amendement du 26 oct.
   * 2026) : de l'organisation (404 sinon), actif, de la devise de l'encaissement,
   * ouvert à la date de réception — mêmes règles qu'une dépense. Lu par la
   * connexion, dans la transaction : le module Ventes ne dépend pas du module
   * Trésorerie, qui lit les encaissements par son port.
   */
  private async assertTreasuryAccount(
    organizationId: string,
    body: ReceiptBody,
    session: ClientSession,
  ): Promise<void> {
    const account = (await this.connection
      .collection('treasury_accounts')
      .findOne(
        { _id: new Types.ObjectId(body.accountId as string), organizationId },
        { projection: { name: 1, currency: 1, active: 1, openingDate: 1 }, session },
      )) as { name: string; currency: string; active: boolean; openingDate: string } | null;
    if (!account) {
      throw new NotFoundException({
        code: 'TREASURY_ACCOUNT_NOT_FOUND',
        message: 'Compte de trésorerie introuvable.',
      });
    }
    if (!account.active) {
      throw new BadRequestException({
        code: 'ACCOUNT_INACTIVE',
        message: `Le compte « ${account.name} » est désactivé.`,
      });
    }
    if (account.currency !== body.currency) {
      throw new BadRequestException({
        code: 'RECEIPT_ACCOUNT_CURRENCY_MISMATCH',
        message: `Le compte « ${account.name} » est tenu en ${account.currency} : l’encaissement doit être dans cette devise (aucun taux n’est appliqué).`,
      });
    }
    if (body.receivedOn < account.openingDate) {
      throw new BadRequestException({
        code: 'RECEIPT_BEFORE_ACCOUNT_OPENING',
        message: `Le compte « ${account.name} » est ouvert depuis le ${account.openingDate} : un encaissement antérieur n’y a pas sa place.`,
      });
    }
  }

  /** Incrémente la révision de règlement des factures : sérialise les écritures concurrentes. */
  private async lockInvoices(
    organizationId: string,
    invoiceIds: readonly string[],
    session: ClientSession,
  ): Promise<void> {
    for (const invoiceId of [...invoiceIds].sort()) {
      await this.settlementDocs.updateOne(
        { organizationId, invoiceId },
        {
          $inc: { revision: 1 },
          $setOnInsert: { dueDate: null, updatedBy: null, _schemaVersion: 1 },
        },
        { upsert: true, session },
      );
    }
  }

  private async trace(
    organizationId: string,
    actor: InvoiceActor,
    action: string,
    receiptId: string,
    body: ReceiptBody,
    session: ClientSession,
  ): Promise<void> {
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action,
        targetType: 'sales_receipt',
        targetId: receiptId,
        metadata: {
          amount: body.amount,
          currency: body.currency,
          method: body.method,
          invoices: body.allocations.length,
        },
      },
      { session },
    );
  }
}
