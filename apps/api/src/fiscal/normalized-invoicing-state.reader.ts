// Lecture SEULE du réglage de facture normalisée — ADR-0021 §3 (R4).
//
// `NormalizedInvoicingService` est le seul écrivain de la collection ; les
// autres services du module (fiche fiscale, points de vente) ont besoin de
// l'état pour leurs verrous, sans pouvoir le modifier. Ce lecteur rompt aussi la
// dépendance circulaire : `NormalizedInvoicingService` dépend des points de
// vente pour ses prérequis, les points de vente dépendent de l'état.
//
// Ce fichier ne doit contenir AUCUNE méthode d'écriture : le test
// `normalized-invoicing.writer.test.ts` le vérifie.

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type { EdefEnvironment } from '../platform-config/dgi-platform.config.js';
import {
  NormalizedInvoicingSettings,
  type NormalizedInvoicingSettingsDocument,
  type NormalizedInvoicingState,
} from './normalized-invoicing-settings.schema.js';

export interface NormalizedInvoicingSnapshot {
  state: NormalizedInvoicingState;
  environment: EdefEnvironment;
  firstActivatedAt: Date | null;
  activatedAt: Date | null;
  deactivatedAt: Date | null;
  deactivationReason: string | null;
}

export const DEFAULT_SNAPSHOT: NormalizedInvoicingSnapshot = Object.freeze({
  state: 'disabled',
  environment: 'test',
  firstActivatedAt: null,
  activatedAt: null,
  deactivatedAt: null,
  deactivationReason: null,
});

@Injectable()
export class NormalizedInvoicingStateReader {
  constructor(
    @InjectModel(NormalizedInvoicingSettings.name)
    private readonly model: Model<NormalizedInvoicingSettingsDocument>,
  ) {}

  async read(organizationId: string): Promise<NormalizedInvoicingSnapshot> {
    const doc = await this.model.findOne({ organizationId }).lean().exec();
    if (!doc) return DEFAULT_SNAPSHOT;
    return {
      state: doc.state,
      environment: doc.environment,
      firstActivatedAt: doc.firstActivatedAt ?? null,
      activatedAt: doc.activatedAt ?? null,
      deactivatedAt: doc.deactivatedAt ?? null,
      deactivationReason: doc.deactivationReason ?? null,
    };
  }

  /** Organisations (autres que `exceptOrganizationId`) où la facture normalisée est activée. */
  async enabledOrganizationsIn(
    environment: EdefEnvironment,
    exceptOrganizationId: string,
  ): Promise<string[]> {
    const docs = await this.model
      .find(
        { state: 'enabled', environment, organizationId: { $ne: exceptOrganizationId } },
        { organizationId: 1 },
      )
      .lean()
      .exec();
    return docs.map((d) => d.organizationId);
  }
}
