// Réglages du pipeline — ADR-0035 § 2.
//
// Un document par organisation, créé à la première écriture : sans document,
// les réglages par défaut s'appliquent (révision 0). Retirer une étape utilisée
// par une opportunité, ou changer la nature d'une étape existante, est refusé :
// l'historique des opportunités et la probabilité par étape en dépendent.

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { conflict, isDuplicateKey, staleRevision } from '../sales/sales.errors.js';
import {
  DEFAULT_STAGES,
  DEFAULT_STALE_AFTER_DAYS,
  stageChangeConflicts,
  type PipelineStage,
} from './crm-model.js';
import type { CrmSettingsInput } from './crm.dto.js';
import {
  CrmOpportunity,
  CrmSettings,
  type CrmOpportunityDocument,
  type CrmSettingsDocument,
} from './crm.schemas.js';

export interface CrmActor {
  userId: string;
  role: string;
}

export interface CrmSettingsView {
  stages: PipelineStage[];
  autoWinOnQuoteAccepted: boolean;
  staleAfterDays: number;
  /** 0 : réglages par défaut, jamais enregistrés. */
  revision: number;
  updatedAt: string | null;
}

type SettingsLean = CrmSettings & { _id: unknown };

@Injectable()
export class CrmSettingsService {
  constructor(
    @InjectModel(CrmSettings.name) private readonly settings: Model<CrmSettingsDocument>,
    @InjectModel(CrmOpportunity.name)
    private readonly opportunities: Model<CrmOpportunityDocument>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async get(organizationId: string): Promise<CrmSettingsView> {
    const doc = await this.settings.findOne({ organizationId }).lean<SettingsLean>().exec();
    if (!doc) {
      return {
        stages: DEFAULT_STAGES.map((s) => ({ ...s })),
        autoWinOnQuoteAccepted: true,
        staleAfterDays: DEFAULT_STALE_AFTER_DAYS,
        revision: 0,
        updatedAt: null,
      };
    }
    return {
      stages: doc.stages.map((s) => ({ key: s.key, label: s.label, kind: s.kind })),
      autoWinOnQuoteAccepted: doc.autoWinOnQuoteAccepted,
      staleAfterDays: doc.staleAfterDays,
      revision: doc.revision,
      updatedAt: new Date(doc.updatedAt).toISOString(),
    };
  }

  async put(
    organizationId: string,
    expectedRevision: number,
    input: CrmSettingsInput,
    actor: CrmActor,
  ): Promise<CrmSettingsView> {
    const current = await this.get(organizationId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);

    const used = new Set<string>(
      (await this.opportunities.distinct('stageKey', { organizationId }).exec()) as string[],
    );
    const { removed, kindChanged } = stageChangeConflicts(current.stages, input.stages, used);
    if (removed.length > 0) {
      conflict(
        'CRM_STAGE_IN_USE',
        'Une étape utilisée par des opportunités ne peut pas être retirée : déplacez-les d’abord.',
        { stageKeys: removed },
      );
    }
    if (kindChanged.length > 0) {
      conflict(
        'CRM_STAGE_KIND_CHANGED',
        'La nature d’une étape existante (en cours, gagnée, perdue) ne change pas : créez une autre étape.',
        { stageKeys: kindChanged },
      );
    }

    const set = {
      stages: input.stages,
      autoWinOnQuoteAccepted: input.autoWinOnQuoteAccepted,
      staleAfterDays: input.staleAfterDays,
      updatedBy: actor.userId,
    };
    if (expectedRevision === 0) {
      try {
        await this.settings.create({ organizationId, ...set, revision: 1, _schemaVersion: 1 });
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        staleRevision((await this.get(organizationId)).revision);
      }
    } else {
      const res = await this.settings
        .updateOne(
          { organizationId, revision: expectedRevision },
          { $set: set, $inc: { revision: 1 } },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision((await this.get(organizationId)).revision);
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'crm.settings_updated',
      targetType: 'crm_settings',
      targetId: organizationId,
      metadata: {
        stages: input.stages.length,
        autoWinOnQuoteAccepted: input.autoWinOnQuoteAccepted,
        staleAfterDays: input.staleAfterDays,
      },
    });
    return this.get(organizationId);
  }
}
