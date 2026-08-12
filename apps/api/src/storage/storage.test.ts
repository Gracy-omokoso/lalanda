import { describe, expect, it } from 'vitest';

import { avatarObjectKey, isObjectId, newObjectId } from './object-key.js';
import { encodeS3Path, signV4 } from './sigv4.js';
import { flavorOfHost, resolveStorageConfig } from './storage.config.js';

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

describe('compatibilité Cloudflare R2', () => {
  const R2 = {
    S3_ENDPOINT: 'https://abc123def456.r2.cloudflarestorage.com',
    S3_ACCESS_KEY: 'r2-access-key',
    S3_SECRET_KEY: 'r2-secret-key',
    S3_BUCKET_UPLOADS: 'lalanda-uploads',
  };

  it('reconnaît R2 sur le SUFFIXE d’hôte, pas sur une sous-chaîne', () => {
    expect(flavorOfHost('abc123.r2.cloudflarestorage.com')).toBe('r2');
    expect(flavorOfHost('ABC123.R2.CloudflareStorage.com')).toBe('r2');
    // Un bucket MinIO dont le nom CONTIENT le domaine ne doit pas basculer les
    // défauts d'un serveur qui n'est pas R2 — d'où le suffixe et non `includes`.
    expect(flavorOfHost('r2.cloudflarestorage.com.exemple.test')).toBe('s3');
    expect(flavorOfHost('localhost:9000')).toBe('s3');
    expect(flavorOfHost('ams3.digitaloceanspaces.com')).toBe('s3');
  });

  it('signe R2 en région « auto » sans qu’on ait à la déclarer', () => {
    // R2 n'a pas de région au sens AWS, mais SigV4 en EXIGE une dans le scope :
    // il n'existe pas de signature sans jeton de région. Cloudflare attend `auto`.
    const r = resolveStorageConfig(R2 as NodeJS.ProcessEnv);
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.config.flavor).toBe('r2');
    expect(r.config.region).toBe('auto');
    // Le style de chemin convient à R2 comme à MinIO : passer à R2 ne demande
    // pas de toucher à `S3_FORCE_PATH_STYLE`.
    expect(r.config.forcePathStyle).toBe(true);
  });

  it('laisse S3_REGION explicite l’emporter sur le défaut déduit', () => {
    const r = resolveStorageConfig({ ...R2, S3_REGION: 'wnam' } as NodeJS.ProcessEnv);
    expect(r.available && r.config.region).toBe('wnam');
  });

  it('ne change RIEN pour MinIO — le déploiement en place garde us-east-1', () => {
    // C'est CE test qui prouve la non-régression du déploiement en production :
    // MinIO tourne aujourd'hui et porte les photos de profil.
    const r = resolveStorageConfig({
      S3_ENDPOINT: 'http://minio:9000',
      S3_ACCESS_KEY: 'lalanda',
      S3_SECRET_KEY: 'lalanda-dev-secret',
      S3_BUCKET_UPLOADS: 'lalanda-uploads',
    } as NodeJS.ProcessEnv);
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.config.flavor).toBe('s3');
    expect(r.config.region).toBe('us-east-1');
  });

  it('exige les mêmes variables pour R2 que pour MinIO — aucune n’est devinée', () => {
    const r = resolveStorageConfig({ S3_ENDPOINT: R2.S3_ENDPOINT } as NodeJS.ProcessEnv);
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toContain('S3_ACCESS_KEY');
    expect(r.reason).toContain('S3_SECRET_KEY');
    expect(r.reason).toContain('S3_BUCKET_UPLOADS');
  });

  it('produit un scope de signature accepté par R2', () => {
    const r = resolveStorageConfig(R2 as NodeJS.ProcessEnv);
    expect(r.available).toBe(true);
    if (!r.available) return;
    const headers = signV4({
      method: 'PUT',
      host: 'abc123def456.r2.cloudflarestorage.com',
      path: '/lalanda-uploads/avatars/ab12',
      region: r.config.region,
      accessKey: r.config.accessKey,
      secretKey: r.config.secretKey,
      body: Buffer.from('image'),
      contentType: 'image/webp',
      now: FIXED_DATE,
    });
    // Le nom de SERVICE reste `s3` chez R2 : c'est ce qui permet à `sigv4.ts` de
    // rester inchangé.
    expect(headers['Authorization']).toContain('20260810/auto/s3/aws4_request');
    // `x-amz-content-sha256` porte bien l'empreinte du corps réel, pas celle du
    // corps vide — l'oubli classique qui fait répondre 403 en accusant la clé.
    expect(headers['x-amz-content-sha256']).not.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
