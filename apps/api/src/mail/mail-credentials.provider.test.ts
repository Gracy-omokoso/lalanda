// Lecture des identifiants d'envoi dans l'environnement (S22a, deux chemins S22m).
//
// L'enjeu de ces tests tient en deux phrases : AUCUNE variable ne doit être
// obligatoire, une valeur illisible ne doit jamais faire tomber l'API — et la
// PRÉCÉDENCE entre les deux chemins doit être une propriété vérifiée, pas une
// lecture attentive du code. Un jour où `ZEPTOMAIL_TOKEN` et `SMTP_HOST` sont
// tous deux posés, il ne doit exister aucun doute sur celui qui sert.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SMTP_PORT, EnvMailCredentialsProvider } from './mail-credentials.provider.js';
import type { SmtpCredentials, ZeptoMailCredentials } from './mail.types.js';
import { ZEPTOMAIL_DEFAULT_API_URL } from './zeptomail.client.js';

const VARS = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM',
  'MAIL_FROM',
  'ZEPTOMAIL_TOKEN',
  'ZEPTOMAIL_API_URL',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** Résout en exigeant le chemin SMTP — échoue bruyamment si c'est l'autre. */
async function resoudreSmtp(): Promise<SmtpCredentials> {
  const creds = await new EnvMailCredentialsProvider().resolve();
  expect(creds?.kind).toBe('smtp');
  return creds as SmtpCredentials;
}

/** Résout en exigeant le chemin ZeptoMail. */
async function resoudreZepto(): Promise<ZeptoMailCredentials> {
  const creds = await new EnvMailCredentialsProvider().resolve();
  expect(creds?.kind).toBe('zeptomail');
  return creds as ZeptoMailCredentials;
}

// ─── Aucun chemin configuré ──────────────────────────────────────────────────

describe('sans aucune configuration', () => {
  it('retourne null — état normal du produit, pas une erreur', async () => {
    // La propriété qu'ADR-0014 nomme non négociable : l'API démarre et fonctionne
    // sans qu'aucun envoi ne soit configuré. C'est le test qui l'ancre.
    expect(await new EnvMailCredentialsProvider().resolve()).toBeNull();
  });

  it('traite un jeton ou un hôte fait d’espaces comme une absence', async () => {
    process.env['ZEPTOMAIL_TOKEN'] = '   ';
    process.env['SMTP_HOST'] = '   ';

    expect(await new EnvMailCredentialsProvider().resolve()).toBeNull();
  });
});

// ─── Précédence ──────────────────────────────────────────────────────────────

describe('précédence entre les deux chemins', () => {
  it('choisit ZeptoMail quand les DEUX sont configurés', async () => {
    // Le cas du déploiement de bascule : l'ancien bloc SMTP est encore posé, le
    // jeton vient d'être ajouté. Sans cette règle, la bascule n'aurait lieu qu'au
    // retrait des variables SMTP — c'est-à-dire jamais le jour prévu.
    process.env['SMTP_HOST'] = 'smtp.exemple.com';
    process.env['ZEPTOMAIL_TOKEN'] = 'jeton-zepto-de-test';

    const creds = await resoudreZepto();
    expect(creds.token).toBe('jeton-zepto-de-test');
  });

  it('retombe sur SMTP quand le jeton est absent — MailHog local reste branchable', async () => {
    process.env['SMTP_HOST'] = 'localhost';
    process.env['SMTP_PORT'] = '1025';

    const creds = await resoudreSmtp();
    expect(creds.host).toBe('localhost');
    expect(creds.port).toBe(1025);
  });
});

// ─── Chemin ZeptoMail ────────────────────────────────────────────────────────

describe('chemin ZeptoMail', () => {
  it('accepte le jeton seul : aucune autre variable n’est requise', async () => {
    process.env['ZEPTOMAIL_TOKEN'] = 'jeton-zepto-de-test';

    const creds = await resoudreZepto();
    expect(creds.apiUrl).toBe(ZEPTOMAIL_DEFAULT_API_URL);
    expect(creds.from).toBe('Lalanda <no-reply@lalanda.co>');
  });

  it('retire le préfixe `Zoho-enczapikey` collé depuis la console', async () => {
    // La console Zoho affiche la ligne d'en-tête ENTIÈRE. Le préfixe doublé
    // produit un 401 que personne ne relie à un copier-coller.
    process.env['ZEPTOMAIL_TOKEN'] = 'Zoho-enczapikey wSsVR60h/xxxxxxxx';

    expect((await resoudreZepto()).token).toBe('wSsVR60h/xxxxxxxx');
  });

  it('respecte un centre de données explicite — .eu et .in existent', async () => {
    // Un jeton émis sur `.com` est refusé par `.eu` : le point d'entrée fait
    // partie des identifiants, pas du décor.
    process.env['ZEPTOMAIL_TOKEN'] = 'jeton-zepto-de-test';
    process.env['ZEPTOMAIL_API_URL'] = 'https://api.zeptomail.eu/v1.1/email';

    expect((await resoudreZepto()).apiUrl).toBe('https://api.zeptomail.eu/v1.1/email');
  });
});

// ─── Chemin SMTP — non-régression S22a ───────────────────────────────────────

describe('chemin SMTP', () => {
  it('accepte un hôte seul : ni utilisateur, ni mot de passe, ni port ne sont requis', async () => {
    process.env['SMTP_HOST'] = 'localhost';

    const creds = await resoudreSmtp();

    expect(creds.user).toBeUndefined();
    expect(creds.password).toBeUndefined();
    // 587 et non 25 : le port 25 est bloqué en sortie par la plupart des
    // hébergeurs, un défaut à 25 produirait un timeout silencieux.
    expect(creds.port).toBe(DEFAULT_SMTP_PORT);
    expect(creds.secure).toBe(false);
  });

  it('active le TLS implicite sur le port 465, et lui seul', async () => {
    process.env['SMTP_HOST'] = 'smtp.exemple.com';
    process.env['SMTP_PORT'] = '465';

    expect((await resoudreSmtp()).secure).toBe(true);

    process.env['SMTP_PORT'] = '2525';
    expect((await resoudreSmtp()).secure).toBe(false);
  });

  it('ignore un port illisible plutôt que de faire tomber le démarrage', async () => {
    process.env['SMTP_HOST'] = 'smtp.exemple.com';
    process.env['SMTP_PORT'] = 'cinq-cent-quatre-vingt-sept';

    expect((await resoudreSmtp()).port).toBe(DEFAULT_SMTP_PORT);
  });

  it("déduit un expéditeur bien formé quand aucun n'est donné, plutôt que d'échouer", async () => {
    process.env['SMTP_HOST'] = 'smtp.gmail.com';

    expect((await resoudreSmtp()).from).toBe('Lalanda <no-reply@gmail.com>');
  });
});

// ─── Expéditeur, commun aux deux chemins ─────────────────────────────────────

describe('expéditeur affiché', () => {
  it('respecte SMTP_FROM — la variable DÉJÀ posée en production', async () => {
    // Non-régression qui vaut de l'argent : la retirer d'un coup ferait partir
    // les premiers emails ZeptoMail depuis une adresse déduite.
    process.env['ZEPTOMAIL_TOKEN'] = 'jeton-zepto-de-test';
    process.env['SMTP_FROM'] = 'Lalanda <bonjour@lalanda.co>';

    expect((await resoudreZepto()).from).toBe('Lalanda <bonjour@lalanda.co>');
  });

  it('laisse MAIL_FROM gagner sur SMTP_FROM — c’est le nom canonique depuis S22m', async () => {
    process.env['ZEPTOMAIL_TOKEN'] = 'jeton-zepto-de-test';
    process.env['SMTP_FROM'] = 'Ancien <ancien@lalanda.co>';
    process.env['MAIL_FROM'] = 'Lalanda <no-reply@lalanda.co>';

    expect((await resoudreZepto()).from).toBe('Lalanda <no-reply@lalanda.co>');
  });

  it('sert la MÊME adresse aux deux chemins', async () => {
    // Deux variables pour la même adresse finiraient par diverger, et
    // l'expéditeur affiché dépendrait du transport en vigueur — écart invisible
    // en développement, visible par les destinataires en production.
    process.env['MAIL_FROM'] = 'Lalanda <no-reply@lalanda.co>';

    process.env['SMTP_HOST'] = 'smtp.exemple.com';
    const parSmtp = await resoudreSmtp();

    process.env['ZEPTOMAIL_TOKEN'] = 'jeton-zepto-de-test';
    const parZepto = await resoudreZepto();

    expect(parZepto.from).toBe(parSmtp.from);
  });
});
