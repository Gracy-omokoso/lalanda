// Comptes 360° — ADR-0040 § 2.1 et § 3.1. ADR-0040 — C1.
//
// Un compte par entreprise : PROSPECT (créé ici) ou CLIENT (né de la fiche client
// par `CrmAccountsSync`, ou d'une conversion). Ce service ne dépend pas de Ventes :
// la conversion qui crée une fiche client vit dans `conversion/` (module de
// composition), qui appelle `linkCustomer` une fois la fiche créée par les règles
// de Ventes.
//
// Isolation : chaque requête porte `organizationId` ; un compte, un responsable ou
// un compte cible d'une autre organisation est introuvable (404). Écriture
// concurrente : `expectedRevision` → `409 STALE_REVISION`.

import type {
  CreateCrmAccountBody,
  CrmAccountListItem,
  CrmAccountPage,
  CrmAccountView,
  CrmAccountWarning,
  CrmAccountWriteResult,
  ListCrmAccountsQuery,
  UpdateCrmAccountBody,
} from '@lalanda/shared/crm';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { can, NO_OVERRIDES, normalizeOrgRole } from '../../authz/permissions.js';
import { Membership, type MembershipDocument } from '../../organizations/membership.schema.js';
import { invalidCursor, isDuplicateKey, staleRevision } from '../../sales/sales.errors.js';
import {
  afterCursor,
  decodeCursor,
  encodeCursor,
  escapeRegex,
  isObjectIdHex,
  normalizeForSearch,
  searchKeyOf,
} from '../../sales/search.js';
import type { CrmActor } from '../crm-settings.service.js';
import {
  CrmActivity,
  CrmContact,
  CrmOpportunity,
  type CrmActivityDocument,
  type CrmContactDocument,
  type CrmOpportunityDocument,
} from '../crm.schemas.js';
import {
  CRM_ACCOUNTS_SYSTEM_ACTOR,
  CrmAccount,
  type CrmAccountDocument,
  type CrmAccountLean,
} from './crm-account.schema.js';
import {
  repointToAccount,
  usageOf,
  type DenormCounts,
  type DenormModels,
} from './crm-accounts.denorm.js';
import {
  accountInUse,
  accountMerged,
  accountNotFound,
  followsCustomer,
  identityFromCustomer,
  mergeIntoSelf,
  notProspect,
  ownerNotEligible,
  ownerNotFound,
} from './crm-accounts.errors.js';

/** Collection du rapport de la migration `20261030-0001-crm-accounts` (§ 2.7). */
export const CRM_MIGRATION_REPORTS = 'crm_migration_reports';
export const CRM_ACCOUNTS_MIGRATION = '20261030-0001-crm-accounts';

/** Tri et clé de recherche d'un compte (motif de `customers`). */
export function accountKeys(fields: {
  name: string;
  email?: string | null;
  website?: string | null;
  industry?: string | null;
}): { sortName: string; searchKey: string } {
  return {
    sortName: normalizeForSearch(fields.name),
    searchKey: searchKeyOf([fields.name, fields.email, fields.website, fields.industry]),
  };
}

export function accountView(d: CrmAccountLean): CrmAccountView {
  return {
    id: String(d._id),
    kind: d.kind,
    customerId: d.customerId ?? null,
    name: d.name,
    ownerId: d.ownerId ?? null,
    industry: d.industry ?? null,
    origin: d.origin ?? null,
    website: d.website ?? null,
    phone: d.phone ?? null,
    email: d.email ?? null,
    address: d.address ?? null,
    notes: d.notes ?? null,
    active: d.active,
    conversion: d.conversion
      ? {
          customerId: d.conversion.customerId,
          convertedAt: new Date(d.conversion.convertedAt).toISOString(),
          convertedBy: d.conversion.convertedBy,
          mode: d.conversion.mode,
        }
      : null,
    mergedInto: d.mergedInto ?? null,
    revision: d.revision,
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}

/** Fiche client vue par le CRM : identité seulement (la fiche fait foi). */
export interface CustomerIdentity {
  id: string;
  name: string;
  active: boolean;
}

/** Comptes rattachés : la fiche finale et ce qui a été réaffecté. */
export interface MergeResult {
  account: CrmAccountView;
  moved: DenormCounts;
}

@Injectable()
export class CrmAccountsService {
  constructor(
    @InjectModel(CrmAccount.name) private readonly accounts: Model<CrmAccountDocument>,
    @InjectModel(CrmContact.name) private readonly contacts: Model<CrmContactDocument>,
    @InjectModel(CrmOpportunity.name)
    private readonly opportunities: Model<CrmOpportunityDocument>,
    @InjectModel(CrmActivity.name) private readonly activities: Model<CrmActivityDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private get models(): DenormModels {
    return {
      contacts: this.contacts,
      opportunities: this.opportunities,
      activities: this.activities,
    };
  }

  // ── Lecture ──────────────────────────────────────────────────────────────

  async list(
    organizationId: string,
    query: ListCrmAccountsQuery,
    actor: CrmActor,
  ): Promise<CrmAccountPage> {
    const and: Record<string, unknown>[] = [{ organizationId, mergedInto: null }];
    // Archivés masqués par défaut (§ 2.1).
    and.push({ active: query.active ?? true });
    if (query.kind) and.push({ kind: query.kind });
    if (query.ownerId) and.push({ ownerId: query.ownerId === 'me' ? actor.userId : query.ownerId });
    if (query.q !== undefined) {
      const term = normalizeForSearch(query.q);
      if (term !== '') and.push({ searchKey: { $regex: escapeRegex(term) } });
    }
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(afterCursor(cursor));
    }
    const docs = await this.accounts
      .find({ $and: and })
      .sort({ sortName: 1, _id: 1 })
      .limit(query.limit + 1)
      .lean<CrmAccountLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: await this.withCounts(organizationId, page),
      nextCursor:
        docs.length > query.limit && last ? encodeCursor(last.sortName, String(last._id)) : null,
    };
  }

  async get(organizationId: string, accountId: string): Promise<CrmAccountView> {
    return accountView(await this.requireOwn(organizationId, accountId));
  }

  /** Compte de l'organisation (fusionné compris), ou 404. */
  async requireOwn(organizationId: string, accountId: string): Promise<CrmAccountLean> {
    if (typeof accountId !== 'string' || !isObjectIdHex(accountId)) accountNotFound();
    const doc = await this.accounts
      .findOne({ _id: new Types.ObjectId(accountId), organizationId })
      .lean<CrmAccountLean>()
      .exec();
    if (!doc) accountNotFound();
    return doc;
  }

  /**
   * Compte auquel on peut rattacher un contact, une opportunité ou une activité :
   * de l'organisation (404 sinon) et non fusionné (409 `CRM_ACCOUNT_MERGED`).
   * Consommé par les contacts (C1) et les opportunités (C2).
   */
  async requireUsable(organizationId: string, accountId: string): Promise<CrmAccountLean> {
    const doc = await this.requireOwn(organizationId, accountId);
    if (doc.mergedInto) accountMerged(doc.mergedInto);
    return doc;
  }

  /** Comptes de l'organisation par identifiant (les inconnus sont absents). */
  async byIds(
    organizationId: string,
    ids: readonly (string | null | undefined)[],
  ): Promise<Map<string, CrmAccountLean>> {
    const valid = [
      ...new Set(ids.filter((i): i is string => typeof i === 'string' && isObjectIdHex(i))),
    ];
    if (valid.length === 0) return new Map();
    const docs = await this.accounts
      .find({ _id: { $in: valid.map((i) => new Types.ObjectId(i)) }, organizationId })
      .lean<CrmAccountLean[]>()
      .exec();
    return new Map(docs.map((d) => [String(d._id), d]));
  }

  /** Compte d'une fiche client, s'il existe. */
  async byCustomerId(organizationId: string, customerId: string): Promise<CrmAccountLean | null> {
    return this.accounts.findOne({ organizationId, customerId }).lean<CrmAccountLean>().exec();
  }

  /**
   * Compatibilité N-1 des contacts (§ 2.2) : un corps qui envoie `customerId` ou
   * `companyName` sans `accountId` est résolu ici. Un client → son compte ; une
   * entreprise → le prospect de même nom normalisé (le plus ancien), créé s'il
   * n'existe pas (responsable : l'auteur). `null` : personne sans entreprise.
   */
  async resolveLegacy(
    organizationId: string,
    legacy: { customerId: string | null; companyName: string | null },
    actor: CrmActor,
  ): Promise<CrmAccountLean | null> {
    if (legacy.customerId) {
      const account = await this.byCustomerId(organizationId, legacy.customerId);
      if (account) return account;
      // Fiche client sans compte (synchronisation perdue) : on ne crée pas le
      // compte client ici — la réconciliation s'en charge ; le contact garde son
      // `customerId` sans `accountId`.
      return null;
    }
    if (!legacy.companyName) return null;
    const sortName = normalizeForSearch(legacy.companyName);
    const existing = await this.accounts
      .findOne({ organizationId, kind: 'prospect', mergedInto: null, sortName })
      .sort({ createdAt: 1, _id: 1 })
      .lean<CrmAccountLean>()
      .exec();
    if (existing) return existing;
    const created = await this.insertProspect(
      organizationId,
      { name: legacy.companyName },
      actor.userId,
      actor.userId,
    );
    return created;
  }

  private async withCounts(
    organizationId: string,
    page: readonly CrmAccountLean[],
  ): Promise<CrmAccountListItem[]> {
    const ids = page.map((d) => String(d._id));
    if (ids.length === 0) return [];
    const [contactCounts, oppCounts, next] = await Promise.all([
      this.contacts.collection
        .aggregate<{
          _id: string;
          n: number;
        }>([
          { $match: { organizationId, accountId: { $in: ids } } },
          { $group: { _id: '$accountId', n: { $sum: 1 } } },
        ])
        .toArray(),
      this.opportunities.collection
        .aggregate<{ _id: string; n: number }>([
          { $match: { organizationId, accountId: { $in: ids }, status: 'open' } },
          { $group: { _id: '$accountId', n: { $sum: 1 } } },
        ])
        .toArray(),
      this.activities.collection
        .aggregate<{ _id: string; id: Types.ObjectId; subject: string; dueAt: Date | null }>([
          { $match: { organizationId, accountId: { $in: ids }, done: false } },
          // Échéance la plus proche d'abord ; une activité sans échéance passe après.
          {
            $addFields: {
              noDue: { $cond: [{ $eq: [{ $ifNull: ['$dueAt', null] }, null] }, 1, 0] },
            },
          },
          { $sort: { noDue: 1, dueAt: 1, _id: 1 } },
          {
            $group: {
              _id: '$accountId',
              id: { $first: '$_id' },
              subject: { $first: '$subject' },
              dueAt: { $first: '$dueAt' },
            },
          },
        ])
        .toArray(),
    ]);
    const contactsOf = new Map(contactCounts.map((c) => [c._id, c.n]));
    const oppsOf = new Map(oppCounts.map((c) => [c._id, c.n]));
    const nextOf = new Map(next.map((n) => [n._id, n]));
    return page.map((d) => {
      const id = String(d._id);
      const n = nextOf.get(id);
      return {
        ...accountView(d),
        counts: { contacts: contactsOf.get(id) ?? 0, openOpportunities: oppsOf.get(id) ?? 0 },
        nextActivity: n
          ? {
              id: String(n.id),
              subject: n.subject,
              dueAt: n.dueAt ? new Date(n.dueAt).toISOString() : null,
            }
          : null,
      };
    });
  }

  /** Rapport de la migration pour l'organisation, le plus récent ; `null` s'il n'y en a pas. */
  async migrationReport(organizationId: string): Promise<Record<string, unknown> | null> {
    const doc = await this.connection
      .collection(CRM_MIGRATION_REPORTS)
      .find({ organizationId, migration: CRM_ACCOUNTS_MIGRATION })
      .sort({ ranAt: -1, _id: -1 })
      .limit(1)
      .next();
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return { id: String(_id), ...rest };
  }

  // ── Écriture ─────────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    body: CreateCrmAccountBody,
    actor: CrmActor,
  ): Promise<CrmAccountWriteResult> {
    const ownerId = body.ownerId === undefined ? actor.userId : body.ownerId;
    await this.assertOwner(organizationId, ownerId);
    const doc = await this.insertProspect(
      organizationId,
      { ...body, ownerId },
      actor.userId,
      ownerId,
    );
    return {
      account: accountView(doc),
      warnings: await this.similar(organizationId, doc.sortName, doc._id),
    };
  }

  private async insertProspect(
    organizationId: string,
    fields: Partial<CreateCrmAccountBody> & { name: string },
    authorId: string,
    ownerId: string | null,
  ): Promise<CrmAccountLean> {
    const created = await this.accounts.create({
      organizationId,
      kind: 'prospect',
      customerId: null,
      name: fields.name,
      ...accountKeys(fields),
      ownerId,
      industry: fields.industry ?? null,
      origin: fields.origin ?? null,
      website: fields.website ?? null,
      phone: fields.phone ?? null,
      email: fields.email ?? null,
      address: fields.address ?? null,
      notes: fields.notes ?? null,
      active: true,
      conversion: null,
      mergedInto: null,
      revision: 1,
      createdBy: authorId,
      updatedBy: authorId,
      _schemaVersion: 1,
    });
    return created.toObject() as CrmAccountLean;
  }

  async update(
    organizationId: string,
    accountId: string,
    body: UpdateCrmAccountBody,
    actor: CrmActor,
  ): Promise<CrmAccountWriteResult> {
    const current = await this.requireUsable(organizationId, accountId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const { expectedRevision, ...fields } = body;
    if (fields.name !== undefined && current.kind === 'customer' && fields.name !== current.name) {
      identityFromCustomer();
    }
    if (fields.ownerId !== undefined && fields.ownerId !== current.ownerId) {
      await this.assertOwner(organizationId, fields.ownerId);
    }
    const next = { ...current, ...stripUndefined(fields) };
    const updated = await this.accounts
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: expectedRevision },
        {
          $set: {
            ...stripUndefined(fields),
            ...accountKeys(next),
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<CrmAccountLean>()
      .exec();
    if (!updated) staleRevision((await this.requireOwn(organizationId, accountId)).revision);
    // Un prospect renommé : contacts et opportunités recopient son nom.
    if (updated.kind === 'prospect' && updated.name !== current.name) {
      await repointToAccount(
        this.models,
        organizationId,
        [accountId],
        { id: accountId, name: updated.name, customerId: null },
        actor.userId,
      );
    }
    return {
      account: accountView(updated),
      warnings:
        updated.sortName !== current.sortName
          ? await this.similar(organizationId, updated.sortName, updated._id)
          : [],
    };
  }

  async setActive(
    organizationId: string,
    accountId: string,
    active: boolean,
    expectedRevision: number,
    actor: CrmActor,
  ): Promise<CrmAccountView> {
    const current = await this.requireUsable(organizationId, accountId);
    if (current.kind === 'customer') followsCustomer();
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    if (current.active === active) return accountView(current);
    const updated = await this.accounts
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: expectedRevision },
        { $set: { active, updatedBy: actor.userId }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<CrmAccountLean>()
      .exec();
    if (!updated) staleRevision((await this.requireOwn(organizationId, accountId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: active ? 'crm.account.restored' : 'crm.account.archived',
      targetType: 'crm_account',
      targetId: accountId,
    });
    return accountView(updated);
  }

  async remove(organizationId: string, accountId: string, actor: CrmActor): Promise<void> {
    const current = await this.requireUsable(organizationId, accountId);
    if (current.kind === 'customer') followsCustomer();
    const usage = await usageOf(this.models, organizationId, accountId);
    if (usage.contacts + usage.opportunities + usage.activities > 0) accountInUse({ ...usage });
    await this.accounts.deleteOne({ _id: current._id, organizationId, kind: 'prospect' }).exec();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'crm.account.deleted',
      targetType: 'crm_account',
      targetId: accountId,
    });
  }

  /**
   * Fusionne le PROSPECT `sourceId` dans `targetId` (§ 3.1) : contacts,
   * opportunités et activités réaffectés en une transaction ; la source garde
   * `mergedInto` (trace), est archivée et sort des listes.
   */
  async merge(
    organizationId: string,
    sourceId: string,
    targetId: string,
    expectedRevision: number,
    actor: CrmActor,
  ): Promise<MergeResult> {
    const source = await this.requireUsable(organizationId, sourceId);
    if (source.kind !== 'prospect') notProspect();
    if (source.revision !== expectedRevision) staleRevision(source.revision);
    if (String(source._id) === targetId.toLowerCase()) mergeIntoSelf();
    const target = await this.requireUsable(organizationId, targetId);
    const moved = await this.inTransaction(async (session) => {
      const res = await this.accounts
        .updateOne(
          { _id: source._id, organizationId, revision: expectedRevision, mergedInto: null },
          {
            $set: { mergedInto: String(target._id), active: false, updatedBy: actor.userId },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) {
        staleRevision((await this.requireOwn(organizationId, sourceId)).revision);
      }
      const counts = await repointToAccount(
        this.models,
        organizationId,
        [String(source._id)],
        identityOf(target),
        actor.userId,
        session,
      );
      await this.audit.record(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'crm.account.merged',
          targetType: 'crm_account',
          targetId: String(source._id),
          metadata: { into: String(target._id), ...counts },
        },
        { session },
      );
      return counts;
    });
    return { account: accountView(await this.requireOwn(organizationId, targetId)), moved };
  }

  /**
   * Conversion d'un prospect en client (§ 3.1.1), APRÈS que la fiche client a été
   * créée ou choisie par Ventes. Le compte garde son identifiant ; dans une
   * transaction : `customerId`, `kind`, identité recopiée de la fiche,
   * `conversion`, puis `customerId` dénormalisé sur ses contacts, opportunités et
   * activités. Les devis déjà émis ne sont pas réécrits.
   */
  async linkCustomer(
    organizationId: string,
    accountId: string,
    customer: CustomerIdentity,
    mode: 'created' | 'linked',
    expectedRevision: number,
    actor: CrmActor,
  ): Promise<CrmAccountView> {
    const current = await this.requireUsable(organizationId, accountId);
    if (current.kind !== 'prospect') notProspect();
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    const keys = accountKeys({ ...current, name: customer.name });
    await this.inTransaction(async (session) => {
      const now = new Date();
      let res;
      try {
        res = await this.accounts
          .updateOne(
            {
              _id: new Types.ObjectId(accountId),
              organizationId,
              kind: 'prospect',
              mergedInto: null,
              revision: expectedRevision,
            },
            {
              $set: {
                kind: 'customer',
                customerId: customer.id,
                name: customer.name,
                ...keys,
                active: customer.active,
                conversion: {
                  customerId: customer.id,
                  convertedAt: now,
                  convertedBy: actor.userId,
                  mode,
                },
                updatedBy: actor.userId,
              },
              $inc: { revision: 1 },
            },
            { session },
          )
          .exec();
      } catch (err) {
        // Une autre écriture a lié cette fiche à un compte entre-temps.
        if (isDuplicateKey(err)) notProspect();
        throw err;
      }
      if (res.matchedCount !== 1) {
        const now2 = await this.requireUsable(organizationId, accountId);
        if (now2.kind !== 'prospect') notProspect();
        staleRevision(now2.revision);
      }
      await repointToAccount(
        this.models,
        organizationId,
        [accountId],
        { id: accountId, name: customer.name, customerId: customer.id },
        actor.userId,
        session,
      );
      await this.audit.record(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'crm.account.converted',
          targetType: 'crm_account',
          targetId: accountId,
          metadata: { customerId: customer.id, mode },
        },
        { session },
      );
    });
    return this.get(organizationId, accountId);
  }

  // ── Règles ───────────────────────────────────────────────────────────────

  /** Responsable : `null`, ou membre de l'organisation (404) détenant `crm.manage` (400). */
  async assertOwner(organizationId: string, ownerId: string | null): Promise<void> {
    if (ownerId === null || ownerId === CRM_ACCOUNTS_SYSTEM_ACTOR) return;
    const m = await this.memberships
      .findOne({ organizationId, userId: ownerId }, { role: 1 })
      .lean<{ role: string }>()
      .exec();
    if (!m) ownerNotFound();
    const role = normalizeOrgRole(m.role);
    // ADR-0041 A3 : passer aux droits effectifs du membre (ajouts et retraits).
    if (!role || !can(role, 'crm.manage', NO_OVERRIDES)) ownerNotEligible();
  }

  /** Autres comptes non fusionnés de même nom normalisé (avertissement, jamais un refus). */
  private async similar(
    organizationId: string,
    sortName: string,
    exceptId: Types.ObjectId,
  ): Promise<CrmAccountWarning[]> {
    const docs = await this.accounts
      .find({ organizationId, sortName, mergedInto: null, _id: { $ne: exceptId } }, { _id: 1 })
      .sort({ _id: 1 })
      .limit(10)
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return docs.map((d) => ({ code: 'CRM_ACCOUNT_SIMILAR_NAME', accountId: String(d._id) }));
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

export function identityOf(d: CrmAccountLean): {
  id: string;
  name: string;
  customerId: string | null;
} {
  return { id: String(d._id), name: d.name, customerId: d.customerId ?? null };
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
