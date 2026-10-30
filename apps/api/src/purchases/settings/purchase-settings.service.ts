// Réglages des achats — ADR-0044 § 2.2, § 3.7. ADR-0044 — P3.
//
// Lecture : le document de l'organisation, ou les valeurs par défaut (révision 0).
// Écriture : champs absents inchangés, paliers vérifiés par le moteur
// (`checkApprovalTiers`), `expectedRevision` → `409 STALE_REVISION`, audit
// `purchase_settings.updated` dans la même transaction (avant et après).

import { checkApprovalTiers } from '@lalanda/engine';
import {
  PURCHASE_CURRENCIES,
  PURCHASE_SETTINGS_DEFAULTS,
  type PurchaseApprovalCount,
  type PurchaseCurrency,
  type PurchaseSettingsView,
  type UpdatePurchaseSettingsBody,
} from '@lalanda/shared/purchases';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { AuditService, type AuditMetadataValue } from '../../authz/audit.service.js';
import { invalidRequestOf, isDuplicateKey, staleRevision } from '../../sales/sales.errors.js';
import {
  PurchaseSettings,
  type PurchaseSettingsDocument,
  type PurchaseSettingsLean,
} from './purchase-settings.schema.js';

export interface PurchaseSettingsActor {
  userId: string;
  role: string;
}

/** Réglages effectifs (valeurs par défaut comprises), tels que les services les lisent. */
export type EffectivePurchaseSettings = Omit<PurchaseSettingsView, 'updatedAt'>;

export function defaultPurchaseSettings(): EffectivePurchaseSettings {
  const d = PURCHASE_SETTINGS_DEFAULTS;
  return {
    approvalTiers: {
      CDF: d.approvalTiers.CDF.map((t) => ({ from: t.from, approvals: t.approvals })),
      USD: d.approvalTiers.USD.map((t) => ({ from: t.from, approvals: t.approvals })),
    },
    allowSoleApprover: d.allowSoleApprover,
    matchingTolerances: {
      pricePercent: d.matchingTolerances.pricePercent,
      amountAbsolute: { ...d.matchingTolerances.amountAbsolute },
    },
    dueSoonDays: d.dueSoonDays,
    requireOrderForInvoice: d.requireOrderForInvoice,
    paymentDetailsAlertDays: d.paymentDetailsAlertDays,
    revision: 0,
  };
}

function viewOf(doc: PurchaseSettingsLean): PurchaseSettingsView {
  return {
    approvalTiers: {
      CDF: doc.approvalTiers.CDF.map((t) => ({ from: t.from, approvals: t.approvals })),
      USD: doc.approvalTiers.USD.map((t) => ({ from: t.from, approvals: t.approvals })),
    },
    allowSoleApprover: doc.allowSoleApprover,
    matchingTolerances: {
      pricePercent: doc.matchingTolerances.pricePercent,
      amountAbsolute: {
        CDF: doc.matchingTolerances.amountAbsolute.CDF,
        USD: doc.matchingTolerances.amountAbsolute.USD,
      },
    },
    dueSoonDays: doc.dueSoonDays,
    requireOrderForInvoice: doc.requireOrderForInvoice,
    paymentDetailsAlertDays: doc.paymentDetailsAlertDays,
    revision: doc.revision,
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

function auditTiers(
  tiers: Record<PurchaseCurrency, { from: string; approvals: PurchaseApprovalCount }[]>,
): AuditMetadataValue {
  return {
    CDF: tiers.CDF.map((t) => `${t.from}:${t.approvals}`),
    USD: tiers.USD.map((t) => `${t.from}:${t.approvals}`),
  };
}

@Injectable()
export class PurchaseSettingsService {
  constructor(
    @InjectModel(PurchaseSettings.name) private readonly settings: Model<PurchaseSettingsDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async view(organizationId: string): Promise<PurchaseSettingsView> {
    const doc = await this.settings.findOne({ organizationId }).lean<PurchaseSettingsLean>().exec();
    return doc ? viewOf(doc) : { ...defaultPurchaseSettings(), updatedAt: null };
  }

  /** Réglages effectifs, pour les autres services des achats. */
  async effective(organizationId: string): Promise<EffectivePurchaseSettings> {
    const { updatedAt: _ignored, ...rest } = await this.view(organizationId);
    return rest;
  }

  async update(
    organizationId: string,
    body: UpdatePurchaseSettingsBody,
    actor: PurchaseSettingsActor,
  ): Promise<PurchaseSettingsView> {
    if (body.approvalTiers) {
      const issues = PURCHASE_CURRENCIES.flatMap((currency) =>
        checkApprovalTiers(body.approvalTiers![currency]).issues.map((i) => ({
          path: `approvalTiers.${currency}${i.tierIndex === null ? '' : `.${i.tierIndex}`}`,
          code: i.code,
          message: i.message,
        })),
      );
      if (issues.length > 0) invalidRequestOf(issues);
    }
    const before = await this.view(organizationId);
    if (before.revision !== body.expectedRevision) staleRevision(before.revision);
    const next: EffectivePurchaseSettings = {
      approvalTiers: body.approvalTiers
        ? {
            CDF: body.approvalTiers.CDF.map((t) => ({
              from: t.from,
              approvals: t.approvals as PurchaseApprovalCount,
            })),
            USD: body.approvalTiers.USD.map((t) => ({
              from: t.from,
              approvals: t.approvals as PurchaseApprovalCount,
            })),
          }
        : before.approvalTiers,
      allowSoleApprover: body.allowSoleApprover ?? before.allowSoleApprover,
      matchingTolerances: body.matchingTolerances ?? before.matchingTolerances,
      dueSoonDays: body.dueSoonDays ?? before.dueSoonDays,
      requireOrderForInvoice: body.requireOrderForInvoice ?? before.requireOrderForInvoice,
      paymentDetailsAlertDays: body.paymentDetailsAlertDays ?? before.paymentDetailsAlertDays,
      revision: before.revision + 1,
    };
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const { revision, ...fields } = next;
        if (before.revision === 0) {
          try {
            await this.settings.create(
              [
                {
                  organizationId,
                  ...fields,
                  revision,
                  createdBy: actor.userId,
                  updatedBy: actor.userId,
                  _schemaVersion: 1,
                },
              ],
              { session },
            );
          } catch (err) {
            // Création concurrente : l'autre a gagné, la révision lue est périmée.
            if (isDuplicateKey(err)) staleRevision(1);
            throw err;
          }
        } else {
          const r = await this.settings
            .updateOne(
              { organizationId, revision: before.revision },
              { $set: { ...fields, updatedBy: actor.userId }, $inc: { revision: 1 } },
              { session },
            )
            .exec();
          if (r.matchedCount === 0) staleRevision(before.revision + 1);
        }
        await this.audit.recordStrict(
          {
            organizationId,
            actorUserId: actor.userId,
            actorRole: actor.role,
            action: 'purchase_settings.updated',
            targetType: 'purchase_settings',
            targetId: organizationId,
            metadata: {
              before: {
                approvalTiers: auditTiers(before.approvalTiers),
                allowSoleApprover: before.allowSoleApprover,
                pricePercent: before.matchingTolerances.pricePercent,
                dueSoonDays: before.dueSoonDays,
              },
              after: {
                approvalTiers: auditTiers(next.approvalTiers),
                allowSoleApprover: next.allowSoleApprover,
                pricePercent: next.matchingTolerances.pricePercent,
                dueSoonDays: next.dueSoonDays,
              },
            },
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    return this.view(organizationId);
  }
}
