import { describe, expect, it } from 'vitest';

import { avatarObjectKey, isObjectId, newObjectId } from './object-key.js';
import { encodeS3Path, signV4 } from './sigv4.js';
import { resolveStorageConfig } from './storage.config.js';

const FIXED_DATE = new Date('2026-08-10T12:00:00.000Z');
const CREDS = { region: 'us-east-1', accessKey: 'AKIDEXAMPLE', secretKey: 'sekret' } as const;

describe('nommage des objets', () => {
  it('ne dérive JAMAIS la clé de l’identifiant utilisateur', () => {
    // Le test ne peut pas prouver une absence par introspection : il prouve la
    // propriété qui en découle. Deux appels pour LE MÊME utilisateur — la
    // fonction n'en prend d'ailleurs aucun — donnent deux clés différentes.
    // Une clé dérivée (`hash(userId)`, `userId + extension`) serait stable.
    const a = newObjectId();
    const b = newObjectId();
    expect(a).not.toBe(b);
    expect(isObjectId(a)).toBe(true);
    expect(a).toHaveLength(32);
  });

  it('produit 128 bits d’entropie effective (aucune collision sur 5 000 tirages)', () => {
    const vus = new Set<string>();
    for (let i = 0; i < 5000; i += 1) vus.add(newObjectId());
    expect(vus.size).toBe(5000);
  });

  it('rejette toute forme qui n’est pas un identifiant d’objet', () => {
    for (const faux of [
      '', // vide
      '../../etc/passwd', // traversée
      'avatars/deadbeef', // clé complète et non identifiant
      'DEADBEEFDEADBEEFDEADBEEFDEADBEEF', // majuscules
      'deadbeef', // trop court
      'g'.repeat(32), // hors alphabet hexadécimal
    ]) {
      expect(isObjectId(faux), faux).toBe(false);
    }
  });

  it('range sous un préfixe sans donnée utilisateur', () => {
    const id = newObjectId();
    expect(avatarObjectKey(id)).toBe(`avatars/${id}`);
  });
});

describe('signature SigV4', () => {
  it('signe l’empreinte du CORPS RÉEL et non celle du corps vide', () => {
    const vide = signV4({
      method: 'PUT',
      host: 'localhost:9000',
      path: '/b/k',
      body: Buffer.alloc(0),
      contentType: 'image/png',
      now: FIXED_DATE,
      ...CREDS,
    });
    const plein = signV4({
      method: 'PUT',
      host: 'localhost:9000',
      path: '/b/k',
      body: Buffer.from('contenu'),
      contentType: 'image/png',
      now: FIXED_DATE,
      ...CREDS,
    });

    // `x-amz-content-sha256` est l'oubli classique : sans lui, MinIO répond 403
    // en accusant les identifiants. On vérifie qu'il suit le corps.
    expect(vide['x-amz-content-sha256']).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(plein['x-amz-content-sha256']).not.toBe(vide['x-amz-content-sha256']);
    expect(plein['Authorization']).not.toBe(vide['Authorization']);
  });

  it('inclut content-type dans SignedHeaders quand il est présent, et pas sinon', () => {
    const avec = signV4({
      method: 'PUT',
      host: 'h',
      path: '/b/k',
      body: Buffer.from('x'),
      contentType: 'image/webp',
      now: FIXED_DATE,
      ...CREDS,
    });
    const sans = signV4({ method: 'GET', host: 'h', path: '/b/k', now: FIXED_DATE, ...CREDS });

    expect(avec['Authorization']).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date',
    );
    expect(sans['Authorization']).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date');
  });

  it('est déterministe à date fixée et change de scope avec la région', () => {
    const a = signV4({ method: 'GET', host: 'h', path: '/b/k', now: FIXED_DATE, ...CREDS });
    const b = signV4({ method: 'GET', host: 'h', path: '/b/k', now: FIXED_DATE, ...CREDS });
    const ams = signV4({
      method: 'GET',
      host: 'h',
      path: '/b/k',
      now: FIXED_DATE,
      ...CREDS,
      region: 'ams3',
    });

    expect(a['Authorization']).toBe(b['Authorization']);
    expect(a['Authorization']).toContain('20260810/us-east-1/s3/aws4_request');
    expect(ams['Authorization']).toContain('20260810/ams3/s3/aws4_request');
    expect(ams['Authorization']).not.toBe(a['Authorization']);
  });

  it('n’expose jamais la clé secrète dans les en-têtes produits', () => {
    const h = signV4({
      method: 'PUT',
      host: 'h',
      path: '/b/k',
      body: Buffer.from('x'),
      contentType: 'image/png',
      now: FIXED_DATE,
      ...CREDS,
      secretKey: 'ULTRA-SECRET-VALUE',
    });
    expect(JSON.stringify(h)).not.toContain('ULTRA-SECRET-VALUE');
    // L'accessKey, elle, EST publiable (docs/17 § S21b, providers.ts).
    expect(h['Authorization']).toContain('AKIDEXAMPLE');
  });

  it('encode les caractères que S3 canonicalise différemment', () => {
    expect(encodeS3Path(['bucket', 'avatars', 'ab12'])).toBe('/bucket/avatars/ab12');
    expect(encodeS3Path(["a'b(c)"])).toBe('/a%27b%28c%29');
    expect(encodeS3Path(['a/b'])).toBe('/a%2Fb');
  });
});

describe('configuration du stockage', () => {
  const COMPLET = {
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY: 'lalanda',
    S3_SECRET_KEY: 'lalanda-dev-secret',
    S3_BUCKET_UPLOADS: 'lalanda-uploads',
  };

  it('résout une configuration complète', () => {
    const r = resolveStorageConfig(COMPLET as NodeJS.ProcessEnv);
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.config.bucketUploads).toBe('lalanda-uploads');
    expect(r.config.region).toBe('us-east-1');
    expect(r.config.forcePathStyle).toBe(true);
  });

  it('déclare l’indisponibilité EN NOMMANT ce qui manque, sans deviner de valeur', () => {
    // Un défaut inventé (endpoint AWS implicite, bucket « uploads ») ferait
    // partir des identifiants vers un serveur que personne n'a désigné.
    const r = resolveStorageConfig({ S3_ENDPOINT: 'http://localhost:9000' } as NodeJS.ProcessEnv);
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toContain('S3_ACCESS_KEY');
    expect(r.reason).toContain('S3_SECRET_KEY');
    expect(r.reason).toContain('S3_BUCKET_UPLOADS');
  });

  it('refuse un endpoint qui n’est pas une URL', () => {
    const r = resolveStorageConfig({ ...COMPLET, S3_ENDPOINT: 'pas-une-url' } as NodeJS.ProcessEnv);
    expect(r.available).toBe(false);
  });

  it('respecte S3_FORCE_PATH_STYLE=false (bascule Spaces)', () => {
    const r = resolveStorageConfig({
      ...COMPLET,
      S3_FORCE_PATH_STYLE: 'false',
    } as NodeJS.ProcessEnv);
    expect(r.available && r.config.forcePathStyle).toBe(false);
  });
});
