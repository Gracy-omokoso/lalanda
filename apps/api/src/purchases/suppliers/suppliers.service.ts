// Fiches fournisseurs — ADR-0044 § 2.1, § 2.9 et § 3.1. ADR-0044 — P2.
//
// Isolation : chaque requête porte `organizationId` ; une fiche (source ou cible
// d'une fusion comprise) d'une autre organisation est introuvable (404). Écriture
// concurrente : `expectedRevision` → `409 STALE_REVISION`.
//
// Les coordonnées de paiement (§ 2.1.1) sont chiffrées ici, jamais rendues en clair
// hors de `reveal` (`payables.pay`, audit STRICT écrit avant la réponse). Tout
// changement est journalisé strictement, dans la même transaction que l'écriture
// (avant et après MASQUÉS), puis notifié aux payeurs et approbateurs.
//
// Les commandes, factures et paiements (lots P3 à P5) ne sont lus et réaffectés que
// par la connexion (collections `purchase_orders`, `supplier_invoices`,
// `supplier_payments`), sans modèle : ce lot ne dépend d'aucun autre.

import { EXPENSE_CATEGORY_CODES } from '@lalanda/engine';
import {
  PURCHASE_LIMITS,
  PURCHASE_SETTINGS_DEFAULTS,
  type CreateSupplierBody,
  type CreateSupplierPaymentMethodBody,
  type ListSuppliersQuery,
  type SupplierContactInput,
  type SupplierListItem,
  type SupplierMigrationReportView,
  type SupplierPage,
  type SupplierPaymentMethodRevealView,
  type SupplierView,
  type SupplierWarning,
  type SupplierWriteResult,
  type UpdateSupplierBody,
  type UpdateSupplierPaymentMethodBody,
} from '@lalanda/shared/purchases';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { MASTER_KEYRING } from '../../integrations/keyring.provider.js';
import type { EncryptedValue, MasterKeyring } from '../../integrations/secrets-crypto.js';
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
import {
  SUPPLIER_PAYABLES_SOURCE,
  noSupplierPayables,
  type SupplierPayablesSource,
} from './supplier-payables.port.js';
import {
  decryptPaymentDetails,
  encryptPaymentDetails,
  maskPaymentDetails,
  paymentFingerprint,
  type PaymentDetails,
} from './supplier-payment-crypto.js';
import {
  Supplier,
  type SupplierContact,
  type SupplierDocument,
  type SupplierLean,
  type SupplierPaymentMethod,
} from './supplier.schema.js';
import {
  mergeIntoSelf,
  mergeNifMismatch,
  nifExists,
  paymentMethodKindMismatch,
  paymentMethodNotFound,
  paymentMethodsLimit,
  secretsNotConfigured,
  supplierHasOpenPayables,
  supplierInUse,
  supplierMerged,
  supplierNotFound,
} from './suppliers.errors.js';
import { SuppliersNotifier } from './suppliers-notifier.js';

/** Auteur d'une écriture et son rôle (journal). */
export interface SupplierActor {
  userId: string;
  role: string;
}

/** Rapport de la migration `20261031-0001-suppliers-from-expenses` (§ 2.9). */
export const SUPPLIER_MIGRATION_REPORTS = 'supplier_migration_reports';
export const SUPPLIERS_MIGRATION = '20261031-0001-suppliers-from-expenses';

/** Collections lues par la connexion (autres lots, trésorerie). */
const EXPENSES = 'treasury_expenses';
const RECURRING = 'treasury_recurring_expenses';
const ORDERS = 'purchase_orders';
const INVOICES = 'supplier_invoices';
const PAYMENTS = 'supplier_payments';
const SETTINGS = 'purchase_settings';

const CATEGORIES = new Set<string>(EXPENSE_CATEGORY_CODES as readonly string[]);
const DAY_MS = 86_400_000;

export interface SupplierMergeResult {
  supplier: SupplierView;
  moved: {
    expenses: number;
    recurringExpenses: number;
    orders: number;
    invoices: number;
    payments: number;
    legacyKeys: number;
  };
}

/** Tri et clé de recherche d'une fiche. */
export function supplierKeys(fields: {
  name: string;
  nif?: string | null;
  email?: string | null;
  contacts?: readonly { name: string }[];
}): { sortName: string; searchKey: string } {
  return {
    sortName: normalizeForSearch(fields.name),
    searchKey: searchKeyOf([
      fields.name,
      fields.nif,
      fields.email,
      ...(fields.contacts ?? []).map((c) => c.name),
    ]),
  };
}

/**
 * Vue d'une fiche : moyens de paiement MASQUÉS. Le chiffré n'est jamais lu ici —
 * aucun champ `cipher` ne peut sortir par cette fonction.
 */
export function supplierView(d: SupplierLean, alertDays: number, now = new Date()): SupplierView {
  const changedAt = d.paymentDetailsChangedAt ? new Date(d.paymentDetailsChangedAt) : null;
  const until = changedAt ? new Date(changedAt.getTime() + alertDays * DAY_MS) : null;
  const terms = d.paymentTerms ?? { kind: 'immediate' };
  return {
    id: String(d._id),
    name: d.name,
    kind: d.kind ?? 'company',
    nif: d.nif ?? null,
    rccm: d.rccm ?? null,
    nationalId: d.nationalId ?? null,
    address: d.address ?? null,
    phone: d.phone ?? null,
    email: d.email ?? null,
    website: d.website ?? null,
    contacts: (d.contacts ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role ?? null,
      phone: c.phone ?? null,
      email: c.email ?? null,
      isPrimary: c.isPrimary === true,
    })),
    defaultCurrency: d.defaultCurrency ?? null,
    paymentTerms:
      terms.kind === 'immediate'
        ? { kind: 'immediate' }
        : { kind: terms.kind, days: terms.days ?? 0 },
    defaultCategory: d.defaultCategory ?? null,
    paymentMethods: (d.paymentMethods ?? []).map((m) => ({
      id: m.id,
      kind: m.kind,
      label: m.label,
      isDefault: m.isDefault === true,
      masked: m.masked,
      fingerprint: m.fingerprint,
      changedAt: new Date(m.changedAt).toISOString(),
      changedBy: m.changedBy,
    })),
    paymentDetailsChangedAlert:
      changedAt && until && alertDays > 0 && now < until
        ? {
            at: changedAt.toISOString(),
            by: d.paymentDetailsChangedBy ?? '',
            until: until.toISOString(),
          }
        : null,
    notes: d.notes ?? null,
    active: d.active,
    mergedInto: d.mergedInto ?? null,
    revision: d.revision,
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}

@Injectable()
export class SuppliersService {
  private readonly payables: SupplierPayablesSource;

  constructor(
    @InjectModel(Supplier.name) private readonly suppliers: Model<SupplierDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SuppliersNotifier) private readonly notifier: SuppliersNotifier,
    @Inject(MASTER_KEYRING) private readonly keyring: MasterKeyring | null,
    @Inject(SUPPLIER_PAYABLES_SOURCE) payables: SupplierPayablesSource | null,
  ) {
    this.payables = payables ?? noSupplierPayables;
  }

  // ── Lecture ──────────────────────────────────────────────────────────────

  async list(
    organizationId: string,
    query: ListSuppliersQuery,
    options: { withRemaining: boolean },
  ): Promise<SupplierPage> {
    const and: Record<string, unknown>[] = [{ organizationId, mergedInto: null }];
    and.push({ active: query.active ?? true });
    if (query.q !== undefined) {
      const term = normalizeForSearch(query.q);
      if (term !== '') and.push({ searchKey: { $regex: escapeRegex(term) } });
    }
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(afterCursor(cursor));
    }
    const docs = await this.suppliers
      .find({ $and: and })
      .sort({ sortName: 1, _id: 1 })
      .limit(query.limit + 1)
      .lean<SupplierLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    const alertDays = await this.alertDays(organizationId);
    const remaining = options.withRemaining
      ? await this.payables.remainingBySupplier(
          organizationId,
          page.map((d) => String(d._id)),
        )
      : null;
    const items: SupplierListItem[] = page.map((d) => ({
      ...supplierView(d, alertDays),
      remainingByCurrency: remaining ? (remaining.get(String(d._id)) ?? {}) : null,
    }));
    return {
      items,
      nextCursor:
        docs.length > query.limit && last ? encodeCursor(last.sortName, String(last._id)) : null,
    };
  }

  async get(organizationId: string, supplierId: string): Promise<SupplierView> {
    const doc = await this.requireOwn(organizationId, supplierId);
    return supplierView(doc, await this.alertDays(organizationId));
  }

  /** Fiche de l'organisation (fusionnée comprise), ou 404. */
  async requireOwn(organizationId: string, supplierId: string): Promise<SupplierLean> {
    if (typeof supplierId !== 'string' || !isObjectIdHex(supplierId)) supplierNotFound();
    const doc = await this.suppliers
      .findOne({ _id: new Types.ObjectId(supplierId), organizationId })
      .lean<SupplierLean>()
      .exec();
    if (!doc) supplierNotFound();
    return doc;
  }

  /** Fiche modifiable : de l'organisation (404) et non fusionnée (409). */
  async requireUsable(organizationId: string, supplierId: string): Promise<SupplierLean> {
    const doc = await this.requireOwn(organizationId, supplierId);
    if (doc.mergedInto) supplierMerged(doc.mergedInto);
    return doc;
  }

  /** Rapport de la migration pour l'organisation, le plus récent ; `null` s'il n'y en a pas. */
  async migrationReport(
    organizationId: string,
  ): Promise<(SupplierMigrationReportView & { id: string; ranAt: string }) | null> {
    const doc = await this.connection
      .collection(SUPPLIER_MIGRATION_REPORTS)
      .find({ organizationId, migration: SUPPLIERS_MIGRATION })
      .sort({ ranAt: -1, _id: -1 })
      .limit(1)
      .next();
    if (!doc) return null;
    return {
      id: String(doc._id),
      ranAt: new Date(doc['ranAt'] as Date).toISOString(),
      suppliersCreated: Number(doc['suppliersCreated'] ?? 0),
      expensesLinked: Number(doc['expensesLinked'] ?? 0),
      recurringLinked: Number(doc['recurringLinked'] ?? 0),
      suppliers: (doc['suppliers'] as SupplierMigrationReportView['suppliers']) ?? [],
    };
  }

  // ── Écriture de la fiche ─────────────────────────────────────────────────

  async create(
    organizationId: string,
    body: CreateSupplierBody,
    actor: SupplierActor,
  ): Promise<SupplierWriteResult> {
    this.assertCategory(body.defaultCategory);
    const contacts = this.contactsOf(body.contacts ?? [], []);
    const fields = {
      kind: body.kind ?? 'company',
      nif: body.nif ?? null,
      rccm: body.rccm ?? null,
      nationalId: body.nationalId ?? null,
      address: body.address ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      website: body.website ?? null,
      contacts,
      defaultCurrency: body.defaultCurrency ?? null,
      paymentTerms: body.paymentTerms ?? { kind: 'immediate' as const },
      defaultCategory: body.defaultCategory ?? null,
      notes: body.notes ?? null,
    };
    let created: SupplierDocument;
    try {
      created = await this.suppliers.create({
        organizationId,
        name: body.name,
        ...supplierKeys({ name: body.name, ...fields }),
        ...fields,
        paymentMethods: [],
        paymentDetailsChangedAt: null,
        paymentDetailsChangedBy: null,
        active: true,
        legacyKeys: [],
        mergedInto: null,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
    } catch (err) {
      if (isDuplicateKey(err)) await this.throwNifExists(organizationId, fields.nif);
      throw err;
    }
    const lean = await this.requireOwn(organizationId, String(created._id));
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'supplier.created',
      targetType: 'supplier',
      targetId: String(created._id),
    });
    return {
      supplier: supplierView(lean, await this.alertDays(organizationId)),
      warnings: await this.similar(organizationId, lean.sortName, lean._id),
    };
  }

  async update(
    organizationId: string,
    supplierId: string,
    body: UpdateSupplierBody,
    actor: SupplierActor,
  ): Promise<SupplierWriteResult> {
    const current = await this.requireUsable(organizationId, supplierId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const { expectedRevision, contacts: rawContacts, ...rest } = body;
    this.assertCategory(rest.defaultCategory);
    const set: Record<string, unknown> = stripUndefined(rest);
    if (rawContacts !== undefined) set['contacts'] = this.contactsOf(rawContacts, current.contacts);
    const next = { ...current, ...set } as SupplierLean;
    let updated: SupplierLean | null;
    try {
      updated = await this.suppliers
        .findOneAndUpdate(
          { _id: current._id, organizationId, revision: expectedRevision, mergedInto: null },
          {
            $set: { ...set, ...supplierKeys(next), updatedBy: actor.userId },
            $inc: { revision: 1 },
          },
          { new: true },
        )
        .lean<SupplierLean>()
        .exec();
    } catch (err) {
      if (isDuplicateKey(err)) await this.throwNifExists(organizationId, next.nif, current._id);
      throw err;
    }
    if (!updated) staleRevision((await this.requireOwn(organizationId, supplierId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'supplier.updated',
      targetType: 'supplier',
      targetId: supplierId,
      metadata: { fields: Object.keys(set).sort().join(',') },
    });
    return {
      supplier: supplierView(updated, await this.alertDays(organizationId)),
      warnings:
        updated.sortName !== current.sortName
          ? await this.similar(organizationId, updated.sortName, updated._id)
          : [],
    };
  }

  async setActive(
    organizationId: string,
    supplierId: string,
    active: boolean,
    expectedRevision: number,
    actor: SupplierActor,
  ): Promise<SupplierView> {
    const current = await this.requireUsable(organizationId, supplierId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    const alertDays = await this.alertDays(organizationId);
    if (current.active === active) return supplierView(current, alertDays);
    if (!active) {
      const open = await this.payables.remainingBySupplier(organizationId, [supplierId]);
      const rest = open.get(supplierId);
      if (rest && Object.values(rest).some((v) => v !== undefined && !/^0+(\.0+)?$/.test(v))) {
        supplierHasOpenPayables();
      }
    }
    const updated = await this.suppliers
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: expectedRevision, mergedInto: null },
        { $set: { active, updatedBy: actor.userId }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<SupplierLean>()
      .exec();
    if (!updated) staleRevision((await this.requireOwn(organizationId, supplierId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: active ? 'supplier.restored' : 'supplier.archived',
      targetType: 'supplier',
      targetId: supplierId,
    });
    return supplierView(updated, alertDays);
  }

  /** Suppression : seulement sans commande, facture, paiement, dépense ni règle récurrente. */
  async remove(organizationId: string, supplierId: string, actor: SupplierActor): Promise<void> {
    const current = await this.requireUsable(organizationId, supplierId);
    const usage = await this.usageOf(organizationId, supplierId);
    if (Object.values(usage).some((n) => n > 0)) supplierInUse(usage);
    await this.suppliers.deleteOne({ _id: current._id, organizationId, mergedInto: null }).exec();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'supplier.deleted',
      targetType: 'supplier',
      targetId: supplierId,
    });
  }

  /**
   * Fusionne `sourceId` dans `targetId` (§ 3.1) : dépenses, règles récurrentes,
   * commandes, factures, paiements et `legacyKeys` réaffectés en UNE transaction ;
   * la source garde `mergedInto` (trace), est archivée et sort des listes. Refusée
   * si les deux fiches portent des NIF différents. Les moyens de paiement de la
   * source restent sur elle (leur chiffré est lié à sa fiche) : ils ne sont pas
   * recopiés sur la cible.
   */
  async merge(
    organizationId: string,
    sourceId: string,
    targetId: string,
    expectedRevision: number,
    actor: SupplierActor,
  ): Promise<SupplierMergeResult> {
    const source = await this.requireUsable(organizationId, sourceId);
    if (source.revision !== expectedRevision) staleRevision(source.revision);
    if (String(source._id) === targetId.toLowerCase()) mergeIntoSelf();
    const target = await this.requireUsable(organizationId, targetId);
    if (source.nif && target.nif && source.nif !== target.nif) mergeNifMismatch();
    const sourceKey = String(source._id);
    const targetKey = String(target._id);
    const legacyKeys = (source.legacyKeys ?? []).filter(
      (k) => !(target.legacyKeys ?? []).includes(k),
    );

    const moved = await this.inTransaction(async (session) => {
      const res = await this.suppliers
        .updateOne(
          { _id: source._id, organizationId, revision: expectedRevision, mergedInto: null },
          {
            $set: {
              mergedInto: targetKey,
              active: false,
              legacyKeys: [],
              // Le NIF passe à la cible s'il lui manque : l'index unique partiel
              // exige qu'il quitte d'abord la source.
              nif: null,
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) {
        staleRevision((await this.requireOwn(organizationId, sourceId)).revision);
      }
      const targetSet: Record<string, unknown> = { updatedBy: actor.userId };
      if (!target.nif && source.nif) targetSet['nif'] = source.nif;
      const t = await this.suppliers
        .updateOne(
          { _id: target._id, organizationId, mergedInto: null },
          {
            $set: targetSet,
            $addToSet: { legacyKeys: { $each: legacyKeys } },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (t.matchedCount !== 1) supplierMerged(targetKey);
      const repoint = async (collection: string): Promise<number> =>
        (
          await this.connection
            .collection(collection)
            .updateMany(
              { organizationId, supplierId: sourceKey },
              { $set: { supplierId: targetKey } },
              { session },
            )
        ).modifiedCount;
      const counts = {
        expenses: await repoint(EXPENSES),
        recurringExpenses: await repoint(RECURRING),
        orders: await repoint(ORDERS),
        invoices: await repoint(INVOICES),
        payments: await repoint(PAYMENTS),
        legacyKeys: legacyKeys.length,
      };
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'supplier.merged',
          targetType: 'supplier',
          targetId: sourceKey,
          metadata: { into: targetKey, ...counts },
        },
        { session },
      );
      return counts;
    });
    return { supplier: await this.get(organizationId, targetKey), moved };
  }

  // ── Coordonnées de paiement (§ 2.1.1) ────────────────────────────────────

  async addPaymentMethod(
    organizationId: string,
    supplierId: string,
    body: CreateSupplierPaymentMethodBody,
    actor: SupplierActor,
  ): Promise<SupplierWriteResult> {
    const current = await this.requireUsable(organizationId, supplierId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const keyring = this.requireKeyring();
    const methods = current.paymentMethods ?? [];
    if (methods.length >= PURCHASE_LIMITS.paymentMethodsMax) {
      paymentMethodsLimit(PURCHASE_LIMITS.paymentMethodsMax);
    }
    const methodId = new Types.ObjectId().toHexString();
    const payment = paymentOf(body.kind, body.details);
    const now = new Date();
    const method: SupplierPaymentMethod = {
      id: methodId,
      kind: body.kind,
      label: body.label,
      isDefault: body.isDefault || methods.length === 0,
      ...this.sealed(organizationId, supplierId, methodId, payment, keyring, actor.userId),
      changedAt: now,
      changedBy: actor.userId,
    };
    const next = [
      ...methods.map((m) => (method.isDefault ? { ...m, isDefault: false } : m)),
      method,
    ];
    return this.writeMethods(organizationId, current, next, actor, now, {
      methodId,
      change: 'added',
      before: null,
      after: method.masked,
      fingerprint: method.fingerprint,
    });
  }

  async updatePaymentMethod(
    organizationId: string,
    supplierId: string,
    methodId: string,
    body: UpdateSupplierPaymentMethodBody,
    actor: SupplierActor,
  ): Promise<SupplierWriteResult> {
    const current = await this.requireUsable(organizationId, supplierId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const methods = current.paymentMethods ?? [];
    const existing = methods.find((m) => m.id === methodId);
    if (!existing) paymentMethodNotFound();
    const now = new Date();
    let replaced: SupplierPaymentMethod = {
      ...existing,
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
    };
    if (body.details !== undefined) {
      const keyring = this.requireKeyring();
      const isBank = 'accountNumber' in body.details;
      if ((existing.kind === 'bank') !== isBank) paymentMethodKindMismatch();
      const payment = paymentOf(existing.kind, body.details);
      replaced = {
        ...replaced,
        ...this.sealed(organizationId, supplierId, methodId, payment, keyring, actor.userId),
        changedAt: now,
        changedBy: actor.userId,
      };
    }
    const next = methods.map((m) =>
      m.id === methodId
        ? replaced
        : replaced.isDefault && m.isDefault
          ? { ...m, isDefault: false }
          : m,
    );
    // Seul un changement de COORDONNÉES lève l'alerte : un libellé renommé non.
    const detailsChanged = body.details !== undefined;
    return this.writeMethods(
      organizationId,
      current,
      next,
      actor,
      detailsChanged ? now : null,
      detailsChanged
        ? {
            methodId,
            change: 'updated',
            before: existing.masked,
            after: replaced.masked,
            fingerprint: replaced.fingerprint,
          }
        : null,
    );
  }

  async removePaymentMethod(
    organizationId: string,
    supplierId: string,
    methodId: string,
    expectedRevision: number,
    actor: SupplierActor,
  ): Promise<SupplierWriteResult> {
    const current = await this.requireUsable(organizationId, supplierId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    const methods = current.paymentMethods ?? [];
    const existing = methods.find((m) => m.id === methodId);
    if (!existing) paymentMethodNotFound();
    const rest = methods.filter((m) => m.id !== methodId);
    if (existing.isDefault && rest.length > 0 && !rest.some((m) => m.isDefault)) {
      rest[0] = { ...rest[0]!, isDefault: true };
    }
    return this.writeMethods(organizationId, current, rest, actor, new Date(), {
      methodId,
      change: 'removed',
      before: existing.masked,
      after: null,
      fingerprint: null,
    });
  }

  /**
   * Le clair d'UN moyen de paiement (`payables.pay`). L'audit STRICT est écrit avant
   * la réponse : sans trace, rien n'est révélé. Ni le clair ni le masque n'entrent
   * dans le journal.
   */
  async reveal(
    organizationId: string,
    supplierId: string,
    methodId: string,
    actor: SupplierActor,
  ): Promise<SupplierPaymentMethodRevealView> {
    const current = await this.requireOwn(organizationId, supplierId);
    const method = (current.paymentMethods ?? []).find((m) => m.id === methodId);
    if (!method) paymentMethodNotFound();
    const keyring = this.requireKeyring();
    const payment = decryptPaymentDetails({
      organizationId,
      supplierId: String(current._id),
      methodId,
      kind: method.kind,
      record: method.cipher as unknown as EncryptedValue,
      keyring,
    });
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'supplier.payment_details_revealed',
      targetType: 'supplier',
      targetId: String(current._id),
      metadata: { methodId, kind: method.kind },
    });
    return payment.kind === 'bank'
      ? { id: methodId, kind: 'bank', details: payment.details }
      : { id: methodId, kind: 'mobile_money', details: payment.details };
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  private sealed(
    organizationId: string,
    supplierId: string,
    methodId: string,
    payment: PaymentDetails,
    keyring: MasterKeyring,
    updatedBy: string,
  ): Pick<SupplierPaymentMethod, 'masked' | 'fingerprint' | 'cipher'> {
    return {
      masked: maskPaymentDetails(payment),
      fingerprint: paymentFingerprint(organizationId, payment, keyring),
      cipher: encryptPaymentDetails({
        organizationId,
        supplierId,
        methodId,
        payment,
        keyring,
        updatedBy,
      }) as unknown as SupplierPaymentMethod['cipher'],
    };
  }

  /**
   * Écrit la liste des moyens de paiement et, si `change` n'est pas nul, l'audit
   * STRICT dans la même transaction (échec de l'audit ⇒ rien n'est écrit), puis
   * notifie hors transaction.
   */
  private async writeMethods(
    organizationId: string,
    current: SupplierLean,
    methods: SupplierPaymentMethod[],
    actor: SupplierActor,
    changedAt: Date | null,
    change: {
      methodId: string;
      change: 'added' | 'updated' | 'removed';
      before: string | null;
      after: string | null;
      fingerprint: string | null;
    } | null,
  ): Promise<SupplierWriteResult> {
    const supplierId = String(current._id);
    const set: Record<string, unknown> = { paymentMethods: methods, updatedBy: actor.userId };
    if (changedAt && change) {
      set['paymentDetailsChangedAt'] = changedAt;
      set['paymentDetailsChangedBy'] = actor.userId;
    }
    await this.inTransaction(async (session) => {
      const res = await this.suppliers
        .updateOne(
          { _id: current._id, organizationId, revision: current.revision, mergedInto: null },
          { $set: set, $inc: { revision: 1 } },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) {
        staleRevision((await this.requireOwn(organizationId, supplierId)).revision);
      }
      if (change) {
        await this.audit.recordStrict(
          {
            organizationId,
            actorUserId: actor.userId,
            actorRole: actor.role,
            action: 'supplier.payment_details_changed',
            targetType: 'supplier',
            targetId: supplierId,
            metadata: {
              methodId: change.methodId,
              change: change.change,
              before: change.before,
              after: change.after,
            },
          },
          { session },
        );
      }
    });
    if (change) {
      await this.notifier.paymentDetailsChanged({
        organizationId,
        supplierId,
        supplierName: current.name,
        actorUserId: actor.userId,
      });
    }
    const updated = await this.requireOwn(organizationId, supplierId);
    const warnings =
      change?.fingerprint != null
        ? await this.sharedDetails(organizationId, change.fingerprint, updated._id)
        : [];
    return {
      supplier: supplierView(updated, await this.alertDays(organizationId)),
      warnings,
    };
  }

  private requireKeyring(): MasterKeyring {
    if (!this.keyring) secretsNotConfigured();
    return this.keyring;
  }

  /** `paymentDetailsAlertDays` des réglages des achats (lot P3), défaut 7. */
  private async alertDays(organizationId: string): Promise<number> {
    const doc = await this.connection
      .collection(SETTINGS)
      .findOne({ organizationId }, { projection: { paymentDetailsAlertDays: 1 } });
    const v = doc?.['paymentDetailsAlertDays'];
    return typeof v === 'number' && Number.isInteger(v) && v >= 0
      ? v
      : PURCHASE_SETTINGS_DEFAULTS.paymentDetailsAlertDays;
  }

  private assertCategory(category: string | null | undefined): void {
    if (category === null || category === undefined || CATEGORIES.has(category)) return;
    throw new BadRequestException({
      code: 'INVALID_REQUEST',
      message: 'Corps de requête invalide.',
      details: {
        issues: [
          { path: 'defaultCategory', code: 'CATEGORY_UNKNOWN', message: 'Catégorie inconnue.' },
        ],
      },
    });
  }

  /** Contacts : identifiant conservé s'il existe déjà sur la fiche, sinon neuf. */
  private contactsOf(
    input: readonly SupplierContactInput[],
    existing: readonly SupplierContact[],
  ): SupplierContact[] {
    const known = new Set(existing.map((c) => c.id));
    return input.map((c) => ({
      id: c.id && known.has(c.id) ? c.id : new Types.ObjectId().toHexString(),
      name: c.name,
      role: c.role ?? null,
      phone: c.phone ?? null,
      email: c.email ?? null,
      isPrimary: c.isPrimary,
    }));
  }

  private async throwNifExists(
    organizationId: string,
    nif: string | null,
    exceptId?: Types.ObjectId,
  ): Promise<never> {
    const other = await this.suppliers
      .findOne({ organizationId, nif, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }, { _id: 1 })
      .lean<{ _id: Types.ObjectId }>()
      .exec();
    nifExists(other ? String(other._id) : '');
  }

  /** Homonymes non fusionnés (avertissement, jamais un refus). */
  private async similar(
    organizationId: string,
    sortName: string,
    exceptId: Types.ObjectId,
  ): Promise<SupplierWarning[]> {
    const docs = await this.suppliers
      .find({ organizationId, sortName, mergedInto: null, _id: { $ne: exceptId } }, { _id: 1 })
      .sort({ _id: 1 })
      .limit(10)
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return docs.map((d) => ({ code: 'SUPPLIER_SIMILAR_NAME', supplierId: String(d._id) }));
  }

  /** Autres fiches non fusionnées qui partagent un compte (cas classique de fraude). */
  private async sharedDetails(
    organizationId: string,
    fingerprint: string,
    exceptId: Types.ObjectId,
  ): Promise<SupplierWarning[]> {
    const docs = await this.suppliers
      .find(
        {
          organizationId,
          mergedInto: null,
          _id: { $ne: exceptId },
          'paymentMethods.fingerprint': fingerprint,
        },
        { _id: 1 },
      )
      .sort({ _id: 1 })
      .limit(10)
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return docs.map((d) => ({
      code: 'SUPPLIER_PAYMENT_DETAILS_SHARED',
      supplierId: String(d._id),
    }));
  }

  private async usageOf(
    organizationId: string,
    supplierId: string,
  ): Promise<Record<string, number>> {
    const count = (collection: string) =>
      this.connection.collection(collection).countDocuments({ organizationId, supplierId });
    const [expenses, recurringExpenses, orders, invoices, payments] = await Promise.all([
      count(EXPENSES),
      count(RECURRING),
      count(ORDERS),
      count(INVOICES),
      count(PAYMENTS),
    ]);
    return { expenses, recurringExpenses, orders, invoices, payments };
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

function paymentOf(
  kind: 'bank' | 'mobile_money',
  details: CreateSupplierPaymentMethodBody['details'],
): PaymentDetails {
  if (kind === 'bank') {
    const d = details as Extract<CreateSupplierPaymentMethodBody, { kind: 'bank' }>['details'];
    return {
      kind: 'bank',
      details: {
        bankName: d.bankName,
        accountHolder: d.accountHolder,
        accountNumber: d.accountNumber,
        iban: d.iban ?? null,
        swift: d.swift ?? null,
      },
    };
  }
  const d = details as Extract<
    CreateSupplierPaymentMethodBody,
    { kind: 'mobile_money' }
  >['details'];
  return {
    kind: 'mobile_money',
    details: { operator: d.operator, phoneNumber: d.phoneNumber, holderName: d.holderName },
  };
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
