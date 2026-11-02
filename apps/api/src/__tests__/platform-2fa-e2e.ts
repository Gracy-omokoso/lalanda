// Outils e2e de la double authentification de la console (ADR-0053 — P8).
//
// Depuis P8, TOUT opérateur doit être enrôlé et avoir vérifié sa session avant la
// moindre route de console, et la ré-authentification de console exige mot de passe +
// code. Les suites qui posent un rôle plateforme appellent `enrolerDeuxFacteurs` juste
// après, puis `corpsReauth` pour `POST /admin/reauth`.
//
// ── Coffre de test ───────────────────────────────────────────────────────────
//
// Le secret TOTP est chiffré sous `SECRETS_MASTER_KEY` (ADR-0013). Une suite sans clé
// n'aurait aucun coffre : ce module en pose une DE TEST si l'environnement n'en fournit
// pas, à l'import — donc avant le démarrage de Nest dans le `beforeAll` de la suite.
//
// ── Anti-rejeu ───────────────────────────────────────────────────────────────
//
// L'API refuse un pas TOTP déjà utilisé (RFC 6238 § 5.2). Une suite qui se
// ré-authentifie plusieurs fois en trente secondes remet donc à zéro le dernier pas
// accepté de SON opérateur avant de calculer le code : un geste de banc d'essai, sur la
// base de la suite, jamais un contournement du serveur.

import type { INestApplication } from '@nestjs/common';
import type { Db } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';

import { totpCodeAt } from '../platform-two-factor/totp.js';

process.env['SECRETS_MASTER_KEY'] ??= randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] ??= 'e2e-2fa';

/** Secret TOTP de chaque opérateur enrôlé par ce module, par identifiant de compte. */
const secrets = new Map<string, string>();
/** Codes de secours remis à l'enrôlement, par identifiant de compte. */
const codesDeSecours = new Map<string, string[]>();

function base32De(manualKey: string): string {
  return manualKey.replace(/\s/g, '');
}

async function idDe(app: INestApplication, cookies: string[]): Promise<string> {
  const s = await request(app.getHttpServer()).get('/auth/get-session').set('Cookie', cookies);
  const id = String(s.body?.user?.id ?? '');
  if (!id) throw new Error('Session introuvable pour l’enrôlement e2e.');
  return id;
}

/**
 * Enrôle l'opérateur de cette session (QR code → code → codes de secours) et vérifie la
 * session. À appeler APRÈS avoir posé son rôle plateforme.
 */
export async function enrolerDeuxFacteurs(
  app: INestApplication,
  cookies: string[],
  password: string,
): Promise<{ userId: string; secret: string; backupCodes: string[] }> {
  const server = app.getHttpServer();
  const userId = await idDe(app, cookies);
  const debut = await request(server).post('/admin/two-factor/enrollment').set('Cookie', cookies);
  if (debut.status !== 200) {
    throw new Error(`Enrôlement 2FA refusé (${debut.status}) : ${JSON.stringify(debut.body)}`);
  }
  const secret = base32De(String(debut.body.manualKey));
  const fin = await request(server)
    .post('/admin/two-factor/enrollment/confirm')
    .set('Cookie', cookies)
    .send({ password, code: totpCodeAt(secret, Date.now()) });
  if (fin.status !== 200) {
    throw new Error(`Confirmation 2FA refusée (${fin.status}) : ${JSON.stringify(fin.body)}`);
  }
  secrets.set(userId, secret);
  codesDeSecours.set(userId, fin.body.backupCodes as string[]);
  return { userId, secret, backupCodes: fin.body.backupCodes as string[] };
}

/** Code TOTP courant de l'opérateur, après remise à zéro de l'anti-rejeu (voir l'en-tête). */
export async function codeCourant(db: Db, userId: string): Promise<string> {
  const secret = secrets.get(userId);
  if (!secret) throw new Error(`Opérateur ${userId} non enrôlé par platform-2fa-e2e.`);
  await db
    .collection('platform_two_factor')
    .updateOne({ userId }, { $set: { lastUsedStep: null } });
  return totpCodeAt(secret, Date.now());
}

/** Corps de `POST /admin/reauth` : mot de passe + code TOTP courant. */
export async function corpsReauth(
  app: INestApplication,
  db: Db,
  cookies: string[],
  password: string,
): Promise<{ password: string; code: string }> {
  return { password, code: await codeCourant(db, await idDe(app, cookies)) };
}

/** Secret mémorisé d'un opérateur enrôlé ici. */
export function secretDe(userId: string): string | undefined {
  return secrets.get(userId);
}
