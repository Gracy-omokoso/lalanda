// Fiche GROW de l'organisation (ADR-0032 § 1, § 6) — la seule écriture de GROW.
//
// Les écritures visent `grow_profiles` et le journal d'audit, rien d'autre. Les
// modèles de BUILD et de RUN injectés ici ne servent qu'à VÉRIFIER qu'un projet ou
// un article appartient à l'organisation (lecture) : `grow-readonly.surface.test.ts`
// le contrôle.

import {
  GROW_CHECKLISTS_V2,
  JOURNEY_STAGES,
  kinshasaDateOf,
  type JourneyStage,
} from '@lalanda/engine';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { Project } from '../projects/project.schema.js';
import { CatalogItem } from '../sales/catalog-item.schema.js';
import { GrowProfile, type StoredDeclaredCash } from './grow-profile.schema.js';
import type { PutDeclaredCash, PutGrowProfile } from './grow.dto.js';

export interface GrowActor {
  userId: string;
  role: string;
}

export interface GrowProfileView {
  referenceProjectId: string | null;
  declaredStage: JourneyStage | null;
  recurringCatalogItemIds: string[];
  checklistDone: string[];
  declaredCash: (Omit<StoredDeclaredCash, 'declaredAt'> & { declaredAt: string }) | null;
  updatedAt: string | null;
}

type ProfileLean = GrowProfile & { _id: Types.ObjectId };

const EMPTY: GrowProfileView = Object.freeze({
  referenceProjectId: null,
  declaredStage: null,
  recurringCatalogItemIds: [],
  checklistDone: [],
  declaredCash: null,
  updatedAt: null,
}) as GrowProfileView;

function toView(doc: ProfileLean | null): GrowProfileView {
  if (!doc) return { ...EMPTY, recurringCatalogItemIds: [], checklistDone: [] };
  return {
    referenceProjectId: doc.referenceProjectId ?? null,
    declaredStage: (JOURNEY_STAGES as readonly string[]).includes(doc.declaredStage ?? '')
      ? doc.declaredStage
      : null,
    recurringCatalogItemIds: [...(doc.recurringCatalogItemIds ?? [])],
    checklistDone: [...(doc.checklistDone ?? [])],
    declaredCash: doc.declaredCash
      ? {
          amount: doc.declaredCash.amount,
          currency: doc.declaredCash.currency,
          asOf: doc.declaredCash.asOf,
          declaredBy: doc.declaredCash.declaredBy,
          declaredAt: new Date(doc.declaredCash.declaredAt).toISOString(),
        }
      : null,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}

/** Points de checklist qui se cochent à la main (les autres viennent des données). */
const MANUAL_ITEMS: ReadonlySet<string> = new Set(
  JOURNEY_STAGES.flatMap((s) => GROW_CHECKLISTS_V2[s].filter((i) => !i.auto).map((i) => i.id)),
);
const AUTO_ITEMS: ReadonlySet<string> = new Set(
  JOURNEY_STAGES.flatMap((s) => GROW_CHECKLISTS_V2[s].filter((i) => i.auto).map((i) => i.id)),
);

@Injectable()
export class GrowProfileService {
  constructor(
    @InjectModel(GrowProfile.name) private readonly profileModel: Model<GrowProfile>,
    @InjectModel(Project.name) private readonly projects: Model<Project>,
    @InjectModel(CatalogItem.name) private readonly catalog: Model<CatalogItem>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Lecture sans effet de bord : une organisation sans fiche reçoit une fiche vide. */
  async get(orgId: string): Promise<GrowProfileView> {
    return toView(await this.profileModel.findOne({ organizationId: orgId }).lean<ProfileLean>());
  }

  async update(orgId: string, body: PutGrowProfile, actor: GrowActor): Promise<GrowProfileView> {
    if (body.referenceProjectId !== null) {
      const owned = await this.projects.exists({
        _id: new Types.ObjectId(body.referenceProjectId),
        organizationId: orgId,
      });
      if (!owned) {
        throw new NotFoundException({
          code: 'PROJECT_NOT_FOUND',
          message: 'Projet introuvable dans votre organisation.',
        });
      }
    }
    if (body.recurringCatalogItemIds.length > 0) {
      const found = await this.catalog.countDocuments({
        _id: { $in: body.recurringCatalogItemIds.map((id) => new Types.ObjectId(id)) },
        organizationId: orgId,
      });
      if (found !== body.recurringCatalogItemIds.length) {
        throw new NotFoundException({
          code: 'CATALOG_ITEM_NOT_FOUND',
          message: 'Un des articles déclarés récurrents est introuvable dans votre catalogue.',
        });
      }
    }
    const doc = await this.profileModel
      .findOneAndUpdate(
        { organizationId: orgId },
        {
          $set: {
            referenceProjectId: body.referenceProjectId,
            declaredStage: body.declaredStage,
            recurringCatalogItemIds: body.recurringCatalogItemIds,
            updatedBy: actor.userId,
          },
          $setOnInsert: { organizationId: orgId, _schemaVersion: 1 },
        },
        { upsert: true, new: true },
      )
      .lean<ProfileLean>();
    await this.audit.record({
      organizationId: orgId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'grow.profile.updated',
      targetType: 'grow_profile',
      targetId: orgId,
      metadata: {
        referenceProjectId: body.referenceProjectId,
        declaredStage: body.declaredStage,
        recurringItems: body.recurringCatalogItemIds.length,
      },
    });
    return toView(doc);
  }

  async setChecklistItem(
    orgId: string,
    itemId: string,
    done: boolean,
    actor: GrowActor,
  ): Promise<GrowProfileView> {
    if (AUTO_ITEMS.has(itemId)) {
      throw new BadRequestException({
        code: 'CHECKLIST_ITEM_AUTOMATIC',
        message: 'Ce point se coche de lui-même à partir de vos données.',
      });
    }
    if (!MANUAL_ITEMS.has(itemId)) {
      throw new NotFoundException({
        code: 'CHECKLIST_ITEM_NOT_FOUND',
        message: 'Point de checklist inconnu.',
      });
    }
    const doc = await this.profileModel
      .findOneAndUpdate(
        { organizationId: orgId },
        {
          ...(done
            ? { $addToSet: { checklistDone: itemId } }
            : { $pull: { checklistDone: itemId } }),
          $set: { updatedBy: actor.userId },
          $setOnInsert: { organizationId: orgId, _schemaVersion: 1 },
        },
        { upsert: true, new: true },
      )
      .lean<ProfileLean>();
    await this.audit.record({
      organizationId: orgId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'grow.checklist.updated',
      targetType: 'grow_profile',
      targetId: orgId,
      metadata: { itemId, done },
    });
    return toView(doc);
  }

  async setDeclaredCash(
    orgId: string,
    body: PutDeclaredCash,
    actor: GrowActor,
    now: Date = new Date(),
  ): Promise<GrowProfileView> {
    const today = kinshasaDateOf(now.toISOString())!;
    const probe = new Date(`${body.asOf}T00:00:00.000Z`);
    if (!Number.isFinite(probe.getTime()) || probe.toISOString().slice(0, 10) !== body.asOf) {
      throw new BadRequestException({ code: 'INVALID_DATE', message: 'Date inexistante.' });
    }
    if (body.asOf > today) {
      throw new BadRequestException({
        code: 'DATE_IN_FUTURE',
        message: 'Un solde se déclare à une date passée ou du jour.',
      });
    }
    const declaredCash: StoredDeclaredCash = {
      amount: body.amount,
      currency: body.currency,
      asOf: body.asOf,
      declaredBy: actor.userId,
      declaredAt: now,
    };
    const doc = await this.profileModel
      .findOneAndUpdate(
        { organizationId: orgId },
        {
          $set: { declaredCash, updatedBy: actor.userId },
          $setOnInsert: { organizationId: orgId, _schemaVersion: 1 },
        },
        { upsert: true, new: true },
      )
      .lean<ProfileLean>();
    await this.audit.record({
      organizationId: orgId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'grow.declared_cash.updated',
      targetType: 'grow_profile',
      targetId: orgId,
      metadata: { amount: body.amount, currency: body.currency, asOf: body.asOf },
    });
    return toView(doc);
  }

  async clearDeclaredCash(orgId: string, actor: GrowActor): Promise<GrowProfileView> {
    const doc = await this.profileModel
      .findOneAndUpdate(
        { organizationId: orgId },
        { $set: { declaredCash: null, updatedBy: actor.userId } },
        { new: true },
      )
      .lean<ProfileLean>();
    await this.audit.record({
      organizationId: orgId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'grow.declared_cash.cleared',
      targetType: 'grow_profile',
      targetId: orgId,
    });
    return toView(doc);
  }
}
