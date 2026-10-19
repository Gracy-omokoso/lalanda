// Fichier clients — ADR-0022 § S25c.2, § S25c.5, § S25c.6.
//
// Isolation : CHAQUE requête porte `organizationId` de l'organisation active ;
// une fiche d'une autre organisation est « introuvable » (404), jamais
// « interdite ». Écritures concurrentes : `findOneAndUpdate` conditionné par la
// révision ; la perte d'une course répond `409 STALE_REVISION`.
//
// `firstInvoicedAt` n'est JAMAIS écrit ici : seul `SalesUsageService` le pose.

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { Customer, type CustomerDocument } from './customer.schema.js';
import {
  CUSTOMER_TYPE_LABELS,
  type CustomerInput,
  type CustomerType,
  type ListCustomersQuery,
} from './sales.dto.js';
import {
  conflict,
  customerNotFound,
  invalidCursor,
  isDuplicateKey,
  staleRevision,
} from './sales.errors.js';
import {
  afterCursor,
  decodeCursor,
  encodeCursor,
  escapeRegex,
  isObjectIdHex,
  normalizeForSearch,
  searchKeyOf,
} from './search.js';

export interface SalesActor {
  userId: string;
  role: string;
}

export interface CustomerView {
  id: string;
  type: CustomerType;
  typeLabel: string;
  name: string;
  nif: string | null;
  exemptionReference: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  deactivatedAt: string | null;
  invoiced: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerPage {
  items: CustomerView[];
  nextCursor: string | null;
}

type CustomerLean = Customer & { _id: Types.ObjectId };

export function customerView(doc: CustomerLean): CustomerView {
  return {
    id: String(doc._id),
    type: doc.type,
    typeLabel: CUSTOMER_TYPE_LABELS[doc.type],
    name: doc.name,
    nif: doc.nif ?? null,
    exemptionReference: doc.exemptionReference ?? null,
    phone: doc.phone ?? null,
    email: doc.email ?? null,
    address: doc.address ?? null,
    active: doc.active,
    deactivatedAt: doc.deactivatedAt ? doc.deactivatedAt.toISOString() : null,
    invoiced: doc.firstInvoicedAt != null,
    revision: doc.revision,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/** Champs dérivés stockés avec la fiche. */
function derived(input: CustomerInput): { sortName: string; searchKey: string } {
  return {
    sortName: normalizeForSearch(input.name),
    searchKey: searchKeyOf([input.name, input.nif, input.email]),
  };
}

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, query: ListCustomersQuery): Promise<CustomerPage> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.status === 'active') and.push({ active: true });
    if (query.status === 'inactive') and.push({ active: false });
    if (query.type) and.push({ type: query.type });
    if (query.q !== undefined) {
      const term = normalizeForSearch(query.q);
      if (term !== '') and.push({ searchKey: { $regex: escapeRegex(term) } });
    }
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(afterCursor(cursor));
    }

    const docs = await this.customers
      .find({ $and: and })
      .sort({ sortName: 1, _id: 1 })
      .limit(query.limit + 1)
      .lean<CustomerLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(customerView),
      nextCursor:
        docs.length > query.limit && last ? encodeCursor(last.sortName, String(last._id)) : null,
    };
  }

  async get(organizationId: string, customerId: string): Promise<CustomerView> {
    return customerView(await this.requireOwn(organizationId, customerId));
  }

  async create(
    organizationId: string,
    input: CustomerInput,
    actor: SalesActor,
  ): Promise<CustomerView> {
    try {
      const doc = await this.customers.create({
        organizationId,
        ...input,
        ...derived(input),
        active: true,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
      return customerView(doc.toObject() as CustomerLean);
    } catch (err) {
      if (isDuplicateKey(err)) await this.nifConflict(organizationId, input.nif, null);
      throw err;
    }
  }

  async put(
    organizationId: string,
    customerId: string,
    expectedRevision: number,
    input: CustomerInput,
    actor: SalesActor,
  ): Promise<CustomerView> {
    const current = await this.requireOwn(organizationId, customerId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    let updated: CustomerLean | null;
    try {
      updated = await this.customers
        .findOneAndUpdate(
          { _id: current._id, organizationId, revision: expectedRevision },
          {
            $set: { ...input, ...derived(input), updatedBy: actor.userId },
            $inc: { revision: 1 },
          },
          { new: true },
        )
        .lean<CustomerLean>()
        .exec();
    } catch (err) {
      if (isDuplicateKey(err)) await this.nifConflict(organizationId, input.nif, current._id);
      throw err;
    }
    if (!updated) staleRevision((await this.requireOwn(organizationId, customerId)).revision);
    return customerView(updated);
  }

  async setActive(
    organizationId: string,
    customerId: string,
    active: boolean,
    actor: SalesActor,
  ): Promise<CustomerView> {
    const current = await this.requireOwn(organizationId, customerId);
    // Déjà dans l'état demandé : 200 sans écriture (ADR-0022 § S25c.5).
    if (current.active === active) return customerView(current);

    const updated = await this.customers
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: current.revision },
        {
          $set: active
            ? { active: true, deactivatedAt: null, deactivatedBy: null, updatedBy: actor.userId }
            : {
                active: false,
                deactivatedAt: new Date(),
                deactivatedBy: actor.userId,
                updatedBy: actor.userId,
              },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<CustomerLean>()
      .exec();
    if (!updated) {
      const now = await this.requireOwn(organizationId, customerId);
      if (now.active === active) return customerView(now);
      staleRevision(now.revision);
    }

    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: active ? 'customer.reactivated' : 'customer.deactivated',
      targetType: 'customer',
      targetId: String(updated._id),
    });
    return customerView(updated);
  }

  /** Suppression réelle si la fiche n'a jamais été facturée ; sinon 409. */
  async remove(organizationId: string, customerId: string, actor: SalesActor): Promise<void> {
    if (!isObjectIdHex(customerId)) customerNotFound();
    const _id = new Types.ObjectId(customerId);
    const res = await this.customers
      .deleteOne({ _id, organizationId, firstInvoicedAt: null })
      .exec();
    if (res.deletedCount === 0) {
      await this.requireOwn(organizationId, customerId);
      conflict(
        'CUSTOMER_ALREADY_INVOICED',
        'Ce client a déjà été facturé : il ne peut pas être supprimé. Désactivez-le.',
      );
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'customer.deleted',
      targetType: 'customer',
      targetId: customerId,
    });
  }

  private async requireOwn(organizationId: string, customerId: string): Promise<CustomerLean> {
    if (!isObjectIdHex(customerId)) customerNotFound();
    const doc = await this.customers
      .findOne({ _id: new Types.ObjectId(customerId), organizationId })
      .lean<CustomerLean>()
      .exec();
    if (!doc) customerNotFound();
    return doc;
  }

  /** 409 `CUSTOMER_NIF_EXISTS` avec l'identifiant de la fiche existante. */
  private async nifConflict(
    organizationId: string,
    nif: string | null,
    exceptId: Types.ObjectId | null,
  ): Promise<never> {
    const existing =
      nif === null
        ? null
        : await this.customers
            .findOne(
              { organizationId, nif, ...(exceptId ? { _id: { $ne: exceptId } } : {}) },
              { _id: 1 },
            )
            .lean()
            .exec();
    conflict(
      'CUSTOMER_NIF_EXISTS',
      'Un client portant ce NIF existe déjà dans votre organisation.',
      { existingId: existing ? String(existing._id) : null },
    );
  }
}
