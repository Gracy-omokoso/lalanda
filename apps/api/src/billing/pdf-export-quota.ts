// ─────────────────────────────────────────────────────────────────────────────
// QUOTA D'EXPORTS PDF — la règle, sans base ni réseau
//
// docs/13 : « L'interface peut expliquer une limite, mais l'API l'impose. » Ce
// module porte la RÈGLE ; `pdf-export-quota.service.ts` la branche sur la base
// et sur HTTP. La séparation n'est pas décorative : un quota commercial se relit
// et se discute, et il doit pouvoir être vérifié sans monter un serveur.
//
// C'est le JUMEAU de `ai-quota.ts`, délibérément : même forme d'état, même forme
// de refus, même fenêtre, même façon de dire quand ça repart. Un second
// mécanisme de quota, inventé à côté du premier, divergerait à la première
// correction — et l'utilisateur qui rencontre les deux limites verrait deux
// produits.
//
// ── Pourquoi ce quota existe ─────────────────────────────────────────────────
//
// La grille publique vend 3 / 30 / 100 / illimités exports PDF par mois
// (docs/13 § La grille) et rien ne les comptait. Ce n'est pas qu'une fuite
// commerciale : l'export PDF passe par Puppeteer, donc par un Chromium par
// rendu (~140 Mo) sur un Droplet qui en a 3 800 au total. `render-gate.ts` borne
// déjà la CONCURRENCE (2 rendus simultanés, file de 8, abandon à 20 s) ; rien ne
// bornait le VOLUME par organisation. Ce sont deux garde-fous différents, et
// aucun ne remplace l'autre : le portillon protège la machine à l'instant t, ce
// quota protège la marge sur le mois.
//
// ── Quatre décisions, et pourquoi ────────────────────────────────────────────
//
// 1. SEUL LE PDF EST PLAFONNÉ. L'Excel est du calcul pur (ExcelJS, aucun
//    navigateur) : son coût marginal est négligeable, et la grille l'annonce
//    « oui » dans les CINQ offres, Free comprise. Le plafonner vendrait une
//    limite que la page publique ne mentionne nulle part. Aucun `format` ne
//    traverse donc ce module : il ne parle que d'exports PDF.
//
// 2. ON COMPTE LE RENDU RÉUSSI, PAS LA TENTATIVE. Un rendu abandonné (délai
//    dépassé, portillon saturé, Chromium absent) n'a livré aucun fichier.
//    Décompter ces cas ferait payer à l'utilisateur une panne de NOTRE
//    infrastructure : il l'a subie, il ne l'a pas provoquée. C'est exactement la
//    position tenue côté IA, où seule la source `llm` est comptée et où un repli
//    déterministe ne consomme rien.
//
// 3. LA FENÊTRE EST LE MOIS CALENDAIRE, EN UTC — la même que le quota IA, via
//    `monthWindowStart` / `monthWindowReset` de `@lalanda/shared/pricing`.
//    Explicable en une phrase (« votre quota repart le 1er »), identique sur
//    toutes les instances, et sans état à stocker : la fenêtre se DÉDUIT de
//    l'horloge, il n'y a aucun compteur à remettre à zéro et donc aucune remise
//    à zéro à rater.
//
// 4. LE QUOTA BORNE LES RENDUS À VENIR, JAMAIS LE PATRIMOINE DÉJÀ LÀ. La règle
//    posée pour les projets (docs/13 § Antériorité : une organisation de
//    production détient 5 projets sur une offre qui en autorise 1, et ses plans
//    « restent lisibles, modifiables et exportables ») vaut ici sans
//    adaptation : un quota d'exports épuisé ne rend AUCUN plan inaccessible. Le
//    projet reste ouvrable, ses chiffres restent lisibles à l'écran, et l'Excel
//    reste disponible. Seule la production d'un PDF de plus attend le 1er du
//    mois. Le message du refus le dit explicitement, faute de quoi il se lirait
//    comme une suspension de compte.
// ─────────────────────────────────────────────────────────────────────────────

import { monthWindowReset, monthWindowStart, type Plan } from '@lalanda/shared/pricing';

import type { Entitlements } from './entitlements.js';

/**
 * Identifiant du quota, tel qu'il apparaît dans les refus.
 *
 * Distinct de `ai_messages` : un client doit pouvoir distinguer les deux refus
 * sans lire le message français — c'est ce qui rend le refus exploitable par une
 * interface.
 */
export const PDF_EXPORTS_QUOTA = 'pdf_exports' as const;

/** Code d'erreur HTTP du dépassement, aligné sur `PLAN_LIMIT_AI_MESSAGES`. */
export const PDF_EXPORT_QUOTA_ERROR_CODE = 'PLAN_LIMIT_PDF_EXPORTS' as const;

/**
 * Issue d'un rendu PDF.
 *
 * `rendered` = un fichier a été produit et remis. `failed` = rien n'est sorti
 * (délai dépassé, portillon saturé, Chromium indisponible, journal d'audit en
 * échec). Le pendant exact de `'llm' | 'fallback'` côté IA.
 */
export type PdfExportOutcome = 'rendered' | 'failed';

export interface PdfExportQuotaStatus {
  plan: Plan;
  /** Exports PDF autorisés par mois. `null` = illimité. */
  limit: number | null;
  /** Exports DÉJÀ produits dans la fenêtre courante (rendus réussis seulement). */
  used: number;
  /** Exports restants. `null` = illimité — jamais un grand nombre. */
  remaining: number | null;
  unlimited: boolean;
  /** Le quota est-il épuisé ? Toujours `false` sur une offre illimitée. */
  exceeded: boolean;
  /** Début de la fenêtre courante (1er du mois, 00:00 UTC). */
  windowStart: Date;
  /** Réinitialisation (1er du mois suivant, 00:00 UTC). */
  resetAt: Date;
  /** Jours entiers avant la réinitialisation, arrondis vers le HAUT (jamais 0). */
  resetInDays: number;
}

/**
 * État du quota à un instant donné.
 *
 * `used` est fourni par l'appelant : ce module ne sait pas compter, il sait
 * décider. C'est ce qui le rend testable sans base.
 */
export function pdfExportQuotaStatus(
  plan: Plan,
  entitlements: Entitlements,
  used: number,
  now: Date,
): PdfExportQuotaStatus {
  const limit = entitlements.pdfExportsPerMonth;
  const unlimited = limit === null;
  const windowStart = monthWindowStart(now);
  const resetAt = monthWindowReset(now);

  // Un compteur négatif n'a pas de sens et masquerait un défaut de comptage.
  const safeUsed = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;

  return {
    plan,
    limit,
    used: safeUsed,
    // Borné à 0 : un « -1 restant » s'afficherait tel quel dans une interface.
    remaining: unlimited ? null : Math.max(limit - safeUsed, 0),
    unlimited,
    exceeded: unlimited ? false : safeUsed >= limit,
    windowStart,
    resetAt,
    resetInDays: daysUntilReset(now, resetAt),
  };
}

/**
 * Jours avant la réinitialisation, arrondis vers le HAUT.
 *
 * Arrondi haut et minimum 1 : le dernier jour du mois, il reste « moins d'un
 * jour », et annoncer « 0 jour » se lit « maintenant » alors que le quota n'est
 * pas encore reparti. Mieux vaut promettre un peu tard que trop tôt.
 */
function daysUntilReset(now: Date, resetAt: Date): number {
  const ms = resetAt.getTime() - now.getTime();
  return Math.max(Math.ceil(ms / (24 * 60 * 60 * 1000)), 1);
}

/** Corps du refus. Sérialisable tel quel dans une réponse HTTP. */
export interface PdfExportQuotaExceededPayload {
  code: typeof PDF_EXPORT_QUOTA_ERROR_CODE;
  /** LAQUELLE des limites est atteinte. */
  quota: typeof PDF_EXPORTS_QUOTA;
  plan: Plan;
  limit: number;
  used: number;
  /** QUAND elle repart, en ISO 8601 UTC. */
  resetAt: string;
  resetInDays: number;
  message: string;
  /** Où aller pour lever la limite. */
  upgradeUrl: string;
}

/**
 * Construit le corps du refus.
 *
 * Le message français est écrit ici, une seule fois : chaque appelant qui le
 * réécrirait produirait une formulation légèrement différente, et l'utilisateur
 * qui rencontre la limite deux fois par deux chemins verrait deux produits.
 *
 * Il dit quatre choses, et les quatre comptent : combien d'exports ont été
 * utilisés, combien l'offre en autorise, quand le compteur repart, et — surtout
 * — que RIEN n'est devenu inaccessible. Voir la décision 4 en tête de fichier.
 */
export function pdfExportQuotaExceededPayload(
  status: PdfExportQuotaStatus,
): PdfExportQuotaExceededPayload {
  // Appeler ceci sur une offre illimitée est une faute de programmation, pas un
  // cas métier : mieux vaut échouer bruyamment que produire « limite : null ».
  if (status.limit === null) {
    throw new Error('pdfExportQuotaExceededPayload appelé sur une offre sans limite d’exports.');
  }

  const jours = status.resetInDays === 1 ? 'demain' : `dans ${status.resetInDays} jours`;

  return {
    code: PDF_EXPORT_QUOTA_ERROR_CODE,
    quota: PDF_EXPORTS_QUOTA,
    plan: status.plan,
    limit: status.limit,
    used: status.used,
    resetAt: status.resetAt.toISOString(),
    resetInDays: status.resetInDays,
    message:
      `Vous avez utilisé les ${status.limit} exports PDF inclus ce mois-ci dans l'offre ` +
      `${status.plan}. Le compteur repart le 1er du mois prochain (${jours}). ` +
      `Vos plans restent consultables, modifiables et exportables en Excel — ` +
      `rien n'a été supprimé ni rendu inaccessible.`,
    upgradeUrl: '/pricing',
  };
}

/**
 * Cette issue de rendu consomme-t-elle du quota ?
 *
 * Une fonction d'une ligne, exportée exprès : c'est LA règle que l'agent qui
 * branche un nouveau format de rendu doit trouver écrite quelque part plutôt que
 * de la redécider dans son coin. Voir la décision 2 en tête de fichier — le
 * pendant exact de `consumesQuota('llm' | 'fallback')` côté IA.
 */
export function consumesPdfExportQuota(outcome: PdfExportOutcome): boolean {
  return outcome === 'rendered';
}
