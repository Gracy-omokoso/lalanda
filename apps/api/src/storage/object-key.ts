// Nommage des objets stockés.
//
// ── L'exigence ───────────────────────────────────────────────────────────────
//
// Une clé du genre `avatars/<userId>.png` rend la photo de n'importe qui
// récupérable en construisant l'URL — il suffit de connaître un identifiant
// d'utilisateur, qui n'a jamais été un secret. Le hachage de l'identifiant ne
// répare rien : il est déterministe, donc l'attaquant qui connaît l'identifiant
// reconstruit le haché.
//
// ── La règle ─────────────────────────────────────────────────────────────────
//
// La clé est TIRÉE AU HASARD, sans aucune dérivation d'une donnée connue de
// l'utilisateur. Le lien clé ↔ propriétaire n'existe que dans la base, dans le
// sens propriétaire → clé. Deux conséquences utiles :
//
//   1. l'énumération est impossible même pour qui connaîtrait tous les
//      identifiants d'utilisateurs du produit ;
//   2. remplacer une photo TIRE UNE NOUVELLE CLÉ. L'ancienne URL cesse
//      immédiatement de désigner quoi que ce soit — la révocation est un effet
//      du nommage, pas un nettoyage à ne pas oublier d'écrire.

import { randomBytes } from 'node:crypto';

/** 128 bits. À 1 000 000 d'objets, la probabilité de collision reste < 2⁻⁸⁶. */
const ID_BYTES = 16;

/** Identifiant d'objet : 32 caractères hexadécimaux, sans structure. */
export function newObjectId(): string {
  return randomBytes(ID_BYTES).toString('hex');
}

/** Vrai pour la forme produite par `newObjectId`, et pour elle seule. */
export function isObjectId(value: string): boolean {
  return new RegExp(`^[0-9a-f]{${ID_BYTES * 2}}$`).test(value);
}

/**
 * Clé complète dans le bucket. Le préfixe est un rangement, pas un secret :
 * il ne contient aucune donnée utilisateur.
 */
export function avatarObjectKey(objectId: string): string {
  return `avatars/${objectId}`;
}
