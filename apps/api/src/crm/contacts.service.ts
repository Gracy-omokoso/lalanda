// Contacts et prospects — ADR-0035 § 2 ; comptes 360° — ADR-0040 § 2.2 (C1).
//
// ADR-0040 — C1 : une personne est rattachée à un COMPTE (`accountId`, prospect
// ou client). `customerId` et `companyName` sont recopiés du compte ; un corps qui
// les envoie sans `accountId` est résolu par `CrmAccountsService.resolveLegacy`
// (compatibilité N-1, une version).
//
// Un contact est une personne. Rattaché à un client de l'organisation
// (`customerId`), c'est un contact client ; sans client, c'est un PROSPECT, qui
// porte le nom de son entreprise (`companyName`). Isolation : chaque requête
// porte `organizationId` ; un client ou un contact d'une autre organisation est
// introuvable (404).

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
// ADR-0040 — C1
import { CrmAccountsService } from './accounts/crm-accounts.service.js';
import { contactDenormOf } from './accounts/crm-accounts.denorm.js';
import { Customer, type CustomerDocument } from '../sales/customer.schema.js';
import { conflict, customerNotFound, invalidCursor, staleRevision } from '../sales/sales.errors.js';
import {
  afterCursor,
  decodeCursor,
  encodeCursor,
  escapeRegex,
  isObjectIdHex,
  normalizeForSearch,
  searchKeyOf,
} from '../sales/search.js';
import type { CrmActor } from './crm-settings.service.js';
import type { ContactInput, ListContactsQuery } from './crm.dto.js';
import { contactNotFound } from './crm.errors.js';
import {
  CrmActivity,
  CrmContact,
  CrmOpportunity,
  type CrmActivityDocument,
  type CrmContactDocument,
  type CrmOpportunityDocument,
} from './crm.schemas.js';

export type ContactLean = CrmContact & { _id: Types.ObjectId };
type CustomerLean = Customer & { _id: Types.ObjectId };

export interface ContactView {
  id: string;
  kind: 'customer_contact' | 'prospect';
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  /** ADR-0040 — C1 : compte de la personne, `null` sans entreprise. */
  accountId: string | null;
  accountName: string | null;
  customerId: string | null;
  customerName: string | null;
  companyName: string | null;
  notes: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContactPage {
  items: ContactView[];
  nextCursor: string | null;
}

@Injectable()
export class ContactsService {
  constructor(
    @InjectModel(CrmContact.name) private readonly contacts: Model<CrmContactDocument>,
    @InjectModel(CrmOpportunity.name)
    private readonly opportunities: Model<CrmOpportunityDocument>,
    @InjectModel(CrmActivity.name) private readonly activities: Model<CrmActivityDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CrmAccountsService) private readonly accounts: CrmAccountsService,
  ) {}

  // ── Lecture ──────────────────────────────────────────────────────────────

  async list(organizationId: string, query: ListContactsQuery): Promise<ContactPage> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.customerId) and.push({ customerId: query.customerId.toLowerCase() });
    if (query.accountId) and.push({ accountId: query.accountId.toLowerCase() });
    if (query.kind === 'prospect') and.push({ customerId: null });
    if (query.kind === 'customer_contact') and.push({ customerId: { $type: 'string' } });
    if (query.q !== undefined) {
      const term = normalizeForSearch(query.q);
      if (term !== '') and.push({ searchKey: { $regex: escapeRegex(term) } });
    }
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(afterCursor(cursor));
    }
    const docs = await this.contacts
      .find({ $and: and })
      .sort({ sortName: 1, _id: 1 })
      .limit(query.limit + 1)
      .lean<ContactLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: await this.views(organizationId, page),
      nextCursor:
        docs.length > query.limit && last ? encodeCursor(last.sortName, String(last._id)) : null,
    };
  }

  async get(organizationId: string, contactId: string): Promise<ContactView> {
    const doc = await this.requireOwn(organizationId, contactId);
    return (await this.views(organizationId, [doc]))[0]!;
  }

  async requireOwn(organizationId: string, contactId: string): Promise<ContactLean> {
    if (!isObjectIdHex(contactId)) contactNotFound();
    const doc = await this.contacts
      .findOne({ _id: new Types.ObjectId(contactId), organizationId })
      .lean<ContactLean>()
      .exec();
    if (!doc) contactNotFound();
    return doc;
  }

  /** Noms des contacts de l'organisation, par identifiant (les inconnus sont absents). */
  async namesOf(organizationId: string, ids: readonly string[]): Promise<Map<string, string>> {
    const valid = [...new Set(ids.filter(isObjectIdHex))];
    if (valid.length === 0) return new Map();
    const docs = await this.contacts
      .find({ _id: { $in: valid.map((i) => new Types.ObjectId(i)) }, organizationId })
      .select({ name: 1 })
      .lean<ContactLean[]>()
      .exec();
    return new Map(docs.map((d) => [String(d._id), d.name]));
  }

  /** Contact de l'organisation trouvé par e-mail (import CSV). */
  async findByEmail(organizationId: string, email: string): Promise<ContactLean | null> {
    return this.contacts
      .findOne({ organizationId, email: email.toLowerCase() })
      .sort({ _id: 1 })
      .lean<ContactLean>()
      .exec();
  }

  async views(organizationId: string, docs: readonly ContactLean[]): Promise<ContactView[]> {
    const [names, accounts] = await Promise.all([
      customerNamesOf(
        this.customers,
        organizationId,
        docs.map((d) => d.customerId),
      ),
      this.accounts.byIds(
        organizationId,
        docs.map((d) => d.accountId),
      ),
    ]);
    return docs.map((d) => ({
      id: String(d._id),
      kind: d.customerId ? 'customer_contact' : 'prospect',
      name: d.name,
      jobTitle: d.jobTitle ?? null,
      email: d.email ?? null,
      phone: d.phone ?? null,
      accountId: d.accountId ?? null,
      accountName: d.accountId ? (accounts.get(d.accountId)?.name ?? null) : null,
      customerId: d.customerId ?? null,
      customerName: d.customerId ? (names.get(d.customerId) ?? null) : null,
      companyName: d.companyName ?? null,
      notes: d.notes ?? null,
      revision: d.revision,
      createdAt: new Date(d.createdAt).toISOString(),
      updatedAt: new Date(d.updatedAt).toISOString(),
    }));
  }

  // ── Écriture ─────────────────────────────────────────────────────────────

  async create(organizationId: string, input: ContactInput, actor: CrmActor): Promise<ContactView> {
    const fields = await this.linked(organizationId, input, actor);
    const doc = await this.contacts.create({
      organizationId,
      ...fields,
      ...this.keys(fields),
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 2,
    });
    return this.get(organizationId, String(doc._id));
  }

  /** Création en lot (import CSV, déjà validé) : tout ou rien côté appelant. */
  async createMany(
    organizationId: string,
    inputs: readonly ContactInput[],
    actor: CrmActor,
  ): Promise<number> {
    if (inputs.length === 0) return 0;
    // Séquentiel : deux lignes d'une même entreprise résolvent le même prospect.
    const linked: Array<ContactInput & { accountId: string | null }> = [];
    for (const input of inputs) linked.push(await this.linked(organizationId, input, actor));
    const res = await this.contacts.insertMany(
      linked.map((fields) => ({
        organizationId,
        ...fields,
        ...this.keys(fields),
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 2,
      })),
    );
    return res.length;
  }

  async put(
    organizationId: string,
    contactId: string,
    expectedRevision: number,
    input: ContactInput,
    actor: CrmActor,
  ): Promise<ContactView> {
    const current = await this.requireOwn(organizationId, contactId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    const fields = await this.linked(organizationId, input, actor);
    const res = await this.contacts
      .updateOne(
        { _id: current._id, organizationId, revision: expectedRevision },
        {
          $set: { ...fields, ...this.keys(fields), updatedBy: actor.userId, _schemaVersion: 2 },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1)
      staleRevision((await this.requireOwn(organizationId, contactId)).revision);
    return this.get(organizationId, contactId);
  }

  /**
   * Suppression : refusée si une opportunité désigne ce contact ; les activités
   * qui le citaient le perdent (elles restent rattachées à leur opportunité).
   */
  async remove(organizationId: string, contactId: string, actor: CrmActor): Promise<void> {
    const current = await this.requireOwn(organizationId, contactId);
    const used = await this.opportunities
      .countDocuments({ organizationId, contactId: String(current._id) })
      .exec();
    if (used > 0) {
      conflict(
        'CRM_CONTACT_IN_USE',
        'Ce contact est rattaché à des opportunités : changez leur contact d’abord.',
        { opportunities: used },
      );
    }
    await this.contacts.deleteOne({ _id: current._id, organizationId }).exec();
    await this.activities
      .updateMany({ organizationId, contactId: String(current._id) }, { $set: { contactId: null } })
      .exec();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'crm_contact.deleted',
      targetType: 'crm_contact',
      targetId: contactId,
    });
  }

  /** Tous les contacts (export CSV), triés par nom, bornés. */
  async all(organizationId: string, max: number): Promise<ContactView[]> {
    const docs = await this.contacts
      .find({ organizationId })
      .sort({ sortName: 1, _id: 1 })
      .limit(max)
      .lean<ContactLean[]>()
      .exec();
    return this.views(organizationId, docs);
  }

  /**
   * ADR-0040 — C1 : rattache la personne à son compte et recopie `customerId` et
   * `companyName`. Compte d'une autre organisation ou client inconnu → 404 ;
   * compte fusionné → 409 `CRM_ACCOUNT_MERGED`.
   */
  private async linked(
    organizationId: string,
    input: ContactInput,
    actor: CrmActor,
  ): Promise<ContactInput & { accountId: string | null }> {
    if (input.accountId === null) {
      return { ...input, accountId: null, customerId: null, companyName: null };
    }
    if (input.accountId !== undefined) {
      const account = await this.accounts.requireUsable(organizationId, input.accountId);
      return { ...input, accountId: String(account._id), ...contactDenormOf(account) };
    }
    // Compatibilité N-1 : `customerId` / `companyName` sans `accountId`.
    await requireCustomer(this.customers, organizationId, input.customerId);
    const account = await this.accounts.resolveLegacy(organizationId, input, actor);
    if (!account) return { ...input, accountId: null };
    return { ...input, accountId: String(account._id), ...contactDenormOf(account) };
  }

  private keys(input: ContactInput): { sortName: string; searchKey: string } {
    return {
      sortName: normalizeForSearch(input.name),
      searchKey: searchKeyOf([input.name, input.email, input.companyName, input.jobTitle]),
    };
  }
}

/** Noms des clients de l'organisation, par identifiant. */
export async function customerNamesOf(
  customers: Model<CustomerDocument>,
  organizationId: string,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const valid = [
    ...new Set(ids.filter((i): i is string => typeof i === 'string' && isObjectIdHex(i))),
  ];
  if (valid.length === 0) return new Map();
  const docs = await customers
    .find({ _id: { $in: valid.map((i) => new Types.ObjectId(i)) }, organizationId })
    .select({ name: 1 })
    .lean<CustomerLean[]>()
    .exec();
  return new Map(docs.map((d) => [String(d._id), d.name]));
}

/** Client de l'organisation, ou 404 (`null` accepté : aucun client). */
export async function requireCustomer(
  customers: Model<CustomerDocument>,
  organizationId: string,
  customerId: string | null,
): Promise<CustomerLean | null> {
  if (customerId === null) return null;
  const doc = await customers
    .findOne({ _id: new Types.ObjectId(customerId), organizationId })
    .lean<CustomerLean>()
    .exec();
  if (!doc) customerNotFound();
  return doc;
}
