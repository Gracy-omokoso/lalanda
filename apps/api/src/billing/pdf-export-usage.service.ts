// Comptage des exports PDF.
//
// `record()` NE FAIT PAS ÉCHOUER l'export qu'il compte : perdre une ligne de
// comptage est sans commune mesure avec refuser à l'utilisateur un fichier déjà
// rendu, déjà payé en CPU, et déjà journalisé à l'audit. C'est la position
// tenue par `AiUsageService.record()`, conservée telle quelle — et c'est le
// raisonnement INVERSE de celui du journal d'audit, qui lui doit faire échouer
// l'export (`recordStrict`). La différence est délibérée : un compteur n'est pas
// une preuve.
//
// La conséquence est assumée et bornée : une panne d'écriture offre quelques
// exports, elle n'ouvre pas le quota. La lecture, elle, ne rattrape rien (voir
// `countRenderedForOrganizationSince`).

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type { PdfExportOutcome } from './pdf-export-quota.js';
import { PdfExportEvent, type PdfExportEventDocument } from './pdf-export-usage.schema.js';

@Injectable()
export class PdfExportUsageService {
  private readonly logger = new Logger(PdfExportUsageService.name);

  constructor(
    @InjectModel(PdfExportEvent.name) private readonly events: Model<PdfExportEventDocument>,
  ) {}

  async record(input: {
    organizationId: string;
    userId: string;
    projectId: string;
    outcome: PdfExportOutcome;
  }): Promise<void> {
    try {
      await this.events.create({ ...input, _schemaVersion: 1 });
    } catch (err) {
      this.logger.warn(
        `comptage d'export PDF impossible (org ${input.organizationId}) : ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Compte les exports PDF RÉELLEMENT PRODUITS par une organisation depuis `since`.
   *
   * Base du quota mensuel (`pdf-export-quota.service.ts`). Trois choix à ne pas
   * défaire :
   *
   * - `outcome: 'rendered'` est dans le FILTRE, pas seulement dans le résultat.
   *   Compter les rendus abandonnés ferait payer à l'utilisateur une panne de
   *   NOTRE infrastructure : le jour où Chromium sature, un quota gratuit se
   *   viderait en trois délais dépassés sans qu'aucun fichier ne soit sorti.
   * - le compte est par ORGANISATION, pas par projet ni par utilisateur : un
   *   quota par projet se contournerait en créant un projet, et un quota par
   *   utilisateur en invitant un membre.
   * - `countDocuments` et non une agrégation : c'est un simple décompte servi
   *   par l'index `{organizationId, outcome, createdAt}`, et il est appelé avant
   *   chaque export.
   *
   * Contrairement à `record()`, cette lecture NE RATTRAPE PAS ses erreurs : un
   * comptage qui échoue doit remonter. Répondre « 0 consommé » sur une panne de
   * base transformerait l'incident en exports illimités pour tout le monde.
   */
  async countRenderedForOrganizationSince(organizationId: string, since: Date): Promise<number> {
    return this.events.countDocuments({
      organizationId,
      outcome: 'rendered',
      createdAt: { $gte: since },
    });
  }

  /** Compte les rendus d'une fenêtre, ventilés par issue. Exploitation seulement. */
  async countSince(since: Date): Promise<{ rendered: number; failed: number; total: number }> {
    const rows = await this.events.aggregate<{ _id: string; n: number }>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$outcome', n: { $sum: 1 } } },
    ]);
    const byOutcome = new Map(rows.map((r) => [r._id, r.n]));
    const rendered = byOutcome.get('rendered') ?? 0;
    const failed = byOutcome.get('failed') ?? 0;
    return { rendered, failed, total: rendered + failed };
  }
}
