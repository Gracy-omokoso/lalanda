// ─────────────────────────────────────────────────────────────────────────────
// SERVITUDE DE L'IMAGE — la décision structurante de ce lot
//
// Trois options étaient ouvertes. Voici pourquoi c'est la troisième.
//
// ── 1. URL publique sur le bucket : IMPOSSIBLE, et indésirable ───────────────
//
// `docker-compose.prod.yml` place MinIO sur un réseau `internal: true` : le
// conteneur n'est joignable que par l'API, jamais par un navigateur (docs/24
// § Stack de production). Rendre le bucket public supposerait de le publier sur
// le réseau `edge` — c'est-à-dire défaire l'isolation réseau pour une photo de
// profil. Et un bucket public l'est pour TOUT ce qu'il contient : la même
// décision s'appliquerait demain aux exports et aux instantanés, qui sont des
// documents financiers.
//
// ── 2. URL signée S3 (presigned) : couplage et fuite de topologie ────────────
//
// Elle exige elle aussi que le navigateur joigne le magasin d'objets — même
// obstacle. Elle inscrit en outre l'endpoint, le nom du bucket et la clé
// d'accès dans une URL qui finit dans l'historique du navigateur et dans les
// journaux de tout intermédiaire ; et elle fige le fournisseur : la bascule
// MinIO → Spaces prévue par docs/24 invaliderait toutes les URL en circulation.
//
// ── 3. Proxy par l'API, avec jeton signé dans le chemin : RETENU ─────────────
//
//   - le bucket reste privé et les identifiants S3 ne quittent jamais le serveur ;
//   - l'API choisit elle-même les en-têtes de réponse. C'est ce qui rend inerte
//     un fichier hostile qui aurait franchi la validation : `Content-Type` issu
//     de NOTRE analyse du contenu, `X-Content-Type-Options: nosniff`,
//     `Content-Security-Policy: default-src 'none'; sandbox` ;
//   - le jeton fonctionne dans un `<img src>` ORDINAIRE. C'est un point pratique
//     décisif : `apps/web` appelle l'API en CROSS-ORIGIN (`credentials:
//     'include'`, voir apps/web/src/lib/api.ts). Une route protégée par cookie
//     obligerait chaque balise à porter `crossorigin="use-credentials"` — un
//     attribut facile à oublier, dont l'oubli produit une image cassée sans le
//     moindre message d'erreur ;
//   - le changement de fournisseur de stockage ne change aucune URL.
//
// Ce qu'il en coûte, honnêtement : la bande passante des images passe par l'API
// et aucun CDN ne la décharge. Pour des vignettes de 2 Mio maximum, avec un
// `Cache-Control` d'un jour, c'est un coût connu et borné — et le rapport le
// nomme comme limite à revoir si les avatars deviennent nombreux.
//
// ── Ce que le jeton garantit, et ce qu'il ne garantit pas ────────────────────
//
// Il porte un identifiant d'objet de 128 bits tiré au hasard (aucune dérivation
// de `userId`) et une expiration, scellés par un HMAC-SHA256 dont la clé ne
// quitte pas le serveur. Conséquences :
//
//   - PAS D'ÉNUMÉRATION : sans la clé, aucun jeton valide ne se fabrique, et
//     l'identifiant lui-même n'est pas devinable ;
//   - PAS D'ORACLE : signature invalide, jeton expiré et objet inexistant
//     rendent tous `404`. La réponse ne dit pas laquelle des trois ;
//   - RÉVOCATION IMMÉDIATE, indépendante de l'expiration : retirer ou remplacer
//     une photo supprime l'enregistrement, donc tout jeton déjà distribué cesse
//     de désigner quoi que ce soit — y compris dans sa fenêtre de validité.
//
// Ce qu'il NE garantit PAS, et il faut le dire : pendant sa fenêtre, quiconque
// obtient l'URL voit l'image, sans session. C'est la propriété d'une URL-capacité,
// la même que celle d'une URL signée S3. Pour une photo de profil — montrée à
// tous les membres de l'organisation — c'est le bon compromis. Pour un export
// financier, ce ne le serait pas : le futur lot exports devra exiger la session.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

import { isObjectId } from '../storage/object-key.js';

/**
 * 24 heures.
 *
 * Assez long pour qu'un onglet resté ouvert n'affiche pas une image cassée au
 * bout d'un moment ; assez court pour borner l'exposition d'une URL recopiée par
 * mégarde. La vraie protection contre une URL qui traîne n'est pas cette durée,
 * c'est la rotation de l'identifiant d'objet à chaque écriture.
 */
export const AVATAR_URL_TTL_SECONDS = 24 * 60 * 60;

/**
 * Clé de signature, DÉRIVÉE de `AUTH_SECRET` et propre à cet usage.
 *
 * Pas de nouvelle variable d'environnement : une variable de plus est une
 * variable de plus à générer, à distribuer et à oublier en production. La
 * dérivation HKDF avec une étiquette d'usage garantit que cette clé ne signe que
 * des URL d'avatar — elle ne permet pas de forger une session, et une fuite de
 * jeton d'avatar ne remonte pas jusqu'à `AUTH_SECRET`.
 */
function signingKey(): Buffer {
  const racine = process.env['AUTH_SECRET'];
  if (!racine) {
    // `AUTH_SECRET` est requise par le schéma d'environnement : son absence
    // signale un démarrage hors du chemin normal. On refuse bruyamment plutôt
    // que de signer avec une valeur de repli, qui serait la même partout.
    throw new Error('AUTH_SECRET absente : impossible de signer une URL d’avatar.');
  }
  return Buffer.from(hkdfSync('sha256', racine, 'lalanda/avatar-url', 'v1', 32));
}

function sceau(charge: string): string {
  return createHmac('sha256', signingKey()).update(charge).digest('base64url');
}

/** Jeton opaque `<objectId>.<expiration>.<signature>`. */
export function mintAvatarToken(objectId: string, nowMs: number = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + AVATAR_URL_TTL_SECONDS;
  const charge = `${objectId}.${exp}`;
  return `${charge}.${sceau(charge)}`;
}

/**
 * Identifiant d'objet si le jeton est authentique ET non expiré, sinon `null`.
 *
 * Un `null` unique pour tous les motifs de rejet : l'appelant ne peut pas
 * distinguer « mal signé » de « expiré », et ne peut donc pas transformer la
 * route en oracle.
 */
export function verifyAvatarToken(token: string, nowMs: number = Date.now()): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [objectId, expBrut, signature] = parts as [string, string, string];

  if (!isObjectId(objectId)) return null;
  if (!/^\d{1,12}$/.test(expBrut)) return null;

  const attendue = Buffer.from(sceau(`${objectId}.${expBrut}`));
  const recue = Buffer.from(signature);
  // Longueurs comparées d'abord : `timingSafeEqual` lève sur des tailles
  // différentes, et la comparaison à temps constant n'a de sens qu'à taille égale.
  if (attendue.length !== recue.length) return null;
  if (!timingSafeEqual(attendue, recue)) return null;

  // L'expiration n'est vérifiée QU'APRÈS la signature : sur un jeton non
  // authentique, la date est une valeur choisie par l'appelant et ne mérite
  // aucune considération.
  if (Number(expBrut) * 1000 <= nowMs) return null;

  return objectId;
}

/**
 * URL absolue servie dans la réponse de profil.
 *
 * Absolue et non relative : `apps/web` est sur une autre origine que l'API et
 * ne peut pas résoudre un chemin nu. `API_URL` est déjà la variable qui décrit
 * l'origine publique de l'API (`.env`, `main.ts`).
 */
export function avatarUrlFor(objectId: string, nowMs: number = Date.now()): string {
  const base = (process.env['API_URL'] ?? 'http://localhost:3001').replace(/\/+$/, '');
  return `${base}/account/avatar/${mintAvatarToken(objectId, nowMs)}`;
}
