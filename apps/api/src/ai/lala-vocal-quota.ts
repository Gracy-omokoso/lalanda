// ─────────────────────────────────────────────────────────────────────────────
// QUOTA DE L'AGENT VOCAL — un compteur DISTINCT, en minutes
//
// ── Pourquoi ce fichier existe au lieu de réutiliser `ai_messages` ───────────
//
// `billing/ai-quota.ts` compte des MESSAGES : un appel `gpt-4o-mini` se chiffre
// en millièmes de dollar. Une minute de conversation vocale ElevenLabs se
// facture à l'unité de dizaines de centimes — deux ordres de grandeur au-dessus.
//
// Compter une conversation vocale comme un message texte reviendrait à vendre,
// dans l'offre Pro, l'équivalent de plusieurs centaines de dollars de voix pour
// dix-neuf. Ce n'est pas une approximation acceptable : c'est une erreur de
// facturation. D'où un compteur séparé, une unité séparée (la MINUTE, qui est
// l'unité de facturation du fournisseur) et un refus séparé.
//
// Le compteur de messages n'est PAS touché : une conversation vocale ne
// décompte aucun message texte, et un message texte ne décompte aucune minute.
//
// ── VALEURS NON ARBITRÉES ────────────────────────────────────────────────────
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ Les minutes par offre ci-dessous sont une PROPOSITION remontée au         ║
// ║ décideur, pas une décision. Elles ne figurent VOLONTAIREMENT pas dans     ║
// ║ `@lalanda/shared/pricing` : ce catalogue alimente la page tarifs          ║
// ║ publique, et y écrire un chiffre non arbitré reviendrait à le publier.    ║
// ║                                                                          ║
// ║ Tant que l'arbitrage n'est pas rendu, chaque valeur reste surchargeable   ║
// ║ par variable d'environnement (`LALA_VOCAL_MINUTES_PRO`…), ce qui permet   ║
// ║ d'ajuster en production sans redéploiement ni migration de grille.        ║
// ║ Le jour de l'arbitrage, la grille rejoint le catalogue partagé et ce      ║
// ║ fichier n'en garde que la RÈGLE.                                          ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ── Le raisonnement derrière la proposition ─────────────────────────────────
//
// Ordre de grandeur public du fournisseur : ~0,08 à 0,10 USD la minute d'agent
// conversationnel sur les paliers payants. La proposition tient la voix sous
// ~15 % du prix de l'offre, poste le plus cher du produit :
//
//   free     0 min   — la voix n'est PAS incluse. Une offre gratuite qui ouvre
//                      un robinet facturé à la minute est une invitation à
//                      l'abus, et l'abus se fait avec des comptes jetables.
//   pro      30 min  ≈ 2,4–3,0 USD sur 19 USD  (~15 %)
//   cabinet  90 min  ≈ 7,2–9,0 USD sur 39 USD  (~20 %) — un cabinet fait
//                      découvrir les notions à plusieurs clients.
//   business 240 min                            — à caler sur le prix réel.
//   expert   négocié au contrat, comme les sièges.
//
// Ces valeurs sont à confirmer, pas à croire.
// ─────────────────────────────────────────────────────────────────────────────

import { PLANS, monthWindowReset, monthWindowStart, type Plan } from '@lalanda/shared/pricing';

/** Identifiant du quota, tel qu'il apparaît dans les refus. */
export const VOICE_MINUTES_QUOTA = 'voice_minutes' as const;

/** Code d'erreur HTTP du dépassement, aligné sur `PLAN_LIMIT_AI_MESSAGES`. */
export const VOICE_QUOTA_ERROR_CODE = 'PLAN_LIMIT_VOICE_MINUTES' as const;

/**
 * Durée maximale d'UNE conversation, en minutes.
 *
 * Deux rôles, et le second est le plus important :
 *
 *  1. borner une session oubliée — un onglet laissé ouvert micro branché
 *     consommerait sans fin;
 *  2. servir de DÉBIT PESSIMISTE à l'ouverture. Voir `minutesADebiter` : une
 *     session dont la fin n'est jamais rapportée est comptée pour son maximum.
 *     Sans cela, ne pas rapporter la fin serait la stratégie gagnante.
 */
export const DUREE_MAX_SESSION_MINUTES = 10;

/**
 * Grille PROPOSÉE, en minutes par mois calendaire. `null` = illimité.
 *
 * `satisfies Record<Plan, …>` : ajouter une offre à `PLANS` sans décider de ses
 * minutes ne compile pas. Un quota vocal oublié sur une nouvelle offre se
 * traduirait sinon par « illimité » — le défaut le plus cher possible.
 */
export const MINUTES_VOCALES_PROPOSEES = {
  free: 0,
  pro: 30,
  cabinet: 90,
  business: 240,
  // Comme les sièges de l'offre Expert (`seats: null`), la voix est négociée au
  // contrat. `null` n'est pas ici un cadeau : c'est un renvoi au contrat signé.
  expert: null,
} as const satisfies Record<Plan, number | null>;

/** Préfixe des surcharges d'environnement — `LALA_VOCAL_MINUTES_PRO=45`. */
export const PREFIXE_ENV_MINUTES = 'LALA_VOCAL_MINUTES_';

/**
 * Minutes autorisées pour une offre, surcharge d'environnement comprise.
 *
 * Une valeur invalide est IGNORÉE au profit de la proposition, jamais appliquée
 * en silence — même politique que les bornes techniques d'`ai-limits.ts` (S22h).
 * `illimite` est accepté explicitement : sans mot-clé, un opérateur écrirait
 * `999999`, et un « presque illimité » se lit comme une limite dans l'interface.
 *
 * @param env source des variables, injectable pour les tests.
 * @returns les minutes autorisées, et l'avertissement à journaliser s'il y a lieu.
 */
export function minutesAutorisees(
  plan: Plan,
  env: Record<string, string | undefined> = process.env,
): { minutes: number | null; avertissement: string | null } {
  const defaut: number | null = MINUTES_VOCALES_PROPOSEES[plan];
  const nom = `${PREFIXE_ENV_MINUTES}${plan.toUpperCase()}`;
  const brut = env[nom];
  if (brut === undefined || brut.trim() === '') return { minutes: defaut, avertissement: null };

  const propre = brut.trim().toLowerCase();
  if (propre === 'illimite' || propre === 'illimité') return { minutes: null, avertissement: null };

  const n = Number(propre);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return {
      minutes: defaut,
      avertissement:
        `${nom}="${brut}" ignorée : un entier de minutes ≥ 0, ou « illimite », est attendu. ` +
        `Valeur appliquée : ${defaut === null ? 'illimité' : `${defaut} min`}.`,
    };
  }
  return { minutes: n, avertissement: null };
}

export interface EtatQuotaVocal {
  plan: Plan;
  /** Minutes autorisées par mois. `null` = illimité (offre négociée). */
  limiteMinutes: number | null;
  /** Minutes DÉJÀ débitées dans la fenêtre courante. */
  minutesConsommees: number;
  /** Minutes restantes. `null` = illimité — jamais un grand nombre. */
  minutesRestantes: number | null;
  illimite: boolean;
  /** Le quota est-il épuisé ? Toujours `false` sur une offre illimitée. */
  depasse: boolean;
  /**
   * Durée maximale de la PROCHAINE session, en minutes.
   *
   * Bornée par ce qui reste : ouvrir une session de 10 minutes à un utilisateur
   * qui n'a plus que 3 minutes lui promettrait une conversation qu'on couperait.
   * `0` quand le quota est épuisé — la session n'est alors pas ouverte du tout.
   */
  dureeMaxSessionMinutes: number;
  /** Début de la fenêtre courante (1er du mois, 00:00 UTC). */
  debutFenetre: Date;
  /** Réinitialisation (1er du mois suivant, 00:00 UTC). */
  reinitialisationLe: Date;
  /** Jours entiers avant la réinitialisation, arrondis vers le HAUT (jamais 0). */
  reinitialisationDansJours: number;
}

/**
 * État du quota vocal à un instant donné.
 *
 * `minutesConsommees` est fourni par l'appelant : ce module ne sait pas compter,
 * il sait décider. C'est ce qui le rend vérifiable sans base ni réseau — même
 * séparation que `billing/ai-quota.ts`, et pour la même raison : un quota
 * commercial se relit et se discute.
 */
export function etatQuotaVocal(
  plan: Plan,
  limiteMinutes: number | null,
  minutesConsommees: number,
  now: Date,
): EtatQuotaVocal {
  const illimite = limiteMinutes === null;
  const debutFenetre = monthWindowStart(now);
  const reinitialisationLe = monthWindowReset(now);

  // Un compteur négatif n'a pas de sens et masquerait un défaut de comptage.
  const consommees =
    Number.isFinite(minutesConsommees) && minutesConsommees > 0 ? minutesConsommees : 0;
  const restantes = illimite ? null : Math.max(limiteMinutes - consommees, 0);
  const depasse = illimite ? false : restantes !== null && restantes <= 0;

  return {
    plan,
    limiteMinutes,
    minutesConsommees: consommees,
    minutesRestantes: restantes,
    illimite,
    depasse,
    dureeMaxSessionMinutes: illimite
      ? DUREE_MAX_SESSION_MINUTES
      : Math.max(Math.min(DUREE_MAX_SESSION_MINUTES, Math.floor(restantes ?? 0)), 0),
    debutFenetre,
    reinitialisationLe,
    reinitialisationDansJours: joursAvantReinitialisation(now, reinitialisationLe),
  };
}

/**
 * Minutes à débiter pour une session, selon ce qui a été rapporté.
 *
 * `null` = la fin n'a pas été rapportée. Le débit est alors le MAXIMUM, pas
 * zéro : une session dont on ne sait rien a pu durer autant que le plafond, et
 * la compter à zéro ferait de « ne rien rapporter » la stratégie la moins chère
 * pour l'utilisateur. La correction à la baisse, elle, exige un appel explicite
 * de clôture — c'est le sens de la marche.
 *
 * Le résultat est borné à `[0, dureeMax]` et arrondi au DIXIÈME de minute
 * supérieur : facturer six secondes entamées comme six secondes pleines est
 * l'usage du fournisseur, et arrondir à la minute pleine rendrait le compteur
 * grossier au point d'être faux sur des questions de vingt secondes.
 */
export function minutesADebiter(
  minutesRapportees: number | null,
  dureeMax: number = DUREE_MAX_SESSION_MINUTES,
): number {
  const plafond = Math.max(dureeMax, 0);
  if (minutesRapportees === null || !Number.isFinite(minutesRapportees)) return plafond;
  const borne = Math.min(Math.max(minutesRapportees, 0), plafond);
  return Math.ceil(borne * 10) / 10;
}

function joursAvantReinitialisation(now: Date, reinitialisationLe: Date): number {
  const ms = reinitialisationLe.getTime() - now.getTime();
  return Math.max(Math.ceil(ms / (24 * 60 * 60 * 1000)), 1);
}

/** Corps du refus. Sérialisable tel quel dans une réponse HTTP. */
export interface VoiceQuotaExceededPayload {
  code: typeof VOICE_QUOTA_ERROR_CODE;
  /** LAQUELLE des limites est atteinte — `ai_messages` reste intacte. */
  quota: typeof VOICE_MINUTES_QUOTA;
  plan: Plan;
  limitMinutes: number;
  usedMinutes: number;
  resetAt: string;
  resetInDays: number;
  message: string;
  upgradeUrl: string;
}

/**
 * Construit le corps du refus.
 *
 * Le message dit explicitement que le chat écrit, lui, reste ouvert : sans cette
 * phrase, un utilisateur au bout de ses minutes croit avoir perdu l'assistante
 * entière alors qu'il n'a perdu que la voix.
 */
export function voiceQuotaExceededPayload(etat: EtatQuotaVocal): VoiceQuotaExceededPayload {
  if (etat.limiteMinutes === null) {
    throw new Error('voiceQuotaExceededPayload appelé sur une offre sans limite de minutes.');
  }
  const jours =
    etat.reinitialisationDansJours === 1 ? 'demain' : `dans ${etat.reinitialisationDansJours} jours`;

  const message =
    etat.limiteMinutes === 0
      ? `L’appel vocal n’est pas inclus dans l’offre ${etat.plan}. ` +
        `Le chat écrit avec Lala reste disponible, avec ses interprétations vérifiées.`
      : `Vous avez utilisé les ${etat.limiteMinutes} minutes d’appel vocal incluses ce mois-ci ` +
        `dans l’offre ${etat.plan}. Le compteur repart le 1er du mois prochain (${jours}). ` +
        `Le chat écrit avec Lala reste disponible.`;

  return {
    code: VOICE_QUOTA_ERROR_CODE,
    quota: VOICE_MINUTES_QUOTA,
    plan: etat.plan,
    limitMinutes: etat.limiteMinutes,
    usedMinutes: etat.minutesConsommees,
    resetAt: etat.reinitialisationLe.toISOString(),
    resetInDays: etat.reinitialisationDansJours,
    message,
    upgradeUrl: '/pricing',
  };
}

/** Toutes les offres du catalogue, pour les journaux de démarrage et les tests. */
export const OFFRES_CONNUES: readonly Plan[] = PLANS;
