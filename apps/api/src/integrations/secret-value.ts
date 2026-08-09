// Type de transport en mémoire d'une valeur déchiffrée — ADR-0013 §2.
//
// « Un `console.log` accidentel, une sérialisation d'erreur ou un envoi vers un
// agrégateur de logs n'exposent rien. » Ce fichier est ce qui rend cette phrase
// vraie, et il ne peut le faire qu'en interceptant les TROIS chemins par lesquels
// une valeur JavaScript devient du texte :
//
//   1. `String(x)` / interpolation `${x}`      → `toString()`
//   2. `JSON.stringify(x)`                      → `toJSON()`
//   3. `console.log(x)` / `util.inspect(x)`     → `util.inspect.custom`
//
// Le troisième est celui qu'on oublie : `console.log(secret)` n'appelle NI
// `toString` NI `toJSON`, il appelle `util.inspect`, qui énumère les champs privés
// TypeScript (privés à la compilation seulement) et afficherait la valeur en clair.

import { inspect } from 'node:util';

/** Marqueur affiché à la place de toute valeur secrète. */
export const REDACTED = '[redacted]';

/**
 * Enveloppe une valeur secrète déchiffrée.
 *
 * L'accès à la valeur réelle passe par `expose()` — un nom volontairement laid :
 * il doit être visible en revue de code, et une recherche `expose()` doit donner
 * la liste exhaustive des endroits où un secret redevient une chaîne nue.
 *
 * La valeur est rangée dans une `WeakMap` externe et non dans un champ
 * d'instance : un champ, même `#privé`, reste atteignable par
 * `Object.getOwnPropertyNames` et par certains sérialiseurs de trace de pile.
 * Une `WeakMap` n'est énumérable par rien.
 */
const VALUES = new WeakMap<Secret, string>();

export class Secret {
  constructor(value: string) {
    VALUES.set(this, value);
  }

  /** Valeur en clair. Le seul chemin légitime — voir le commentaire de classe. */
  expose(): string {
    const v = VALUES.get(this);
    if (v === undefined) {
      throw new Error('Secret vidé — instance réutilisée après destruction.');
    }
    return v;
  }

  /** Longueur de la valeur, sans la révéler (diagnostic de saisie). */
  get length(): number {
    return this.expose().length;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}

/**
 * Quatre DERNIERS caractères, ou `null` sous 12 caractères — ADR-0013 §4.
 *
 * Jamais un préfixe : « les clés Stripe commencent par `sk_live_` / `rk_test_`,
 * un préfixe révélerait le mode et le type ». Et jamais sous 12 caractères :
 * « révéler 4 caractères d'un secret de 10 en divulgue 40 % ».
 */
export const LAST4_MIN_LENGTH = 12;

export function last4Of(value: string): string | null {
  if (value.length < LAST4_MIN_LENGTH) return null;
  return value.slice(-4);
}
