// Connexion Google et liaison de comptes (S22a).
//
// ── AUCUN APPEL À GOOGLE ──────────────────────────────────────────────────────
// Ces tests exercent le VRAI chemin de better-auth (`/sign-in/social` avec un
// jeton d'identité), mais l'unique dépendance réseau de ce chemin — le
// téléchargement des clés publiques de Google — est interceptée. On génère une
// paire de clés RSA locale, on sert sa partie publique en guise de JWKS Google,
// et on signe nos propres jetons d'identité avec la partie privée.
//
// Pourquoi ne pas simplement appeler une fonction interne de better-auth : parce
// que ce qu'on veut vérifier n'est pas notre code, c'est une DÉCISION DE
// CONFIGURATION (`accountLinking`) dont l'effet vit entièrement dans le leur. Un
// test qui court-circuiterait leur logique de liaison passerait au vert le jour
// où notre configuration cesserait de produire l'effet attendu — c'est-à-dire
// exactement le jour où il devrait échouer.
//
// La signature JWT est faite avec `node:crypto` plutôt qu'avec `jose` : `jose`
// n'est qu'une dépendance transitive de better-auth, l'ajouter en dépendance de
// test pour vingt lignes de base64url ferait porter au projet une contrainte de
// version qu'il n'a pas.

import type { INestApplication } from '@nestjs/common';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';

// ── Configuration Google, posée AVANT tout import de l'application ───────────
// `buildAuth` lit `process.env` au bootstrap et met son instance en cache pour
// tout le process. Positionner ces variables dans un `beforeAll` serait trop
// tard : l'application serait déjà construite sans fournisseur social.
const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env['GOOGLE_CLIENT_ID'] = CLIENT_ID;
process.env['GOOGLE_CLIENT_SECRET'] = 'test-client-secret';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const KID = 'cle-de-test';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

/**
 * JWKS servi à la place de celui de Google.
 *
 * `publicKey.export({ format: 'jwk' })` directement, sans repasser par
 * `createPublicKey` : depuis Node 24, redonner un `KeyObject` public à
 * `createPublicKey` lève `ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE`. L'exception
 * remonterait dans le `fetch` détourné, où elle se lirait comme un « jeton
 * invalide » — un échec parfaitement trompeur.
 */
function jwks(): { keys: unknown[] } {
  const jwk = (publicKey as KeyObject).export({ format: 'jwk' });
  return { keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }] };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** Jeton d'identité Google signé localement, indiscernable d'un vrai pour le vérificateur. */
function signIdToken(claims: {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      iat: now,
      exp: now + 300,
      ...claims,
    }),
  );
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${payload}`)
    .sign(privateKey as KeyObject);
  return `${header}.${payload}.${base64url(signature)}`;
}

/**
 * Détourne les seules requêtes vers le JWKS de Google. Tout le reste passe par
 * l'implémentation d'origine : un `fetch` global remplacé sans discernement
 * masquerait n'importe quel autre appel sortant que le code viendrait à faire.
 */
function stubGoogleJwks(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(GOOGLE_JWKS_URL)) {
      return new Response(JSON.stringify(jwks()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return original(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const MOT_DE_PASSE = 'MotDePasseTest!2026';
const EMAIL_LIAISON = 's22a-google-liaison@exemple-test.com';
const EMAIL_NEUF = 's22a-google-neuf@exemple-test.com';
const EMAIL_NON_VERIFIE = 's22a-google-non-verifie@exemple-test.com';
const TOUS_LES_EMAILS = [EMAIL_LIAISON, EMAIL_NEUF, EMAIL_NON_VERIFIE];

e2eSuite('Connexion Google (S22a)', () => {
  let app: INestApplication;
  let restoreFetch: () => void;

  beforeAll(async () => {
    restoreFetch = stubGoogleJwks();
    app = await makeE2EApp();
    // Un run précédent interrompu peut avoir laissé des utilisateurs : la
    // liaison de comptes est sensible à l'état initial, on repart propre.
    const { purgeTestUsers } = await import('./e2e-utils.js');
    await purgeTestUsers(await dbOf(app), TOUS_LES_EMAILS);
  }, 60_000);

  afterAll(async () => {
    try {
      await teardown(app, TOUS_LES_EMAILS);
    } finally {
      restoreFetch();
    }
  });

  async function signInWithGoogle(claims: {
    sub: string;
    email: string;
    email_verified: boolean;
    name?: string;
  }): Promise<{ status: number; body: Record<string, unknown> }> {
    const { default: request } = await import('supertest');
    const res = await request(app.getHttpServer())
      .post('/auth/sign-in/social')
      .send({ provider: 'google', idToken: { token: signIdToken(claims) } });
    return { status: res.status, body: res.body as Record<string, unknown> };
  }

  it('déclare Google disponible quand les deux identifiants sont configurés', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app.getHttpServer()).get('/auth-providers');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ google: true });
  });

  it('crée un compte vérifié à la première connexion Google', async () => {
    const res = await signInWithGoogle({
      sub: 'google-sub-neuf',
      email: EMAIL_NEUF,
      email_verified: true,
      name: 'Neuf Google',
    });

    expect(res.status).toBe(200);

    const db = await dbOf(app);
    const user = await db.collection('user').findOne({ email: EMAIL_NEUF });
    expect(user).not.toBeNull();
    // Google atteste lui-même de la propriété de l'adresse : redemander une
    // vérification par email serait exiger deux fois la même preuve.
    expect(user!['emailVerified']).toBe(true);

    // Le hook d'inscription vaut pour TOUS les chemins de création, pas seulement
    // pour l'inscription par mot de passe : sans organisation personnelle, le
    // nouvel arrivant atterrirait dans une application vide.
    const orgs = await db.collection('organizations').find({ ownerId: String(user!._id) }).toArray();
    expect(orgs).toHaveLength(1);
  });

  it('RETROUVE le compte existant inscrit par mot de passe, sans en créer un second', async () => {
    // 1. Inscription classique, par mot de passe. Aucun SMTP en test : l'adresse
    //    reste NON VÉRIFIÉE localement — c'est justement le cas que
    //    `requireLocalEmailVerified: false` rend praticable.
    await registerAndLogin(app, {
      email: EMAIL_LIAISON,
      password: MOT_DE_PASSE,
      name: 'Aline Liaison',
    });

    const db = await dbOf(app);
    const avant = await db.collection('user').findOne({ email: EMAIL_LIAISON });
    expect(avant).not.toBeNull();
    expect(avant!['emailVerified']).toBe(false);

    // 2. Retour par Google, MÊME adresse.
    const res = await signInWithGoogle({
      sub: 'google-sub-liaison',
      email: EMAIL_LIAISON,
      email_verified: true,
      name: 'Aline Liaison',
    });

    expect(res.status).toBe(200);
    expect((res.body['user'] as { id: string }).id).toBe(String(avant!._id));

    // 3. UN SEUL utilisateur porte cette adresse — la garantie centrale du lot.
    const users = await db.collection('user').find({ email: EMAIL_LIAISON }).toArray();
    expect(users).toHaveLength(1);

    // 4. Deux moyens de connexion coexistent sur le même compte : le mot de passe
    //    d'origine ne doit pas avoir été remplacé par la liaison.
    const comptes = await db.collection('account').find({ userId: avant!._id }).toArray();
    expect(comptes.map((c) => c['providerId']).sort()).toEqual(['credential', 'google']);

    // 5. L'attestation de Google promeut l'adresse au rang de vérifiée.
    const apres = await db.collection('user').findOne({ _id: avant!._id });
    expect(apres!['emailVerified']).toBe(true);

    // 6. Et le mot de passe d'origine fonctionne toujours.
    const { default: request } = await import('supertest');
    const connexion = await request(app.getHttpServer())
      .post('/auth/sign-in/email')
      .send({ email: EMAIL_LIAISON, password: MOT_DE_PASSE });
    expect(connexion.status).toBe(200);
  });

  it("REFUSE la liaison quand Google n'atteste pas l'adresse", async () => {
    await registerAndLogin(app, {
      email: EMAIL_NON_VERIFIE,
      password: MOT_DE_PASSE,
      name: 'Non Verifie',
    });

    const res = await signInWithGoogle({
      sub: 'google-sub-non-verifie',
      email: EMAIL_NON_VERIFIE,
      email_verified: false,
    });

    // `trustedProviders` est VOLONTAIREMENT vide : sans attestation de Google, il
    // ne reste aucune preuve que la personne qui se présente possède l'adresse.
    // Ce test échouerait si quelqu'un ajoutait "google" à la liste en croyant
    // « faciliter » la connexion.
    expect(res.status).toBe(401);

    const db = await dbOf(app);
    const users = await db.collection('user').find({ email: EMAIL_NON_VERIFIE }).toArray();
    expect(users).toHaveLength(1);
    const comptes = await db.collection('account').find({ userId: users[0]!._id }).toArray();
    expect(comptes.map((c) => c['providerId'])).toEqual(['credential']);
  });
});
