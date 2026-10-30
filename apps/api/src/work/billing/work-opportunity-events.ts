// Fournisseur « opportunité gagnée » du CRM — ADR-0040 — C7 § 5.4 et § 6.4.
//
// Remplace `NO_OPPORTUNITY_EVENTS` (point d'extension posé par C2,
// `crm/opportunity-events.ts`) dans `crm.module.ts`. Deux rôles :
//
//   - `onWon` : notification `crm.opportunity_won` au SEUL responsable de
//     l'opportunité (décision ouverte n° 13), jamais à l'auteur du geste ; texte
//     « Créer le projet ? » si aucun projet n'existe encore. IDEMPOTENT : la clé
//     de déduplication vaut (opportunité, passage en gagné) — le devis pour un
//     gain par devis accepté (stable si l'écriture est rejouée), l'instant du
//     gain sinon. Ne lève jamais : une notification perdue ne défait pas le gain ;
//   - `projectExists` : la réponse de `move` porte la suggestion
//     `CREATE_PROJECT` si aucun projet n'existe pour l'opportunité ni pour un de
//     ses devis.
//
// Aucun projet n'est créé ici (« jamais automatique », D4) : la création reste
// le geste `POST /work/projects/from-opportunity` d'un détenteur de `work.manage`.
// Lecture seule de `work_projects` et de `crm_opportunities`.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { CrmNotifier } from '../../crm/crm-notifier.js';
import { CrmOpportunity } from '../../crm/crm.schemas.js';
import type { CrmOpportunityEvents, OpportunityWonEvent } from '../../crm/opportunity-events.js';
import { WorkProject, type WorkProjectDocument } from '../work.schemas.js';

/** Titre de l'opportunité repris dans la notification (le reste du titre est figé). */
const TITLE_EXCERPT_MAX = 150;

/**
 * Projets « issus » d'une opportunité : créés depuis elle (sans devis), ou depuis
 * un de ses devis (`from-quote` pose `links.opportunityId`). Un projet créé à la
 * main et seulement relié à l'opportunité n'en est pas issu.
 */
export function opportunityProjectFilter(
  organizationId: string,
  opportunityId: string,
): Record<string, unknown> {
  return {
    organizationId,
    $or: [
      { 'source.kind': 'opportunity', 'source.opportunityId': opportunityId },
      { 'source.kind': 'quote', 'links.opportunityId': opportunityId },
    ],
  };
}

/** Clé de déduplication d'un passage en gagné (≤ 200 caractères). */
export function opportunityWonDedupeKey(event: OpportunityWonEvent): string {
  const passage = event.quoteId ? `quote:${event.quoteId}` : `at:${event.wonAt.toISOString()}`;
  return `crm.opportunity_won:${event.opportunityId}:${passage}`;
}

/** Titre de la notification ; « Créer le projet ? » tant qu'aucun projet n'existe. */
export function opportunityWonTitle(title: string, hasProject: boolean): string {
  const t = title.length <= TITLE_EXCERPT_MAX ? title : `${title.slice(0, TITLE_EXCERPT_MAX - 1)}…`;
  return hasProject ? `Opportunité gagnée : ${t}` : `Opportunité gagnée : ${t}. Créer le projet ?`;
}

@Injectable()
export class WorkOpportunityEvents implements CrmOpportunityEvents {
  private readonly logger = new Logger('WorkOpportunityEvents');

  constructor(
    @InjectModel(WorkProject.name) private readonly projects: Model<WorkProjectDocument>,
    @InjectModel(CrmOpportunity.name) private readonly opportunities: Model<CrmOpportunity>,
    @Inject(CrmNotifier) private readonly notifier: CrmNotifier,
  ) {}

  async projectExists(organizationId: string, opportunityId: string): Promise<boolean> {
    const n = await this.projects
      .countDocuments(opportunityProjectFilter(organizationId, opportunityId), { limit: 1 })
      .exec();
    return n > 0;
  }

  async onWon(event: OpportunityWonEvent): Promise<void> {
    if (!event.ownerId || !Types.ObjectId.isValid(event.opportunityId)) return;
    try {
      const opp = await this.opportunities
        .findOne(
          { _id: new Types.ObjectId(event.opportunityId), organizationId: event.organizationId },
          { title: 1 },
        )
        .lean<{ title: string }>()
        .exec();
      if (!opp) return;
      const hasProject = await this.projectExists(event.organizationId, event.opportunityId);
      await this.notifier.opportunityEvent({
        kind: 'crm.opportunity_won',
        organizationId: event.organizationId,
        opportunityId: event.opportunityId,
        recipients: [event.ownerId],
        title: opportunityWonTitle(opp.title, hasProject),
        href: `/crm/opportunites/${event.opportunityId}`,
        actorUserId: event.actorUserId,
        dedupeKey: opportunityWonDedupeKey(event),
      });
    } catch (err) {
      this.logger.warn(
        `Notification « opportunité gagnée » non émise (${event.opportunityId}) : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
