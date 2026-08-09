// ─────────────────────────────────────────────────────────────────────────────
// TOTP — RFC 6238 (mots de passe à usage unique fondés sur le temps), qui repose
// lui-même sur HOTP — RFC 4226.
//
// Aucune dépendance : `node:crypto` uniquement, comme le schéma de chiffrement
// des secrets (ADR-0013 § Conséquences). Une bibliothèque TOTP tierce serait
// ~40 lignes de code utile enveloppées dans un arbre de dépendances qu'il
// faudrait surveiller (`scripts/audit-dependencies.mjs`), pour un algorithme dont
// la RFC publie les VECTEURS DE TEST — c'est-à-dire pour un algorithme qu'on peut
// prouver correct plutôt que croire correct. `totp.test.ts` rejoue ces vecteurs.
//
// ── Choix d'algorithme : HMAC-SHA1, 6 chiffres, pas de 30 s ───────────────────
//
// Ce n'est PAS une négligence cryptographique, c'est de l'interopérabilité.
// Google Authenticator, Aegis, 1Password, Microsoft Authenticator et FreeOTP
// lisent tous SHA-1/6/30 ; plusieurs IGNORENT SILENCIEUSEMENT les paramètres
// `algorithm=SHA256` et `digits=8` de l'URI `otpauth://` et calculent quand même
// en SHA-1/6. Le résultat n'est pas « plus sûr » : c'est un enrôlement qui
// affiche un QR code, accepte la saisie, et refuse tous les codes ensuite.
//
// La solidité de HMAC-SHA1 ici ne dépend pas de la résistance aux collisions de
// SHA-1 (cassée), mais de HMAC comme fonction pseudo-aléatoire (non cassée) —
// c'est la position de RFC 6238 § 1.2 et celle du NIST SP 800-107 pour HMAC-SHA1.
//
// ── Ce que ce fichier ne fait PAS ─────────────────────────────────────────────
//
// Il ne persiste rien, ne connaît ni base ni utilisateur, et n'a aucun état.
// Toute la protection contre le REJEU vit dans `mfa.service.ts` (compteur du
// dernier pas accepté) : une fonction pure ne peut pas, par construction, savoir
// qu'un code a déjà servi. Confondre les deux est l'erreur classique — un TOTP
// vérifié « correctement » reste valide 30 à 90 secondes pour quiconque l'a lu
// par-dessus l'épaule ou intercepté.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Pas de temps, en secondes (RFC 6238 § 4 recommande 30). */
export const TOTP_STEP_SECONDS = 30;

/** Nombre de chiffres du code. */
export const TOTP_DIGITS = 6;

/**
 * Tolérance de dérive d'horloge, en pas, de part et d'autre du pas courant.
 *
 * 1 pas : la fenêtre d'acceptation couvre [t-30 s, t+30 s], soit 90 secondes au
 * total. RFC 6238 § 5.2 : « nous RECOMMANDONS qu'au plus un pas de temps soit
 * utilisé comme délai de validation ». Deux pas doubleraient la fenêtre
 * d'interception d'un code lu par-dessus l'épaule, pour ne rattraper qu'une
 * horloge dérivée de plus d'une minute — auquel cas c'est l'horloge du téléphone
 * qu'il faut corriger, pas le serveur qu'il faut affaiblir.
 */
export const TOTP_WINDOW_STEPS = 1;

/** Taille du secret partagé. 20 octets = 160 bits, le minimum de RFC 4226 § 4 R6. */
export const TOTP_SECRET_BYTES = 20;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encodage base32 RFC 4648, SANS remplissage `=`.
 *
 * Le remplissage est omis volontairement : plusieurs applications
 * d'authentification refusent un paramètre `secret=` contenant des `=`, qui
 * doivent de surcroît être percent-encodés dans une URI. Un secret rejeté au
 * scan du QR code est indiscernable, pour l'utilisateur, d'un produit cassé.
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

/**
 * Décodage base32 RFC 4648, tolérant : casse indifférente, espaces et `=`
 * ignorés.
 *
 * La tolérance est ici une fonctionnalité et non un laxisme : la saisie manuelle
 * du secret (le repli quand la caméra ne lit pas le QR code) est faite à la main,
 * en minuscules, avec les espaces que l'interface a insérés pour la lisibilité.
 * Un caractère hors alphabet, en revanche, LÈVE — c'est une faute de frappe, et
 * l'ignorer produirait un secret différent, donc un enrôlement qui échoue plus
 * tard sans que personne ne sache pourquoi.
 */
export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Caractère base32 invalide : « ${char} ».`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secret partagé neuf, en base32 — la forme que lisent les applications. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

/** Pas de temps courant (RFC 6238 § 4.2 : `T = (unixTime - T0) / X`, `T0 = 0`). */
export function currentStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/**
 * HOTP (RFC 4226 § 5.3) : HMAC-SHA1 du compteur, troncature dynamique, modulo.
 *
 * Le compteur est écrit sur 8 octets BIG-ENDIAN. `writeBigUInt64BE` plutôt qu'un
 * calcul sur `number` : au-delà de 2^53 les entiers JavaScript perdent des
 * unités, et bien que 2^53 pas de 30 s dépassent l'âge de l'univers, la fonction
 * est aussi appelée avec des compteurs arbitraires par les vecteurs de la RFC.
 */
export function hotp(secret: Buffer, counter: number | bigint, digits = TOTP_DIGITS): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', secret).update(counterBuffer).digest();

  // Troncature dynamique : les 4 bits de poids faible du dernier octet donnent
  // le décalage de lecture. Le masque 0x7f sur l'octet de tête retire le bit de
  // signe — sans lui, la valeur serait négative une fois sur deux.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Code attendu pour un secret base32 à un pas donné. */
export function totpAt(secretBase32: string, step: number, digits = TOTP_DIGITS): string {
  return hotp(base32Decode(secretBase32), step, digits);
}

/**
 * Normalise une saisie utilisateur : espaces et tirets retirés.
 *
 * Les applications d'authentification affichent « 123 456 » ; un copier-coller
 * embarque l'espace. Refuser cette saisie serait refuser un code JUSTE.
 */
export function normalizeCode(input: string): string {
  return input.replace(/[\s-]/g, '');
}

export interface TotpVerification {
  /** Le code est-il valide dans la fenêtre ? */
  valid: boolean;
  /**
   * Pas de temps auquel le code a été reconnu — `null` si invalide.
   *
   * C'est CETTE valeur que l'appelant doit persister pour interdire le rejeu.
   * Elle est renvoyée plutôt que gardée ici parce que la protection contre le
   * rejeu est un état par utilisateur, et qu'une fonction pure n'en a pas.
   */
  step: number | null;
}

/**
 * Vérifie un code dans la fenêtre `[step - window, step + window]`.
 *
 * ── Comparaison à temps constant ──────────────────────────────────────────────
 *
 * `timingSafeEqual` et non `===`. L'objection habituelle — « un code à 6 chiffres
 * se devine en 10^6 essais, la fuite temporelle est le cadet des soucis » — passe
 * à côté du fait que la comparaison naïve d'un moteur JavaScript sort au premier
 * caractère différent : la latence trahit la longueur du préfixe commun, ce qui
 * ramène l'attaque de 10^6 essais à quelques dizaines sur un canal mesurable. Le
 * coût de la parade est nul, on la prend.
 *
 * ── Pourquoi la boucle s'arrête au premier succès ─────────────────────────────
 *
 * Ce n'est pas une fuite exploitable : le NOMBRE de pas essayés avant succès
 * révèle au plus la dérive d'horloge de la victime, jamais le secret. Uniformiser
 * cela obligerait à calculer les trois HMAC à chaque appel sans obtenir aucune
 * propriété de sécurité supplémentaire.
 */
export function verifyTotp(
  secretBase32: string,
  submitted: string,
  options: { nowMs?: number; window?: number; digits?: number } = {},
): TotpVerification {
  const digits = options.digits ?? TOTP_DIGITS;
  const window = options.window ?? TOTP_WINDOW_STEPS;
  const code = normalizeCode(submitted);

  // Filtre de forme AVANT tout calcul HMAC : une saisie de 4 caractères ou
  // contenant des lettres ne peut pas être un code, et la refuser ici évite de
  // dériver un secret pour rien.
  if (!new RegExp(`^\\d{${digits}}$`).test(code)) {
    return { valid: false, step: null };
  }

  const secret = base32Decode(secretBase32);
  const now = currentStep(options.nowMs ?? Date.now());
  const submittedBuffer = Buffer.from(code, 'utf8');

  for (let delta = -window; delta <= window; delta += 1) {
    const step = now + delta;
    const expected = Buffer.from(hotp(secret, step, digits), 'utf8');
    if (expected.length === submittedBuffer.length && timingSafeEqual(expected, submittedBuffer)) {
      return { valid: true, step };
    }
  }
  return { valid: false, step: null };
}

/**
 * URI `otpauth://` — le contenu du QR code (format « Key Uri Format » de Google,
 * de fait universel).
 *
 * `issuer` apparaît DEUX FOIS : dans le préfixe de l'étiquette (`Lalanda:alice@…`)
 * et en paramètre. C'est redondant et c'est voulu — les applications anciennes ne
 * lisent que le préfixe, les récentes ne lisent que le paramètre, et une entrée
 * sans émetteur s'affiche comme un compte anonyme dans une liste où l'utilisateur
 * en a douze.
 *
 * L'étiquette est percent-encodée : une adresse email contient un `@`, et un nom
 * d'émetteur pourrait contenir un `:` qui casserait l'analyse de l'étiquette.
 */
export function buildOtpAuthUri(input: {
  secretBase32: string;
  accountName: string;
  issuer: string;
}): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.accountName)}`;
  const params = new URLSearchParams({
    secret: input.secretBase32,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
