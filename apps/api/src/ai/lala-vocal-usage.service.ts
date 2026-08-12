// Comptage des minutes d'agent vocal.
//
// ── Une inversion assumée par rapport à `AiUsageService` ─────────────────────
//
// `AiUsageService.record()` NE FAIT PAS ÉCHOUER l'appel qu'il compte : « perdre
// une ligne de statistique est sans commune mesure avec refuser une réponse à un
// utilisateur ». Ici, c'est l'inverse, et l'inversion est le point du fichier :
//
//   · `ouvrirSession()` LÈVE si l'écriture échoue. Cette écriture N'EST PAS une
//     statistique, c'est le DÉBIT. Ouvrir la session sans avoir pu débiter
//     donnerait de la voix gratuite et illimitée à qui provoque une panne de
//     base — et la voix, elle, est facturée à la minute par le fournisseur.
//   · `cloturerSession()` ne lève pas : elle ne fait que CORRIGER un débit déjà
//     inscrit, et toujours à la baisse. La perdre coûte à l'utilisateur quelques
//     minutes de trop, pas un incident.
//
// Le sens du risque est donc constant : en cas de panne, on ne donne jamais de
// minutes gratuites, et on n'en réclame jamais qu'on ne pourrait justifier.

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { minutesADebiter } from './lala-vocal-quota.js';
import { LalaVocalSession, type LalaVocalSessionDocument } from './lala-vocal-usage.schema.js';

@Injectable()
export class LalaVocalUsageService {
  private readonly logger = new Logger(LalaVocalUsageService.name);

  constructor(
    @InjectModel(LalaVocalSession.name)
    private readonly sessions: Model<LalaVocalSessionDocument>,
  ) {}

  /**
   * Inscrit le débit d'une session qui s'ouvre, au plafond.
   *
   * @returns l'identifiant de session, que le client rendra à la clôture.
   * @throws si l'écriture échoue — voir l'encadré en tête de fichier.
   */
  async ouvrirSession(input: {
    organizationId: string;
    userId: string;
    conversationId: string | null;
    dureeMaxMinutes: number;
  }): Promise<string> {
    const doc = await this.sessions.create({
      organizationId: input.organizationId,
      userId: input.userId,
      conversationId: input.conversationId,
      minutesDebitees: minutesADebiter(null, input.dureeMaxMinutes),
      cloturee: false,
      _schemaVersion: 1,
    });
    return String(doc._id);
  }

  /**
   * Corrige le débit d'une session terminée, à la baisse uniquement.
   *
   * `organizationId` entre dans le filtre : sans lui, l'identifiant d'une session
   * d'une autre organisation permettrait d'en effacer le débit. C'est la règle
   * d'isolement de `CLAUDE.md` appliquée au comptage — une organisation ne touche
   * jamais aux lignes d'une autre, fût-ce pour les corriger.
   *
   * `cloturee: false` dans le filtre rend l'opération idempotente : un second
   * appel (double-clic, reprise réseau) ne réécrit rien et ne peut pas faire
   * remonter un débit déjà corrigé.
   */
  async cloturerSession(input: {
    sessionId: string;
    organizationId: string;
    minutesRapportees: number | null;
    dureeMaxMinutes: number;
  }): Promise<void> {
    const minutes = minutesADebiter(input.minutesRapportees, input.dureeMaxMinutes);
    try {
      await this.sessions
        .updateOne(
          { _id: input.sessionId, organizationId: input.organizationId, cloturee: false },
          { $set: { minutesDebitees: minutes, cloturee: true } },
        )
        .exec();
    } catch (err) {
      // Le débit pessimiste reste en place : l'utilisateur paie trop, jamais
      // trop peu. Journalisé pour que le trop-perçu soit visible en exploitation.
      this.logger.warn(
        `clôture de session vocale impossible (${input.sessionId}) : ` +
          `${err instanceof Error ? err.message : String(err)} — le débit plafond est conservé.`,
      );
    }
  }

  /**
   * Minutes débitées à une organisation depuis `since`.
   *
   * Contrairement à `cloturerSession()`, cette lecture NE rattrape PAS ses
   * erreurs : répondre « 0 minute consommée » sur une panne de base
   * transformerait l'incident en voix illimitée pour tout le monde. C'est la
   * position de `countBilledForOrganizationSince`, conservée telle quelle.
   *
   * Une agrégation et non un `countDocuments` : ce sont des minutes qu'on somme,
   * pas des lignes qu'on compte. C'est toute la différence avec le quota texte.
   */
  async minutesDepuis(organizationId: string, since: Date): Promise<number> {
    const rows = await this.sessions.aggregate<{ _id: null; minutes: number }>([
      { $match: { organizationId, createdAt: { $gte: since } } },
      { $group: { _id: null, minutes: { $sum: '$minutesDebitees' } } },
    ]);
    const total = rows[0]?.minutes ?? 0;
    return Number.isFinite(total) && total > 0 ? total : 0;
  }
}
