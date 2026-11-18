// Horloge de l'organisation — ADR-0080.
//
// Les heures de début et d'échéance des Projets, « aujourd'hui » et « en retard »
// se lisent dans le FUSEAU DE L'ORGANISATION, réglé dans les paramètres de
// l'organisation (`organization_settings.fuseauHoraire`, écrit par
// `organization-space/`, lu ici seulement). Sans réglage : Kinshasa, la règle
// d'avant (ADR-0027). Une lecture indexée (`organizationId` unique) par appel,
// sans cache : un changement de fuseau s'applique à la requête suivante.

import { orgClock, workTimeZoneOr, type OrgClock, type WorkTimeZone } from '@lalanda/shared/work';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import {
  OrganizationSettings,
  type OrganizationSettingsDocument,
} from '../organization-space/organization-settings.schema.js';

export type WorkOrgClock = OrgClock & { timeZone: WorkTimeZone };

@Injectable()
export class WorkClockService {
  constructor(
    @InjectModel(OrganizationSettings.name)
    private readonly orgSettings: Model<OrganizationSettingsDocument>,
  ) {}

  /** Fuseau de l'organisation (Kinshasa sans réglage). */
  async timeZoneOf(organizationId: string): Promise<WorkTimeZone> {
    const doc = await this.orgSettings
      .findOne({ organizationId }, { fuseauHoraire: 1 })
      .lean<{ fuseauHoraire?: string }>()
      .exec();
    return workTimeZoneOr(doc?.fuseauHoraire);
  }

  /** Fuseaux de plusieurs organisations (tâches récurrentes). */
  async timeZonesOf(organizationIds: readonly string[]): Promise<Map<string, WorkTimeZone>> {
    const docs = await this.orgSettings
      .find(
        { organizationId: { $in: [...organizationIds] } },
        { organizationId: 1, fuseauHoraire: 1 },
      )
      .lean<{ organizationId: string; fuseauHoraire?: string }[]>()
      .exec();
    const out = new Map<string, WorkTimeZone>();
    for (const id of organizationIds) out.set(id, workTimeZoneOr(undefined));
    for (const d of docs) out.set(d.organizationId, workTimeZoneOr(d.fuseauHoraire));
    return out;
  }

  /** « Maintenant » (jour, heure) dans le fuseau de l'organisation, et ce fuseau. */
  async clockOf(organizationId: string, now: Date = new Date()): Promise<WorkOrgClock> {
    const timeZone = await this.timeZoneOf(organizationId);
    return { ...orgClock(now, timeZone), timeZone };
  }
}
