// ─────────────────────────────────────────────────────────────────────────────
// QUOTA DE MESSAGES IA — la règle, sans base ni réseau
//
// docs/13 : « L'interface peut expliquer une limite, mais l'API l'impose. » Ce
// module porte la RÈGLE ; `apps/api/src/ai/ai-quota.service.ts` la branche sur
// la base et sur HTTP. La séparation n'est pas décorative : un quota commercial
// se relit et se discute, et il doit pouvoir être vérifié sans monter un serveur.
//
// ── Trois décisions, et pourquoi ─────────────────────────────────────────────
//
// 1. UN REPLI DÉTERMINISTE NE CONSOMME RIEN. `ai-actions.service.ts` distingue
//    déjà `source: 'llm'` de `source: 'fallback'`. Un repli n'appelle aucun
//    modèle : il survient quand aucune clé n'est configurée, quand le réseau
//    tombe, ou quand la réponse du modèle est refusée par le schéma. Décompter
//    ces cas ferait payer à l'utilisateur une panne de NOTRE configuration, et
//    viderait le quota d'un compte gratuit en vingt requêtes le jour où une clé
//    expire. Seule la source `llm` est comptée.
//
// 2. LA FENÊTRE EST LE MOIS CALENDAIRE, EN UTC. Explicable en une phrase
//    (« votre quota repart le 1er »), identique sur toutes les instances, et
//    sans état à stocker : la fenêtre se DÉDUIT de l'horloge, il n'y a aucun
//    compteur à remettre à zéro et donc aucune remise à zéro à rater. Voir
//    `monthWindowStart` / `monthWindowReset` dans `@lalanda/shared/pricing`.
//
// 3. UN REFUS DIT LAQUELLE ET QUAND. Un « 403 » nu laisse l'utilisateur devant
//    un écran cassé sans savoir s'il doit attendre une heure ou trois semaines.
//    Le refus nomme le quota, la limite, la consommation, l'instant de
//    réinitialisation et le nombre de jours qui restent.
// ─────────────────────────────────────────────────────────────────────────────

import { monthWindowReset, monthWindowStart, type Plan } from '@lalanda/shared/pricing';

import type { Entitlements } from './entitlements.js';

/**
 * Identifiant du quota, tel qu'il apparaît dans les refus.
 *
 * Une chaîne et non un booléen : le jour où les exports PDF sont plafonnés eux
 * aussi, un client doit pouvoir distinguer les deux refus sans lire le message
 * français — c'est ce qui rend le refus exploitable par une interface.
 */
export const AI_MESSAGES_QUOTA = 'ai_messages' as const;

/** Code d'erreur HTTP du dépassement, aligné sur `PLAN_LIMIT_PROJECTS`. */
export const AI_QUOTA_ERROR_CODE = 'PLAN_LIMIT_AI_MESSAGES' as const;

export interface AiQuotaStatus {
  plan: Plan;
  /** Messages autorisés par mois. `null` = illimité. */
  limit: number | null;
  /** Messages DÉJÀ consommés dans la fenêtre courante (source `llm` seulement). */
  used: number;
  /** Messages restants. `null` = illimité — jamais un grand nombre. */
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
export function aiQuotaStatus(
  plan: Plan,
  entitlements: Entitlements,
  used: number,
  now: Date,
): AiQuotaStatus {
  const limit = entitlements.aiMessagesPerMonth;
  const unlimited = limit === null;
  const windowStart = monthWindowStart(now);
  const resetAt = monthWindowReset(now);

  // Un compteur négatif n'a pas de sens et masquerait un défaut de comptage.
  const safeUsed = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;

  return {
    plan,
    limit,
    used: safeUsed,
    // Borné à 0 : un « -3 restants » s'afficherait tel quel dans une interface.
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
export interface AiQuotaExceededPayload {
  code: typeof AI_QUOTA_ERROR_CODE;
  /** LAQUELLE des limites est atteinte. */
  quota: typeof AI_MESSAGES_QUOTA;
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
 */
export function aiQuotaExceededPayload(status: AiQuotaStatus): AiQuotaExceededPayload {
  // Appeler ceci sur une offre illimitée est une faute de programmation, pas un
  // cas métier : mieux vaut échouer bruyamment que produire « limite : null ».
  if (status.limit === null) {
    throw new Error('aiQuotaExceededPayload appelé sur une offre sans limite de messages IA.');
  }

  const jours = status.resetInDays === 1 ? 'demain' : `dans ${status.resetInDays} jours`;

  return {
    code: AI_QUOTA_ERROR_CODE,
    quota: AI_MESSAGES_QUOTA,
    plan: status.plan,
    limit: status.limit,
    used: status.used,
    resetAt: status.resetAt.toISOString(),
    resetInDays: status.resetInDays,
    message:
      `Vous avez utilisé les ${status.limit} messages IA inclus ce mois-ci dans l'offre ` +
      `${status.plan}. Le compteur repart le 1er du mois prochain (${jours}). ` +
      `Vos projets et vos exports restent accessibles.`,
    upgradeUrl: '/pricing',
  };
}

/**
 * Cette source de réponse consomme-t-elle du quota ?
 *
 * Une fonction d'une ligne, exportée exprès : c'est LA règle que l'agent qui
 * branche un nouvel usage de l'IA doit trouver écrite quelque part plutôt que
 * de la redécider dans son coin. Voir la décision 1 en tête de fichier.
 */
export function consumesQuota(source: 'llm' | 'fallback'): boolean {
  return source === 'llm';
}
