// Catalogue d'articles — ADR-0022 § S25c.3 à § S25c.6.
//
// Même discipline que le fichier clients : isolation par organisation (404 pour
// un article d'une autre organisation), révision optimiste, suppression réelle
// seulement si l'article n'a jamais été facturé.
//
// Le groupe de taxation doit figurer dans la liste proposée à l'organisation
// (`TaxGroupsService`) à CHAQUE écriture : un article dont le groupe n'est plus
// proposé reste lisible (`taxGroupAvailable: false`), mais il faut changer son
// groupe pour le modifier.
//
// Le code DGI est calculé, jamais saisi : `outOfScope ? "HORS CHAMP" : code`.

import {
  OUT_OF_SCOPE_ITEM_CODE,
  type DocumentCurrency,
  type ItemType,
  type PriceMode,
  type SpecificTax,
  type TaxGroupLetter,
} from '@lalanda/engine';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { CatalogItem, type CatalogItemDocument } from './catalog-item.schema.js';
import type { SalesActor } from './customers.service.js';
import type { CatalogItemInput, ListCatalogItemsQuery } from './sales.dto.js';
import {
  catalogItemNotFound,
  conflict,
  invalidCursor,
  invalidRequestOf,
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
import { TaxGroupsService } from './tax-groups.service.js';

export interface CatalogItemView {
  id: string;
  code: string | null;
  edefCode: string | null;
  name: string;
  itemType: ItemType;
  taxGroup: TaxGroupLetter;
  taxGroupAvailable: boolean;
  outOfScope: boolean;
  unitPrice: string;
  priceMode: PriceMode;
  currency: DocumentCurrency;
  unit: string;
  specificTax: SpecificTax | null;
  active: boolean;
  deactivatedAt: string | null;
  invoiced: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogItemPage {
  items: CatalogItemView[];
  nextCursor: string | null;
}

type CatalogItemLean = CatalogItem & { _id: Types.ObjectId };

/** Code envoyé à la DGI pour un article. */
export function edefCodeOf(item: { outOfScope: boolean; code: string | null }): string | null {
  return item.outOfScope ? OUT_OF_SCOPE_ITEM_CODE : item.code;
}

function specificTaxView(raw: CatalogItem['specificTax']): SpecificTax | null {
  if (!raw) return null;
  if (raw.kind === 'per_unit') return { kind: 'per_unit', amount: raw.amount ?? '' };
  return { kind: 'percent', rate: raw.rate ?? '' };
}

export function catalogItemView(
  doc: CatalogItemLean,
  available: ReadonlySet<TaxGroupLetter>,
): CatalogItemView {
  return {
    id: String(doc._id),
    code: doc.code ?? null,
    edefCode: edefCodeOf({ outOfScope: doc.outOfScope, code: doc.code ?? null }),
    name: doc.name,
    itemType: doc.itemType,
    taxGroup: doc.taxGroup,
    taxGroupAvailable: available.has(doc.taxGroup),
    outOfScope: doc.outOfScope,
    unitPrice: doc.unitPrice,
    priceMode: doc.priceMode,
    // Défensif : un document sans le champ (antérieur à E4) se lit en CDF.
    currency: doc.currency ?? 'CDF',
    unit: doc.unit,
    specificTax: specificTaxView(doc.specificTax),
    active: doc.active,
    deactivatedAt: doc.deactivatedAt ? doc.deactivatedAt.toISOString() : null,
    invoiced: doc.firstInvoicedAt != null,
    revision: doc.revision,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function stored(input: CatalogItemInput): Record<string, unknown> {
  return {
    ...input,
    codeKey: input.code === null ? null : input.code.toUpperCase(),
    sortName: normalizeForSearch(input.name),
    searchKey: searchKeyOf([input.code, input.name]),
  };
}

@Injectable()
export class CatalogItemsService {
  constructor(
    @InjectModel(CatalogItem.name) private readonly items: Model<CatalogItemDocument>,
    @Inject(TaxGroupsService) private readonly taxGroups: TaxGroupsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, query: ListCatalogItemsQuery): Promise<CatalogItemPage> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.status === 'active') and.push({ active: true });
    if (query.status === 'inactive') and.push({ active: false });
    if (query.taxGroup) and.push({ taxGroup: query.taxGroup });
    if (query.itemType) and.push({ itemType: query.itemType });
    if (query.q !== undefined) {
      const term = normalizeForSearch(query.q);
      if (term !== '') and.push({ searchKey: { $regex: escapeRegex(term) } });
    }
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(afterCursor(cursor));
    }

    const [docs, available] = await Promise.all([
      this.items
        .find({ $and: and })
        .sort({ sortName: 1, _id: 1 })
        .limit(query.limit + 1)
        .lean<CatalogItemLean[]>()
        .exec(),
      this.taxGroups.availableLetters(organizationId),
    ]);
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((d) => catalogItemView(d, available)),
      nextCursor:
        docs.length > query.limit && last ? encodeCursor(last.sortName, String(last._id)) : null,
    };
  }

  async get(organizationId: string, itemId: string): Promise<CatalogItemView> {
    const [doc, available] = await Promise.all([
      this.requireOwn(organizationId, itemId),
      this.taxGroups.availableLetters(organizationId),
    ]);
    return catalogItemView(doc, available);
  }

  async create(
    organizationId: string,
    input: CatalogItemInput,
    actor: SalesActor,
  ): Promise<CatalogItemView> {
    const available = await this.requireAvailableGroup(organizationId, input.taxGroup);
    try {
      const doc = await this.items.create({
        organizationId,
        ...stored(input),
        active: true,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
      return catalogItemView(doc.toObject() as CatalogItemLean, available);
    } catch (err) {
      if (isDuplicateKey(err)) await this.codeConflict(organizationId, input.code, null);
      throw err;
    }
  }

  async put(
    organizationId: string,
    itemId: string,
    expectedRevision: number,
    input: CatalogItemInput,
    actor: SalesActor,
  ): Promise<CatalogItemView> {
    const current = await this.requireOwn(organizationId, itemId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    const available = await this.requireAvailableGroup(organizationId, input.taxGroup);
    let updated: CatalogItemLean | null;
    try {
      updated = await this.items
        .findOneAndUpdate(
          { _id: current._id, organizationId, revision: expectedRevision },
          { $set: { ...stored(input), updatedBy: actor.userId }, $inc: { revision: 1 } },
          { new: true },
        )
        .lean<CatalogItemLean>()
        .exec();
    } catch (err) {
      if (isDuplicateKey(err)) await this.codeConflict(organizationId, input.code, current._id);
      throw err;
    }
    if (!updated) staleRevision((await this.requireOwn(organizationId, itemId)).revision);
    return catalogItemView(updated, available);
  }

  async setActive(
    organizationId: string,
    itemId: string,
    active: boolean,
    actor: SalesActor,
  ): Promise<CatalogItemView> {
    const [current, available] = await Promise.all([
      this.requireOwn(organizationId, itemId),
      this.taxGroups.availableLetters(organizationId),
    ]);
    if (current.active === active) return catalogItemView(current, available);

    const updated = await this.items
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
      .lean<CatalogItemLean>()
      .exec();
    if (!updated) {
      const now = await this.requireOwn(organizationId, itemId);
      if (now.active === active) return catalogItemView(now, available);
      staleRevision(now.revision);
    }

    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: active ? 'catalog_item.reactivated' : 'catalog_item.deactivated',
      targetType: 'catalog_item',
      targetId: String(updated._id),
    });
    return catalogItemView(updated, available);
  }

  async remove(organizationId: string, itemId: string, actor: SalesActor): Promise<void> {
    if (!isObjectIdHex(itemId)) catalogItemNotFound();
    const _id = new Types.ObjectId(itemId);
    const res = await this.items.deleteOne({ _id, organizationId, firstInvoicedAt: null }).exec();
    if (res.deletedCount === 0) {
      await this.requireOwn(organizationId, itemId);
      conflict(
        'CATALOG_ITEM_ALREADY_INVOICED',
        'Cet article a déjà été facturé : il ne peut pas être supprimé. Désactivez-le.',
      );
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'catalog_item.deleted',
      targetType: 'catalog_item',
      targetId: itemId,
    });
  }

  private async requireOwn(organizationId: string, itemId: string): Promise<CatalogItemLean> {
    if (!isObjectIdHex(itemId)) catalogItemNotFound();
    const doc = await this.items
      .findOne({ _id: new Types.ObjectId(itemId), organizationId })
      .lean<CatalogItemLean>()
      .exec();
    if (!doc) catalogItemNotFound();
    return doc;
  }

  /** 400 `UNKNOWN_TAX_GROUP` si la lettre n'est pas proposée à l'organisation. */
  private async requireAvailableGroup(
    organizationId: string,
    group: TaxGroupLetter,
  ): Promise<ReadonlySet<TaxGroupLetter>> {
    const available = await this.taxGroups.availableLetters(organizationId);
    if (!available.has(group)) {
      invalidRequestOf([
        {
          path: 'taxGroup',
          code: 'UNKNOWN_TAX_GROUP',
          message: `Le groupe ${group} ne figure pas dans la liste des groupes de taxation en vigueur pour votre organisation.`,
        },
      ]);
    }
    return available;
  }

  private async codeConflict(
    organizationId: string,
    code: string | null,
    exceptId: Types.ObjectId | null,
  ): Promise<never> {
    const existing =
      code === null
        ? null
        : await this.items
            .findOne(
              {
                organizationId,
                codeKey: code.toUpperCase(),
                ...(exceptId ? { _id: { $ne: exceptId } } : {}),
              },
              { _id: 1 },
            )
            .lean()
            .exec();
    conflict(
      'CATALOG_CODE_EXISTS',
      'Un article portant ce code existe déjà dans votre catalogue.',
      {
        existingId: existing ? String(existing._id) : null,
      },
    );
  }
}
