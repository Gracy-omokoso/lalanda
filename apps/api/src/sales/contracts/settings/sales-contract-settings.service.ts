// Réglages des contrats — ADR-0050 § 2.1. ADR-0050 — V3.
//
// Lecture : le réglage enregistré, ou le défaut implicite (`revision: null`). Écriture :
// corps COMPLET, `expectedRevision: null` pour la première, sinon la révision lue
// (`409 STALE_REVISION`). Audit de chaque changement. Lu par les contrats (approbateur
// unique, fin de terme) et, plus tard, par la tâche des abonnements (V5) et l'agenda (V6).

import {
  SALES_CONTRACT_SETTINGS_DEFAULTS,
  type SalesContractSettingsValues,
} from '@lalanda/shared/sales-contracts';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../../../authz/audit.service.js';
import type { InvoiceActor } from '../../invoices/invoice.types.js';
import { isDuplicateKey, staleRevision } from '../../sales.errors.js';
import {
  SalesContractSettings,
  type SalesContractSettingsDocument,
  type SalesContractSettingsLean,
} from './sales-contract-settings.schema.js';

export interface SalesContractSettingsView extends SalesContractSettingsValues {
  /** `null` : défaut implicite, rien d'enregistré. */
  revision: number | null;
  updatedAt: string | null;
}

export interface SalesContractSettingsInput extends SalesContractSettingsValues {
  expectedRevision: number | null;
}

function valuesOf(s: SalesContractSettingsValues): SalesContractSettingsValues {
  return {
    noticeAlertDays: s.noticeAlertDays,
    termEndAlertDays: s.termEndAlertDays,
    subscriptionLeadDays: s.subscriptionLeadDays,
    autoPrepareSubscriptionDrafts: s.autoPrepareSubscriptionDrafts,
    allowSoleApprover: s.allowSoleApprover,
  };
}

@Injectable()
export class SalesContractSettingsService {
  constructor(
    @InjectModel(SalesContractSettings.name)
    private readonly settings: Model<SalesContractSettingsDocument>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Valeurs en vigueur (défaut implicite sans réglage). */
  async values(organizationId: string): Promise<SalesContractSettingsValues> {
    return valuesOf(await this.view(organizationId));
  }

  async view(organizationId: string): Promise<SalesContractSettingsView> {
    const doc = await this.settings
      .findOne({ organizationId })
      .lean<SalesContractSettingsLean>()
      .exec();
    if (!doc) return { ...SALES_CONTRACT_SETTINGS_DEFAULTS, revision: null, updatedAt: null };
    return {
      ...valuesOf(doc),
      revision: doc.revision,
      updatedAt: new Date(doc.updatedAt).toISOString(),
    };
  }

  async put(
    organizationId: string,
    input: SalesContractSettingsInput,
    actor: InvoiceActor,
  ): Promise<SalesContractSettingsView> {
    const before = await this.view(organizationId);
    const values = valuesOf(input);
    if (input.expectedRevision === null) {
      if (before.revision !== null) staleRevision(before.revision);
      try {
        await this.settings.create({
          organizationId,
          ...values,
          revision: 1,
          createdBy: actor.userId,
          updatedBy: actor.userId,
          _schemaVersion: 1,
        });
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        const again = await this.view(organizationId);
        staleRevision(again.revision ?? 1);
      }
    } else {
      const updated = await this.settings
        .findOneAndUpdate(
          { organizationId, revision: input.expectedRevision },
          { $set: { ...values, updatedBy: actor.userId }, $inc: { revision: 1 } },
          { new: true },
        )
        .lean<SalesContractSettingsLean>()
        .exec();
      if (!updated) {
        const again = await this.view(organizationId);
        // Rien d'enregistré : la première écriture attend `expectedRevision: null`.
        staleRevision(again.revision ?? 0);
      }
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      targetType: 'sales_contract_settings',
      targetId: organizationId,
      action: 'sales_contract_settings.updated',
      metadata: { before: { ...valuesOf(before) }, after: { ...values } },
    });
    return this.view(organizationId);
  }
}
