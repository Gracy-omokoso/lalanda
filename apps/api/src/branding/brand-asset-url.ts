// URL d'affichage d'un logo d'organisation — ADR-0028 § 7.
//
// Même décision que la photo de profil (`account/avatar-url.ts`, à lire pour
// les raisons) : bucket privé, proxy par l'API, jeton signé HMAC dans le chemin,
// utilisable dans un `<img>` ordinaire depuis `apps/web` (cross-origin).
//
// Clé DISTINCTE, dérivée d'`AUTH_SECRET` avec sa propre étiquette : un jeton
// d'avatar ne vaut pas jeton de logo, et réciproquement.
//
// RÉVOCATION : la route ne sert un logo que s'il est ACTUELLEMENT relié à
// l'identité de son organisation. Remplacer ou retirer un logo rend donc
// immédiatement inopérantes les URL distribuées — alors même que l'objet est
// conservé (une facture gelée peut le désigner ; il n'est lu, pour elle, que par
// le rendu PDF côté serveur, jamais par une URL).

import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

import { isObjectId } from '../storage/object-key.js';

/** 24 heures, comme l'avatar. */
export const BRAND_ASSET_URL_TTL_SECONDS = 24 * 60 * 60;

function signingKey(): Buffer {
  const racine = process.env['AUTH_SECRET'];
  if (!racine) throw new Error('AUTH_SECRET absente : impossible de signer une URL de logo.');
  return Buffer.from(hkdfSync('sha256', racine, 'lalanda/brand-asset-url', 'v1', 32));
}

function sceau(charge: string): string {
  return createHmac('sha256', signingKey()).update(charge).digest('base64url');
}

export function mintBrandAssetToken(assetId: string, nowMs: number = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + BRAND_ASSET_URL_TTL_SECONDS;
  const charge = `${assetId}.${exp}`;
  return `${charge}.${sceau(charge)}`;
}

/** Identifiant si le jeton est authentique et non expiré ; `null` pour tout autre cas. */
export function verifyBrandAssetToken(token: string, nowMs: number = Date.now()): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [assetId, expBrut, signature] = parts as [string, string, string];
  if (!isObjectId(assetId)) return null;
  if (!/^\d{1,12}$/.test(expBrut)) return null;
  const attendue = Buffer.from(sceau(`${assetId}.${expBrut}`));
  const recue = Buffer.from(signature);
  if (attendue.length !== recue.length) return null;
  if (!timingSafeEqual(attendue, recue)) return null;
  if (Number(expBrut) * 1000 <= nowMs) return null;
  return assetId;
}

export function brandAssetUrlFor(assetId: string, nowMs: number = Date.now()): string {
  const base = (process.env['API_URL'] ?? 'http://localhost:3001').replace(/\/+$/, '');
  return `${base}/brand-assets/${mintBrandAssetToken(assetId, nowMs)}`;
}
