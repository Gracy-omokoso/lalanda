// ─────────────────────────────────────────────────────────────────────────────
// VÉRIFICATION DE SIGNATURE DES RAPPELS (S22b)
//
// Un webhook non signé, c'est un formulaire public qui accorde des abonnements.
// N'importe qui connaissant l'URL enverrait un
// `{"type":"invoice.paid","metadata":{"organizationId":"…"}}` et s'offrirait
// Business à vie. C'est le point le plus sensible de tout ce lot — d'où un
// fichier séparé, pur, testé isolément.
//
// Trois règles appliquées ici, dans cet ordre d'importance :
//
// 1. COMPARAISON EN TEMPS CONSTANT. `a === b` sur des chaînes s'arrête au
//    premier octet différent : le temps de réponse fuit la position de l'erreur,
//    et une signature se reconstruit octet par octet. `timingSafeEqual` ne
//    s'arrête jamais tôt.
// 2. TOLÉRANCE D'HORODATAGE. Une signature valide reste valide pour toujours
//    sans elle : un rappel capté (journal proxy, historique de navigateur d'un
//    outil de debug) serait rejouable des mois plus tard. La fenêtre est de
//    5 minutes, comme le défaut Stripe.
// 3. AUCUN REPLI. Pas de « si le secret n'est pas configuré, on accepte » —
//    c'est le raccourci qui transforme un oubli de configuration en porte
//    ouverte. Sans secret, le fournisseur est indisponible et la route répond
//    503 avant même de lire le corps.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Fenêtre d'acceptation d'un horodatage de rappel, en secondes. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** HMAC-SHA256 hexadécimal. */
export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Égalité en temps constant de deux chaînes hexadécimales.
 *
 * Les longueurs différentes renvoient `false` immédiatement — c'est sans risque :
 * la longueur d'un HMAC est publique et fixe, elle ne fuit rien.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let bufA: Buffer;
  let bufB: Buffer;
  try {
    bufA = Buffer.from(a, 'hex');
    bufB = Buffer.from(b, 'hex');
  } catch {
    return false;
  }
  // `Buffer.from('zz', 'hex')` ne lève pas : il renvoie un buffer tronqué. Une
  // chaîne non hexadécimale produit donc des longueurs d'octets différentes.
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface StripeSignatureHeader {
  timestamp: number;
  /** Toutes les signatures `v1` présentes — Stripe en émet plusieurs pendant une rotation de secret. */
  v1: string[];
}

/**
 * Décompose l'en-tête `Stripe-Signature` : `t=1699999999,v1=abc…,v1=def…`.
 * Renvoie `null` si l'en-tête est absent, malformé, ou sans signature `v1`.
 */
export function parseStripeSignatureHeader(
  header: string | undefined,
): StripeSignatureHeader | null {
  if (!header) return null;
  let timestamp: number | null = null;
  const v1: string[] = [];

  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) timestamp = parsed;
    } else if (key === 'v1') {
      v1.push(value);
    }
    // Les schémas inconnus (`v0`, réservé aux tests de Stripe) sont ignorés :
    // les accepter reviendrait à accepter un schéma dont on ne maîtrise pas la
    // construction.
  }

  if (timestamp === null || v1.length === 0) return null;
  return { timestamp, v1 };
}

export type SignatureCheck =
  { valid: true } | { valid: false; reason: 'missing_header' | 'stale_timestamp' | 'mismatch' };

/**
 * Vérifie une signature Stripe.
 *
 * Charge signée : `"<timestamp>.<corps brut>"`. Le corps est passé en `Buffer`
 * et concaténé tel quel — le convertir en chaîne puis re-encoder passerait par
 * une normalisation UTF-8 qui casserait toute charge contenant des octets
 * inattendus.
 */
export function verifyStripeSignature(params: {
  rawBody: Buffer;
  header: string | undefined;
  secret: string;
  now?: Date;
  toleranceSeconds?: number;
}): SignatureCheck {
  const parsed = parseStripeSignatureHeader(params.header);
  if (!parsed) return { valid: false, reason: 'missing_header' };

  const nowSeconds = Math.floor((params.now ?? new Date()).getTime() / 1000);
  const tolerance = params.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  // Valeur absolue : un rappel daté DANS LE FUTUR est tout aussi suspect qu'un
  // rappel trop vieux (horloge décalée, ou horodatage choisi par un attaquant
  // pour rester valide longtemps).
  if (Math.abs(nowSeconds - parsed.timestamp) > tolerance) {
    return { valid: false, reason: 'stale_timestamp' };
  }

  const signedPayload = Buffer.concat([
    Buffer.from(`${parsed.timestamp}.`, 'utf8'),
    params.rawBody,
  ]);
  const expected = hmacSha256Hex(params.secret, signedPayload);

  // Toutes les signatures fournies sont testées, sans court-circuit `some()`
  // qui s'arrêterait à la première correspondance : le temps total ne doit pas
  // dépendre de la POSITION de la bonne signature dans l'en-tête.
  let matched = false;
  for (const candidate of parsed.v1) {
    if (timingSafeEqualHex(candidate, expected)) matched = true;
  }

  return matched ? { valid: true } : { valid: false, reason: 'mismatch' };
}
