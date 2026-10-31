// Catégories et réglages des équipements (ADR-0046 § 3.5). ADR-0046 — S5.
//
// Catégories proposées à l'activation (Informatique, Téléphonie, Véhicules, Machines et
// outillage, Mobilier, Autre), modifiables, SANS durée : posées à la première lecture,
// de façon idempotente (index unique sur le nom normalisé). Réglages : délai de rappel
// des couvertures (30 j), des maintenances (7 j), affichage de l'estimation (oui) ;
// révision `0` tant que rien n'est enregistré.

import {
  ASSET_DEFAULT_CATEGORIES,
  ASSET_SETTINGS_DEFAULTS,
  type AssetCategoryView,
  type AssetSettingsView,
  type CreateAssetCategoryBody,
  type UpdateAssetCategoryBody,
  type UpdateAssetSettingsBody,
} from '@lalanda/shared/assets';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { conflict, isDuplicateKey, staleRevision } from '../../sales/sales.errors.js';
import { isObjectIdHex, normalizeForSearch } from '../../sales/search.js';
import {
  Asset,
  AssetCategory,
  AssetSettings,
  type AssetCategoryDocument,
  type AssetCategoryLean,
  type AssetDocument,
  type AssetSettingsDocument,
} from '../assets.schemas.js';

export interface AssetActor {
  userId: string;
  role: string;
}

/** Réglages effectifs (valeurs par défaut comprises), lus par le registre et les rappels. */
export interface EffectiveAssetSettings {
  reminderDays: number;
  maintenanceDueSoonDays: number;
  showDepreciationEstimate: boolean;
}

export function categoryNotFound(): never {
  throw new NotFoundException({
    code: 'ASSET_CATEGORY_NOT_FOUND',
    message: 'Catégorie d’équipement introuvable.',
  });
}

function nameExists(): never {
  conflict('ASSET_CATEGORY_NAME_EXISTS', 'Une autre catégorie porte déjà ce nom.');
}

@Injectable()
export class AssetSettingsService {
  constructor(
    @InjectModel(AssetCategory.name) private readonly categories: Model<AssetCategoryDocument>,
    @InjectModel(AssetSettings.name) private readonly settings: Model<AssetSettingsDocument>,
    @InjectModel(Asset.name) private readonly assets: Model<AssetDocument>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Réglages ───────────────────────────────────────────────────────────────

  async effective(organizationId: string): Promise<EffectiveAssetSettings> {
    const v = await this.view(organizationId);
    return {
      reminderDays: v.reminderDays,
      maintenanceDueSoonDays: v.maintenanceDueSoonDays,
      showDepreciationEstimate: v.showDepreciationEstimate,
    };
  }

  async view(organizationId: string): Promise<AssetSettingsView> {
    const doc = await this.settings.findOne({ organizationId }).lean<AssetSettings>().exec();
    if (!doc) {
      return { ...ASSET_SETTINGS_DEFAULTS, isDefault: true, revision: 0 };
    }
    return {
      reminderDays: doc.reminderDays,
      maintenanceDueSoonDays: doc.maintenanceDueSoonDays,
      showDepreciationEstimate: doc.showDepreciationEstimate,
      isDefault: false,
      revision: doc.revision,
    };
  }

  async update(
    organizationId: string,
    body: UpdateAssetSettingsBody,
    actor: AssetActor,
  ): Promise<AssetSettingsView> {
    const current = await this.view(organizationId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const next = {
      reminderDays: body.reminderDays ?? current.reminderDays,
      maintenanceDueSoonDays: body.maintenanceDueSoonDays ?? current.maintenanceDueSoonDays,
      showDepreciationEstimate: body.showDepreciationEstimate ?? current.showDepreciationEstimate,
      updatedBy: actor.userId,
    };
    try {
      if (current.revision === 0) {
        await this.settings.create({ organizationId, ...next, revision: 1, _schemaVersion: 1 });
      } else {
        const res = await this.settings
          .updateOne(
            { organizationId, revision: current.revision },
            { $set: next, $inc: { revision: 1 } },
          )
          .exec();
        if (res.matchedCount !== 1) staleRevision((await this.view(organizationId)).revision);
      }
    } catch (err) {
      if (isDuplicateKey(err)) staleRevision((await this.view(organizationId)).revision);
      throw err;
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'assets.settings.updated',
      targetType: 'asset_settings',
      targetId: organizationId,
    });
    return this.view(organizationId);
  }

  // ── Catégories ─────────────────────────────────────────────────────────────

  /** Pose les catégories proposées si l'organisation n'en a aucune (idempotent). */
  private async seed(organizationId: string, actorUserId: string): Promise<void> {
    if ((await this.categories.countDocuments({ organizationId }).exec()) > 0) return;
    for (const name of ASSET_DEFAULT_CATEGORIES) {
      try {
        await this.categories.create({
          organizationId,
          name,
          nameKey: normalizeForSearch(name),
          active: true,
          revision: 1,
          createdBy: actorUserId,
          updatedBy: actorUserId,
          _schemaVersion: 1,
        });
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
      }
    }
  }

  async listCategories(organizationId: string, actorUserId: string): Promise<AssetCategoryView[]> {
    await this.seed(organizationId, actorUserId);
    const [docs, counts] = await Promise.all([
      this.categories
        .find({ organizationId })
        .sort({ nameKey: 1 })
        .lean<AssetCategoryLean[]>()
        .exec(),
      this.assets
        .aggregate<{ _id: string; n: number }>([
          { $match: { organizationId } },
          { $group: { _id: '$categoryId', n: { $sum: 1 } } },
        ])
        .exec(),
    ]);
    const n = new Map(counts.map((c) => [c._id, c.n]));
    return docs.map((d) => this.categoryView(d, n.get(String(d._id)) ?? 0));
  }

  /** Catégorie de l'organisation, ou 404 (identifiant forgé compris). */
  async requireCategory(organizationId: string, categoryId: string): Promise<AssetCategoryLean> {
    if (!isObjectIdHex(categoryId)) categoryNotFound();
    const doc = await this.categories
      .findOne({ _id: new Types.ObjectId(categoryId), organizationId })
      .lean<AssetCategoryLean>()
      .exec();
    if (!doc) categoryNotFound();
    return doc;
  }

  /** Catégorie ACTIVE de l'organisation (pose les catégories proposées au besoin). */
  async requireActiveCategory(
    organizationId: string,
    categoryId: string,
    actorUserId: string,
  ): Promise<AssetCategoryLean> {
    await this.seed(organizationId, actorUserId);
    const doc = await this.requireCategory(organizationId, categoryId);
    if (!doc.active) conflict('ASSET_CATEGORY_ARCHIVED', 'Cette catégorie est archivée.');
    return doc;
  }

  async categoryNames(organizationId: string): Promise<Map<string, string>> {
    const docs = await this.categories
      .find({ organizationId }, { name: 1 })
      .lean<AssetCategoryLean[]>()
      .exec();
    return new Map(docs.map((d) => [String(d._id), d.name]));
  }

  async createCategory(
    organizationId: string,
    body: CreateAssetCategoryBody,
    actor: AssetActor,
  ): Promise<AssetCategoryView> {
    await this.seed(organizationId, actor.userId);
    let created: AssetCategoryDocument;
    try {
      created = await this.categories.create({
        organizationId,
        name: body.name,
        nameKey: normalizeForSearch(body.name),
        active: true,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
    } catch (err) {
      if (isDuplicateKey(err)) nameExists();
      throw err;
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'assets.category.created',
      targetType: 'asset_category',
      targetId: String(created._id),
    });
    return this.categoryView(created.toObject() as AssetCategoryLean, 0);
  }

  async updateCategory(
    organizationId: string,
    categoryId: string,
    body: UpdateAssetCategoryBody,
    actor: AssetActor,
  ): Promise<AssetCategoryView> {
    const current = await this.requireCategory(organizationId, categoryId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const set: Record<string, unknown> = { updatedBy: actor.userId };
    if (body.name !== undefined) {
      set['name'] = body.name;
      set['nameKey'] = normalizeForSearch(body.name);
    }
    if (body.active !== undefined) set['active'] = body.active;
    try {
      const res = await this.categories
        .updateOne(
          { _id: current._id, organizationId, revision: current.revision },
          { $set: set, $inc: { revision: 1 } },
        )
        .exec();
      if (res.matchedCount !== 1) {
        staleRevision((await this.requireCategory(organizationId, categoryId)).revision);
      }
    } catch (err) {
      if (isDuplicateKey(err)) nameExists();
      throw err;
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'assets.category.updated',
      targetType: 'asset_category',
      targetId: categoryId,
    });
    const doc = await this.requireCategory(organizationId, categoryId);
    const count = await this.assets.countDocuments({ organizationId, categoryId }).exec();
    return this.categoryView(doc, count);
  }

  private categoryView(d: AssetCategoryLean, assetCount: number): AssetCategoryView {
    return {
      id: String(d._id),
      name: d.name,
      active: d.active,
      assetCount,
      revision: d.revision,
    };
  }
}
