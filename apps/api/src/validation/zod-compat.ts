// Compatibilité zod 3 → zod 4 des problèmes de validation renvoyés au client.
//
// Les corps de requête refusés répondent `400 INVALID_REQUEST` avec des `issues`
// (chemin, code, message) que le web et les tests e2e lisent. Zod 4 a changé deux
// choses que ces réponses exposaient :
//
// 1. Un problème `invalid_type` ne dit plus ce qu'il a reçu (`received` a
//    disparu), et un `z.enum` absent lève désormais `invalid_value` au lieu de
//    `invalid_type`. Or le module ventes distingue le champ ABSENT
//    (`FIELD_REQUIRED`) du champ de mauvais type (`INVALID_TYPE`). `received`
//    est donc reposé ici,
//    au moment où zod calcule le message, seul endroit où la valeur reçue est
//    encore visible : par la carte d'erreurs globale pour les messages par
//    défaut, par `typeMessages()` et `fixedMessage()` pour les schémas qui
//    portent leur propre message.
// 2. Plusieurs codes ont été renommés (`invalid_string` → `invalid_format`,
//    `invalid_enum_value` et `invalid_literal` → `invalid_value`). Les réponses
//    qui exposent le code zod brut le reçoivent sous son nom zod 3 par
//    `zod3Code()`, contrat inchangé pour le web.
//
// Les messages PAR DÉFAUT de zod (en anglais) changent de libellé avec zod 4 ; le
// web ne les affiche jamais tels quels (il les remplace d'après leur code).
//
// Autre écart de zod 4, traité dans les schémas eux-mêmes : une clé `z.unknown()`
// ABSENTE est refusée (« expected nonoptional »), alors que zod 3 l'acceptait.
// Les champs normalisés à la main (factures, devis, CRM) s'écrivent donc
// `z.unknown().optional()`, pour que leur absence reste signalée par la règle
// métier et son code (`FIELD_REQUIRED`…), pas par zod.

import { z } from 'zod';

type RawIssue = z.core.$ZodRawIssue;

/** Type zod 3 d'une valeur reçue — seul `'undefined'` est lu (champ absent). */
function receivedOf(input: unknown): string {
  if (input === undefined) return 'undefined';
  if (input === null) return 'null';
  if (Array.isArray(input)) return 'array';
  return typeof input;
}

/**
 * Repose `received` sur un problème `invalid_type` (comme zod 3) ou
 * `invalid_value` (un `z.enum` absent, `invalid_type` en zod 3).
 */
export function markReceived(iss: RawIssue): void {
  if (iss.code === 'invalid_type' || iss.code === 'invalid_value') {
    (iss as { received?: string }).received = receivedOf(iss.input);
  }
}

// Carte globale : ne fixe aucun message (`undefined` laisse la place aux
// messages par défaut de zod), elle ne fait que reposer `received`. Elle n'est
// consultée que pour les problèmes sans message propre ; les autres passent par
// `typeMessages()` ou `fixedMessage()`.
z.config({
  customError: (iss) => {
    markReceived(iss);
    return undefined;
  },
});

/**
 * Messages d'un type, à la manière de `required_error` / `invalid_type_error`
 * (zod 3) : seuls les problèmes `invalid_type` sont concernés, le reste garde
 * le message par défaut ou celui de la vérification.
 */
export function typeMessages(messages: {
  required?: string;
  invalid?: string;
}): (iss: RawIssue) => string | undefined {
  return (iss) => {
    markReceived(iss);
    if (iss.code !== 'invalid_type') return undefined;
    return iss.input === undefined ? messages.required : messages.invalid;
  };
}

/** Un message unique pour tout problème du schéma (ancien `errorMap: () => ({ message })`). */
export function fixedMessage(message: string): (iss: RawIssue) => string {
  return (iss) => {
    markReceived(iss);
    return message;
  };
}

/** Le champ manquait-il (zod 3 : `invalid_type` reçu `undefined`) ? */
export function isMissing(issue: z.core.$ZodIssue): boolean {
  return (
    (issue.code === 'invalid_type' || issue.code === 'invalid_value') &&
    (issue as { received?: unknown }).received === 'undefined'
  );
}

/** Code zod 3 d'un problème zod 4, pour les réponses qui exposent le code brut. */
export function zod3Code(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_format':
      return 'invalid_string';
    case 'invalid_value':
      if (isMissing(issue)) return 'invalid_type';
      return issue.values.length === 1 ? 'invalid_literal' : 'invalid_enum_value';
    default:
      return issue.code;
  }
}
