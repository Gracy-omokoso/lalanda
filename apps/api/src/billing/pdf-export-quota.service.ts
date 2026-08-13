// ─────────────────────────────────────────────────────────────────────────────
// GARDE DE QUOTA D'EXPORTS PDF — le point d'entrée unique de tout rendu Chromium
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ À LIRE SI VOUS BRANCHEZ UN NOUVEAU RENDU PDF                             ║
// ║                                                                          ║
// ║ N'écrivez AUCUNE limite de votre côté. Appelez `runGuarded()` :          ║
// ║                                                                          ║
// ║   const pdf = await this.pdfQuota.runGuarded(                             ║
// ║     { organizationId, userId, projectId },                                ║
// ║     async () => this.reports.renderPdf(data),                             ║
// ║   );                                                                      ║
// ║                                                                          ║
// ║ Vous obtenez, sans rien de plus à écrire :                                ║
// ║  · le refus 403 si le quota du mois est épuisé, AVANT tout rendu;         ║
// ║  · le comptage après coup, à partir de l'issue RÉELLE du rendu;           ║
// ║  · l'assurance qu'un rendu abandonné ne consomme rien.                    ║
// ║                                                                          ║
// ║ Le quota est commun à toute une organisation : par projet, il se          ║
// ║ contournerait en créant un projet ; par utilisateur, en invitant un       ║
// ║ membre.                                                                   ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ── Pourquoi une garde côté API et pas côté interface ────────────────────────
//
// docs/13 : « L'interface peut expliquer une limite, mais l'API l'impose. » Un
// compteur affiché dans le navigateur est une information, pas une limite : la
// route reste appelable directement. Comme chaque rendu démarre un Chromium
// (~140 Mo sur un Droplet qui en a 3 800), un quota contournable n'est pas un
// quota — c'est une suggestion adressée aux utilisateurs honnêtes.
//
// ── Ce que ce quota NE fait pas, et c'est capital ────────────────────────────
//
// Il ne ferme l'accès à AUCUN plan déjà produit. La règle posée pour les projets
// (docs/13 § Antériorité) vaut ici sans adaptation : la limite s'applique aux
// gestes futurs, jamais au patrimoine déjà là. Une organisation à quota épuisé
// garde ses projets ouvrables, ses chiffres lisibles et son export Excel — que
// ce service ne voit même pas passer, puisque seul `GET .../report/pdf` l'appelle.
//
// ── L'ordre des opérations, et pourquoi il est dans CE fichier ───────────────
//
// Garder AVANT, compter APRÈS. Les deux moitiés doivent tenir ensemble :
//
//   · compter avant le rendu décompterait les rendus abandonnés, donc
//     facturerait les saturations de Chromium;
//   · garder après le rendu laisserait passer le coût qu'on refuse.
//
// Exposer deux méthodes séparées invite à n'en appeler qu'une. `runGuarded()`
// les tient ensemble, et c'est pour cela qu'il est le chemin recommandé plutôt
// qu'une commodité.
// ─────────────────────────────────────────────────────────────────────────────

import { monthWindowStart } from '@lalanda/shared/pricing';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';

import { BillingService } from './billing.service.js';
import {
  pdfExportQuotaExceededPayload,
  pdfExportQuotaStatus,
  type PdfExportOutcome,
  type PdfExportQuotaStatus,
} from './pdf-export-quota.js';
import { PdfExportUsageService } from './pdf-export-usage.service.js';

/** Qui exporte, pour quelle organisation, sur quel projet. */
export interface PdfExportQuotaContext {
  organizationId: string;
  userId: string;
  projectId: string;
}

@Injectable()
export class PdfExportQuotaService {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(PdfExportUsageService) private readonly usage: PdfExportUsageService,
  ) {}

  /**
   * État du quota, SANS effet de bord.
   *
   * Sert à afficher « il vous reste N exports, le compteur repart le 1er ».
   * L'interface peut l'appeler librement : lire un quota n'en consomme pas.
   */
  async status(organizationId: string, now: Date = new Date()): Promise<PdfExportQuotaStatus> {
    const { plan, entitlements } = await this.billing.getPlanEntitlements(organizationId);

    // Une offre illimitée n'a pas besoin d'être comptée : la lecture serait un
    // décompte inutile sur le chemin d'un export, et son résultat serait ignoré.
    if (entitlements.pdfExportsPerMonth === null) {
      return pdfExportQuotaStatus(plan, entitlements, 0, now);
    }

    // La fenêtre vient du catalogue partagé : le compteur, l'affichage et le
    // quota IA s'accordent forcément sur le même 1er du mois.
    const used = await this.usage.countRenderedForOrganizationSince(
      organizationId,
      monthWindowStart(now),
    );
    return pdfExportQuotaStatus(plan, entitlements, used, now);
  }

  /**
   * Refuse si le quota du mois est épuisé. À appeler AVANT tout rendu.
   *
   * Lève une `ForbiddenException` dont le corps nomme le quota atteint, la
   * limite, la consommation et l'instant de réinitialisation : un « 403 » nu
   * laisserait l'utilisateur devant un écran cassé sans savoir s'il doit
   * attendre une heure ou trois semaines.
   *
   * 403 et non 429 : ce n'est pas une limitation de débit qu'une seconde
   * d'attente lèverait, c'est un droit que l'offre n'accorde pas. `429` ferait
   * réessayer les clients qui savent réessayer, sur une limite mensuelle.
   */
  async assertWithinQuota(
    organizationId: string,
    now: Date = new Date(),
  ): Promise<PdfExportQuotaStatus> {
    const status = await this.status(organizationId, now);
    if (status.exceeded) {
      throw new ForbiddenException(pdfExportQuotaExceededPayload(status));
    }
    return status;
  }

  /**
   * Enregistre un rendu. À appeler APRÈS, avec son issue réelle.
   *
   * `failed` n'entre PAS dans le décompte — mais la trace d'exploitation est
   * conservée : sans elle, une vague de délais dépassés sur le Droplet resterait
   * invisible jusqu'à ce qu'un client se plaigne.
   *
   * Ne lève jamais : perdre une ligne de comptage est sans commune mesure avec
   * refuser à l'utilisateur un fichier déjà rendu. C'est la position de
   * `PdfExportUsageService.record()`, conservée telle quelle.
   */
  async record(context: PdfExportQuotaContext, outcome: PdfExportOutcome): Promise<void> {
    await this.usage.record({ ...context, outcome });
  }

  /**
   * CHEMIN RECOMMANDÉ — garde, rend, compte, dans cet ordre.
   *
   * Voir l'encadré en tête de fichier.
   *
   * Si `run` lève, l'échec remonte tel quel et la ligne écrite porte
   * `outcome: 'failed'`, donc RIEN n'est décompté : un export qui n'a produit
   * aucun fichier n'a rien consommé du point de vue de l'utilisateur, quoi qu'il
   * ait coûté en interne. Ce choix est en sa faveur, délibérément — l'inverse
   * lui ferait payer nos incidents.
   *
   * `now` est injectable pour que la règle soit testable sans horloge réelle ;
   * en production, personne ne le passe.
   */
  async runGuarded<T>(
    context: PdfExportQuotaContext,
    run: (status: PdfExportQuotaStatus) => Promise<T>,
    now: Date = new Date(),
  ): Promise<T> {
    const status = await this.assertWithinQuota(context.organizationId, now);

    let outcome: PdfExportOutcome = 'failed';
    try {
      const value = await run(status);
      outcome = 'rendered';
      return value;
    } finally {
      // Dans un `finally` pour que le chemin d'échec soit tracé sans être
      // décompté. `record` ne lève pas, il ne peut donc pas masquer l'erreur
      // d'origine.
      await this.record(context, outcome);
    }
  }
}
