// Bornes techniques des appels OpenAI (S22h).
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// `openai-client.ts` appelait l'API sans plafond de jetons ni délai maximal.
// Ce n'est pas un problème de coût — un appel `gpt-4o-mini` se compte en
// millièmes de dollar — mais un problème TECHNIQUE : une réponse anormalement
// longue (boucle de génération, modèle qui déraille) occupe une requête HTTP,
// de la mémoire et du temps sans qu'aucune limite ne l'arrête. Ces bornes
// existent pour que le pire cas soit connu et fini, pas pour facturer.
//
// PRINCIPE : un déploiement SANS configuration doit être borné, pas illimité.
// Les valeurs par défaut ci-dessous s'appliquent donc quand rien n'est défini,
// et toute valeur d'environnement invalide est REFUSÉE au profit du défaut,
// avec une trace — jamais un plafond fantaisiste appliqué en silence.

import { Logger } from '@nestjs/common';

/** Bornes appliquées à chaque appel du client OpenAI. */
export interface AiLimits {
  /**
   * Plafond de jetons EN SORTIE (`max_tokens`) pour un appel.
   *
   * Dimensionnement (seul usage actuel : `POST /ai/corrective-actions`) :
   * la réponse légitime la plus longue possible est un JSON de 4 actions
   * (`CorrectiveActionsResponseSchema` refuse au-delà), chacune portant une
   * `suggestion` et un `expected_impact` en français. Les textes du fallback
   * déterministe, qui servent de gabarit de longueur au modèle, pèsent ~330
   * caractères par action, soit ~1 400 caractères pour 4 actions, enveloppe
   * JSON comprise — de l'ordre de 470 jetons en français.
   *
   * Le défaut de 1 024 laisse donc un facteur ~2,2 de marge : une réponse
   * légitime, même verbeuse, ne peut pas être tronquée par la borne, et une
   * réponse qui part en boucle est arrêtée bien avant d'avoir un effet.
   */
  maxOutputTokens: number;

  /**
   * Délai maximal d'un appel, en millisecondes, mesuré en temps réel côté
   * appelant (les éventuels réessais internes du SDK sont donc inclus).
   *
   * Défaut 15 000 ms : un appel `gpt-4o-mini` produisant ~500 jetons répond en
   * quelques secondes. 15 s couvre largement une latence dégradée sans laisser
   * la requête HTTP de l'utilisateur pendre indéfiniment — au-delà, le repli
   * déterministe est une meilleure réponse qu'une attente.
   */
  requestTimeoutMs: number;
}

/** Valeurs appliquées quand l'environnement ne configure rien. */
export const DEFAULT_AI_LIMITS: Readonly<AiLimits> = Object.freeze({
  maxOutputTokens: 1_024,
  requestTimeoutMs: 15_000,
});

/**
 * Encadrement des valeurs configurables.
 *
 * Le plancher écarte une configuration qui tronquerait systématiquement des
 * réponses légitimes; le plafond empêche qu'une faute de frappe (`100000`)
 * réintroduise l'appel non borné que ce module existe pour supprimer.
 */
export const AI_LIMITS_BOUNDS = Object.freeze({
  /** 256 jetons ≈ 2 actions : en dessous, la troncature deviendrait la norme. */
  maxOutputTokens: Object.freeze({ min: 256, max: 4_096 }),
  /** 60 s est le plafond absolu au-delà duquel une requête HTTP n'a plus de sens. */
  requestTimeoutMs: Object.freeze({ min: 1_000, max: 60_000 }),
});

/** Noms des variables d'environnement lues. */
export const AI_LIMITS_ENV = Object.freeze({
  maxOutputTokens: 'OPENAI_MAX_OUTPUT_TOKENS',
  requestTimeoutMs: 'OPENAI_TIMEOUT_MS',
});

const defaultLogger = new Logger('AiLimits');

/** Journal minimal attendu — permet d'observer les avertissements en test. */
export interface AiLimitsLogger {
  warn(message: string): void;
}

/**
 * Lit un entier borné dans l'environnement.
 *
 * Toute valeur absente rend le défaut SANS bruit (c'est le cas nominal).
 * Toute valeur présente mais inutilisable (non numérique, non entière, hors
 * bornes) rend le défaut AVEC un avertissement : une configuration ignorée en
 * silence est exactement le genre d'échec qu'on découvre trop tard.
 */
function readBoundedInt(
  raw: string | undefined,
  envName: string,
  fallback: number,
  bounds: { min: number; max: number },
  logger: AiLimitsLogger,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;

  const value = Number(raw.trim());
  if (!Number.isInteger(value)) {
    logger.warn(
      `${envName}="${raw}" n'est pas un entier — valeur ignorée, défaut appliqué (${fallback}).`,
    );
    return fallback;
  }
  if (value < bounds.min || value > bounds.max) {
    logger.warn(
      `${envName}=${value} hors bornes [${bounds.min}, ${bounds.max}] — ` +
        `valeur ignorée, défaut appliqué (${fallback}).`,
    );
    return fallback;
  }
  return value;
}

/**
 * Résout les bornes effectives depuis l'environnement.
 *
 * Volontairement local au module IA plutôt qu'ajouté au schéma Zod partagé
 * (`packages/shared/src/env`) : ces deux variables ne concernent que les appels
 * OpenAI, et le module doit rester borné même appelé hors du cycle de démarrage
 * de l'API (tests, scripts). Un défaut sûr ne peut pas dépendre d'un `parseEnv`
 * qui n'aurait pas tourné.
 */
export function resolveAiLimits(
  env: NodeJS.ProcessEnv = process.env,
  logger: AiLimitsLogger = defaultLogger,
): AiLimits {
  return {
    maxOutputTokens: readBoundedInt(
      env[AI_LIMITS_ENV.maxOutputTokens],
      AI_LIMITS_ENV.maxOutputTokens,
      DEFAULT_AI_LIMITS.maxOutputTokens,
      AI_LIMITS_BOUNDS.maxOutputTokens,
      logger,
    ),
    requestTimeoutMs: readBoundedInt(
      env[AI_LIMITS_ENV.requestTimeoutMs],
      AI_LIMITS_ENV.requestTimeoutMs,
      DEFAULT_AI_LIMITS.requestTimeoutMs,
      AI_LIMITS_BOUNDS.requestTimeoutMs,
      logger,
    ),
  };
}
