// ─────────────────────────────────────────────────────────────────────────────
// GARDE DE QUOTA IA — le point d'entrée unique de tout usage de l'IA
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ À LIRE SI VOUS BRANCHEZ UN NOUVEL USAGE DE L'IA (assistant, chat,        ║
// ║ interprétations…)                                                        ║
// ║                                                                          ║
// ║ N'écrivez AUCUNE limite de votre côté. Appelez `runGuarded()` :          ║
// ║                                                                          ║
// ║   const reponse = await this.aiQuota.runGuarded(                          ║
// ║     { organizationId, userId, action: 'ai.lala_chat' },                   ║
// ║     async () => {                                                         ║
// ║       const r = await this.lala.repondre(question);                       ║
// ║       return { value: r, source: r.source };  // 'llm' | 'fallback'       ║
// ║     },                                                                    ║
// ║   );                                                                      ║
// ║                                                                          ║
// ║ Vous obtenez, sans rien de plus à écrire :                                ║
// ║  · le refus 403 si le quota du mois est épuisé, AVANT tout appel payant;  ║
// ║  · le comptage après coup, à partir de la source RÉELLE de la réponse;    ║
// ║  · l'assurance qu'un repli déterministe ne consomme rien.                 ║
// ║                                                                          ║
// ║ `action` est une étiquette libre (`ai.lala_chat`, `ai.interpretation`…) :  ║
// ║ elle sert au tableau de bord d'exploitation et n'a aucun effet sur le      ║
// ║ quota, qui est commun à tous les usages d'une organisation. Un quota par  ║
// ║ usage se contournerait en changeant d'écran.                              ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ── Pourquoi une garde côté API et pas côté interface ────────────────────────
//
// docs/13 : « L'interface peut expliquer une limite, mais l'API l'impose. » Un
// compteur affiché dans le navigateur est une information, pas une limite : la
// route reste appelable directement. Comme l'appel coûte de l'argent réel chez
// OpenAI (ADR-0008), un quota contournable n'est pas un quota — c'est une
// suggestion adressée aux utilisateurs honnêtes.
//
// ── L'ordre des opérations, et pourquoi il est dans CE fichier ───────────────
//
// Garder AVANT, compter APRÈS. Les deux moitiés doivent tenir ensemble :
//
//   · compter avant l'appel décompterait les replis déterministes, donc
//     facturerait les pannes de configuration;
//   · garder après l'appel laisserait passer l'appel payant qu'on refuse.
//
// Exposer deux méthodes séparées invite à n'en appeler qu'une. `runGuarded()`
// les tient ensemble, et c'est pour cela qu'il est le chemin recommandé plutôt
// qu'une commodité.
// ─────────────────────────────────────────────────────────────────────────────

import { monthWindowStart } from '@lalanda/shared/pricing';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';

import { AiUsageService } from '../admin/ai-usage.service.js';
import { aiQuotaExceededPayload, aiQuotaStatus, type AiQuotaStatus } from '../billing/ai-quota.js';
import { BillingService } from '../billing/billing.service.js';

/** Origine d'une réponse IA. `fallback` = aucun modèle appelé, donc rien à compter. */
export type AiResponseSource = 'llm' | 'fallback';

/** Qui consomme, pour quelle organisation, sur quel usage. */
export interface AiQuotaContext {
  organizationId: string;
  userId: string;
  /** Étiquette d'usage — `ai.corrective_actions`, `ai.lala_chat`… */
  action: string;
}

/** Ce que l'appelable rend : sa valeur, et la source qui l'a produite. */
export interface AiSourcedResult<T> {
  value: T;
  source: AiResponseSource;
}

@Injectable()
export class AiQuotaService {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(AiUsageService) private readonly usage: AiUsageService,
  ) {}

  /**
   * État du quota, SANS effet de bord.
   *
   * Sert à afficher « il vous reste N messages, le compteur repart le 1er ».
   * L'interface peut l'appeler librement : lire un quota n'en consomme pas.
   */
  async status(organizationId: string, now: Date = new Date()): Promise<AiQuotaStatus> {
    const { plan, entitlements } = await this.billing.getPlanEntitlements(organizationId);

    // Une offre illimitée n'a pas besoin d'être comptée : la lecture serait un
    // décompte inutile sur le chemin chaud, et son résultat serait ignoré.
    if (entitlements.aiMessagesPerMonth === null) {
      return aiQuotaStatus(plan, entitlements, 0, now);
    }

    // La fenêtre vient du catalogue partagé : le compteur et l'affichage
    // s'accordent forcément sur le même 1er du mois.
    const used = await this.usage.countBilledForOrganizationSince(
      organizationId,
      monthWindowStart(now),
    );
    return aiQuotaStatus(plan, entitlements, used, now);
  }

  /**
   * Refuse si le quota du mois est épuisé. À appeler AVANT tout appel au modèle.
   *
   * Lève une `ForbiddenException` dont le corps nomme le quota atteint, la
   * limite, la consommation et l'instant de réinitialisation : un « 403 » nu
   * laisserait l'utilisateur devant un écran cassé sans savoir s'il doit
   * attendre une heure ou trois semaines.
   *
   * 403 et non 429 : ce n'est pas une limitation de débit qu'une seconde
   * d'attente lèverait, c'est un droit que le plan n'accorde pas. `429` ferait
   * réessayer les clients qui savent réessayer, sur une limite mensuelle.
   */
  async assertWithinQuota(organizationId: string, now: Date = new Date()): Promise<AiQuotaStatus> {
    const status = await this.status(organizationId, now);
    if (status.exceeded) {
      throw new ForbiddenException(aiQuotaExceededPayload(status));
    }
    return status;
  }

  /**
   * Enregistre une consommation. À appeler APRÈS la réponse, avec sa source.
   *
   * `fallback` n'écrit RIEN dans le quota — mais la trace d'exploitation est
   * conservée : le tableau de bord `/admin` doit voir qu'un repli a eu lieu,
   * sinon une clé expirée passe inaperçue tant que personne ne se plaint.
   *
   * Ne lève jamais : perdre une ligne de comptage est sans commune mesure avec
   * refuser à l'utilisateur une réponse déjà produite et déjà payée. C'est la
   * position d'`AiUsageService.record()`, conservée telle quelle.
   *
   * Aucune trace n'est ajoutée ici pour le cas du repli : `AiActionsService` le
   * journalise déjà avec une raison nommée (`FALLBACK_LOG_PREFIX`), et la ligne
   * écrite porte `source: 'fallback'`, ce qui est la trace exploitable. Un
   * troisième message par appel n'apprendrait rien et noierait les deux autres.
   */
  async record(context: AiQuotaContext, source: AiResponseSource): Promise<void> {
    await this.usage.record({
      organizationId: context.organizationId,
      userId: context.userId,
      action: context.action,
      source,
    });
  }

  /**
   * CHEMIN RECOMMANDÉ — garde, exécute, compte, dans cet ordre.
   *
   * Voir l'encadré en tête de fichier. `run` doit rendre sa valeur ET la source
   * qui l'a produite ; c'est cette source, et non une supposition de l'appelant,
   * qui décide si un message est décompté.
   *
   * Si `run` lève, RIEN n'est décompté : une requête qui échoue avant d'avoir
   * produit une réponse n'a rien consommé du point de vue de l'utilisateur, quoi
   * qu'elle ait coûté en interne. Ce choix est en faveur du client, délibérément
   * — l'inverse ferait payer nos incidents.
   */
  async runGuarded<T>(
    context: AiQuotaContext,
    run: (status: AiQuotaStatus) => Promise<AiSourcedResult<T>>,
  ): Promise<T> {
    const status = await this.assertWithinQuota(context.organizationId);
    const result = await run(status);
    await this.record(context, result.source);
    return result.value;
  }
}
