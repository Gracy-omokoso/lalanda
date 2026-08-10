// ─────────────────────────────────────────────────────────────────────────────
// SIGNATURE AWS SIGV4 — requêtes S3 avec corps
//
// ── Pourquoi pas `@aws-sdk/client-s3` ────────────────────────────────────────
//
// `integrations/connection-tests.ts` a déjà tranché la question pour le test de
// connexion S3, en s'appuyant sur ADR-0013 §10 : le processus API détient
// `SECRETS_MASTER_KEY`, et y importer un arbre de dépendances complet agrandit
// exactement la surface d'approvisionnement que l'ADR désigne comme non
// couverte. L'argument vaut à l'identique ici : trois verbes (PUT, GET, DELETE)
// sur un seul bucket ne justifient pas le client AWS complet.
//
// Ce fichier N'EST PAS une copie de celui d'`integrations/` : celui-là signe des
// requêtes SANS corps (`HeadBucket`), avec l'empreinte du corps vide en dur.
// Stocker un objet impose de signer un corps réel, donc de calculer son
// `x-amz-content-sha256` et d'inclure `content-type` dans les en-têtes signés.
// Les deux implémentations restent séparées parce que leurs modules le sont :
// `integrations/` appartient au chantier coffre-fort, `storage/` au chantier
// stockage. Les fusionner créerait une dépendance entre deux domaines qui n'en
// ont aucune.
//
// ── Le piège classique ───────────────────────────────────────────────────────
//
// `x-amz-content-sha256` est OBLIGATOIRE pour S3 et doit porter l'empreinte du
// corps RÉEL. Omis ou faux, MinIO et Spaces répondent `403` avec un message qui
// accuse les identifiants — ce qui envoie chercher le problème du mauvais côté.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, createHmac } from 'node:crypto';

export interface SignV4Input {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  /** Hôte tel qu'il apparaîtra dans l'en-tête `Host` (port compris). */
  host: string;
  /** Chemin absolu, déjà encodé (ex. `/lalanda-uploads/avatars/ab12…`). */
  path: string;
  region: string;
  accessKey: string;
  secretKey: string;
  /** Corps de la requête. `undefined` pour GET/DELETE/HEAD. */
  body?: Buffer;
  /** Type MIME du corps, signé avec le reste. */
  contentType?: string;
  /** Injectable pour rendre les tests déterministes. */
  now?: Date;
}

/**
 * En-têtes signés, prêts à être passés à `fetch`.
 *
 * L'ensemble des en-têtes rendus est exactement celui qui a été signé : en
 * ajouter un après coup n'invalide rien (S3 ne signe que ce que
 * `SignedHeaders` énumère), mais en RETIRER un produit un 403.
 */
export function signV4(input: SignV4Input): Record<string, string> {
  const now = input.now ?? new Date();
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = createHash('sha256')
    .update(input.body ?? Buffer.alloc(0))
    .digest('hex');

  // Les en-têtes signés doivent être triés par nom en minuscules — c'est la
  // canonicalisation, pas une préférence de style.
  const headers: Record<string, string> = {
    host: input.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (input.contentType) headers['content-type'] = input.contentType;

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((n) => `${n}:${headers[n]!.trim()}\n`).join('');
  const signedHeaders = sortedNames.join(';');

  const canonicalRequest = [
    input.method,
    input.path,
    '', // pas de query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${input.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  // Dérivation en cascade de la clé de signature (AWS4-HMAC-SHA256).
  const kDate = createHmac('sha256', `AWS4${input.secretKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(input.region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  const signingKey = createHmac('sha256', kService).update('aws4_request').digest();

  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    ...headers,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/**
 * Encodage d'un segment de chemin S3.
 *
 * `encodeURIComponent` laisse passer `!'()*`, que S3 exige encodés : un objet
 * dont la clé en contient un signerait une requête que le serveur canonicalise
 * différemment, donc un 403 intermittent selon la clé tirée au hasard. Nos clés
 * sont hexadécimales, mais la fonction est utilisée par un service générique qui
 * n'a aucune raison de le supposer.
 */
export function encodeS3Path(segments: readonly string[]): string {
  return (
    '/' +
    segments
      .map((s) =>
        encodeURIComponent(s).replace(
          /[!'()*]/g,
          (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
        ),
      )
      .join('/')
  );
}
