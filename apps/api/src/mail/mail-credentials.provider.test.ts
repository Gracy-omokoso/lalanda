// Lecture des identifiants SMTP dans l'environnement (S22a).
//
// L'enjeu de ces tests tient en une phrase : AUCUNE variable SMTP ne doit être
// obligatoire, et une valeur illisible ne doit jamais faire tomber l'API.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SMTP_PORT, EnvMailCredentialsProvider } from './mail-credentials.provider.js';

const SMTP_VARS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(SMTP_VARS.map((k) => [k, process.env[k]]));
  for (const k of SMTP_VARS) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('EnvMailCredentialsProvider', () => {
  it('retourne null sans SMTP_HOST — état normal du produit, pas une erreur', async () => {
    expect(await new EnvMailCredentialsProvider().resolve()).toBeNull();
  });

  it('accepte un hôte seul : ni utilisateur, ni mot de passe, ni port ne sont requis', async () => {
    process.env['SMTP_HOST'] = 'localhost';

    const creds = await new EnvMailCredentialsProvider().resolve();

    expect(creds).not.toBeNull();
    expect(creds!.user).toBeUndefined();
    expect(creds!.password).toBeUndefined();
    // 587 et non 25 : le port 25 est bloqué en sortie par la plupart des
    // hébergeurs, un défaut à 25 produirait un timeout silencieux.
    expect(creds!.port).toBe(DEFAULT_SMTP_PORT);
    expect(creds!.secure).toBe(false);
  });

  it('active le TLS implicite sur le port 465, et lui seul', async () => {
    process.env['SMTP_HOST'] = 'smtp.exemple.com';
    process.env['SMTP_PORT'] = '465';

    expect((await new EnvMailCredentialsProvider().resolve())!.secure).toBe(true);

    process.env['SMTP_PORT'] = '2525';
    expect((await new EnvMailCredentialsProvider().resolve())!.secure).toBe(false);
  });

  it('ignore un port illisible plutôt que de faire tomber le démarrage', async () => {
    process.env['SMTP_HOST'] = 'smtp.exemple.com';
    process.env['SMTP_PORT'] = 'cinq-cent-quatre-vingt-sept';

    expect((await new EnvMailCredentialsProvider().resolve())!.port).toBe(DEFAULT_SMTP_PORT);
  });

  it("déduit un expéditeur bien formé quand SMTP_FROM manque, plutôt que d'échouer", async () => {
    process.env['SMTP_HOST'] = 'smtp.gmail.com';

    const creds = await new EnvMailCredentialsProvider().resolve();

    expect(creds!.from).toBe('Lalanda <no-reply@gmail.com>');
  });

  it('respecte SMTP_FROM quand il est renseigné', async () => {
    process.env['SMTP_HOST'] = 'smtp.exemple.com';
    process.env['SMTP_FROM'] = 'Lalanda <bonjour@lalanda.example>';

    expect((await new EnvMailCredentialsProvider().resolve())!.from).toBe(
      'Lalanda <bonjour@lalanda.example>',
    );
  });

  it('traite un hôte vide ou fait d’espaces comme une absence de configuration', async () => {
    process.env['SMTP_HOST'] = '   ';

    expect(await new EnvMailCredentialsProvider().resolve()).toBeNull();
  });
});
