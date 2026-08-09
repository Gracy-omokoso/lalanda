// ─────────────────────────────────────────────────────────────────────────────
// CODES DE SECOURS — le facteur de dernier recours
//
// Sans eux, un téléphone perdu ferme l'accès plateforme DÉFINITIVEMENT : le
// secret TOTP est chiffré en base, personne ne peut le rendre à son propriétaire,
// et l'exigence de MFA barre `/admin` — y compris à la route qui permettrait de
// désactiver le MFA. Le seul recours restant serait une intervention manuelle en
// base de production, c'est-à-dire exactement la manœuvre que la sécurité de ce
// module est censée rendre inutile.
//
// ── Pourquoi des empreintes et non un chiffrement ─────────────────────────────
//
// Le secret TOTP est CHIFFRÉ (AES-256-GCM, ADR-0013) parce que le serveur doit
// le relire en clair à chaque vérification — c'est une clé partagée. Un code de
// secours, lui, n'a jamais besoin d'être relu : on ne compare que ce que
// l'utilisateur saisit. Le stocker en clair, ou même réversible, ferait d'un
// accès en lecture à la base un contournement complet du second facteur. On
// stocke donc des EMPREINTES, comme pour un mot de passe.
//
// ── Pourquoi scrypt, et pourquoi UN SEUL sel par jeu de codes ────────────────
//
// Les codes sont produits par le serveur avec 50 bits d'entropie : un SHA-256 nu
// serait déjà hors de portée d'une attaque par dictionnaire. scrypt est pris
// quand même — le coût est payé une fois par vérification, et l'hypothèse « 50
// bits, c'est assez » est exactement le genre d'hypothèse qui vieillit mal.
//
// Le sel est unique pour LE JEU, pas pour chaque code. Ce n'est pas une économie
// de place : avec un sel par code, vérifier une saisie exigerait dix dérivations
// scrypt (une par sel), soit ~500 ms de calcul offert à quiconque frappe la
// route — un amplificateur de déni de service. Avec un sel commun, on dérive UNE
// fois puis on compare aux dix empreintes. La propriété que les sels par
// enregistrement protègent (deux utilisateurs ayant le même mot de passe ont des
// empreintes différentes) est ici sans objet : les codes sont aléatoires, jamais
// choisis, et jamais partagés entre deux jeux.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

/** Nombre de codes remis à l'enrôlement. */
export const BACKUP_CODE_COUNT = 10;

/** Longueur d'un code, en caractères de l'alphabet ci-dessous. */
export const BACKUP_CODE_LENGTH = 10;

/**
 * Alphabet de 32 caractères SANS `I`, `L`, `O`, `U`, `0`, `1`.
 *
 * `I`/`1`/`L` et `O`/`0` sont indiscernables dans la plupart des polices, et un
 * code de secours est typiquement recopié à la main depuis un papier rangé dans
 * un tiroir depuis deux ans. `U` est retiré pour la raison de Crockford : il
 * évite qu'un tirage aléatoire compose un mot vulgaire. 32 caractères = 5 bits
 * exactement, donc 10 caractères = 50 bits d'entropie.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

const SCRYPT_KEYLEN = 32;
const SALT_BYTES = 16;

/** Un code en clair, tel qu'il est montré UNE SEULE FOIS à l'utilisateur. */
export function generateBackupCode(): string {
  let code = '';
  for (let i = 0; i < BACKUP_CODE_LENGTH; i += 1) {
    // `randomInt` et non `Math.random()` : le générateur par défaut de
    // JavaScript n'est pas cryptographique, et sa graine est parfois devinable.
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/**
 * Normalise une saisie : casse indifférente, espaces et tirets retirés.
 *
 * L'interface affiche les codes groupés (`ABCDE-FGHJK`) pour qu'ils soient
 * recopiables ; refuser le tiret que l'on a soi-même affiché serait absurde.
 */
export function normalizeBackupCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export interface BackupCodeSet {
  /** Codes en clair — à remettre à l'utilisateur puis à OUBLIER. */
  plain: string[];
  /** Sel commun au jeu, en base64. */
  salt: string;
  /** Empreintes, dans l'ordre des codes en clair. */
  hashes: string[];
}

/** Empreinte scrypt d'un code, sous un sel donné. */
export function hashBackupCode(code: string, saltBase64: string): string {
  const salt = Buffer.from(saltBase64, 'base64');
  return scryptSync(normalizeBackupCode(code), salt, SCRYPT_KEYLEN).toString('base64');
}

/** Produit un jeu complet : codes en clair, sel, empreintes. */
export function generateBackupCodeSet(count = BACKUP_CODE_COUNT): BackupCodeSet {
  const salt = randomBytes(SALT_BYTES).toString('base64');
  const plain = Array.from({ length: count }, () => generateBackupCode());
  return { plain, salt, hashes: plain.map((code) => hashBackupCode(code, salt)) };
}

/**
 * Index du code correspondant dans `hashes`, ou `-1`.
 *
 * UNE seule dérivation scrypt, puis comparaison à temps constant contre chaque
 * empreinte. La boucle ne sort pas au premier succès — ici, contrairement au
 * TOTP, la position du code dans le jeu serait une information réelle (elle
 * dirait combien de codes ont déjà été consommés), et la parcourir entièrement
 * ne coûte que dix `timingSafeEqual` sur 32 octets.
 */
export function findBackupCodeIndex(
  code: string,
  saltBase64: string,
  hashes: readonly string[],
): number {
  const normalized = normalizeBackupCode(code);
  // Filtre de forme avant scrypt : une saisie vide ou d'une autre longueur ne
  // peut pas être un code, et dériver pour rien offrirait à un attaquant un
  // moyen de faire travailler le serveur à volonté.
  if (normalized.length !== BACKUP_CODE_LENGTH) return -1;

  const candidate = Buffer.from(hashBackupCode(normalized, saltBase64), 'base64');
  let found = -1;
  for (let i = 0; i < hashes.length; i += 1) {
    const stored = Buffer.from(hashes[i]!, 'base64');
    if (stored.length === candidate.length && timingSafeEqual(stored, candidate) && found === -1) {
      found = i;
    }
  }
  return found;
}

/** Découpe pour l'affichage : `ABCDE-FGHJK`. Cosmétique, jamais persisté. */
export function formatBackupCode(code: string): string {
  const mid = Math.ceil(code.length / 2);
  return `${code.slice(0, mid)}-${code.slice(mid)}`;
}
