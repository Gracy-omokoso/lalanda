// L'interrupteur `enabled` d'une intégration (S22l).
//
// ── Ce qui était cassé ────────────────────────────────────────────────────────
//
// `/admin` affiche « Configurée, inactive — les secrets sont en place mais
// l'intégration n'est pas activée », et le journal d'audit enregistre
// `integration.disabled`. Tout indiquait donc une intégration coupée. Or
// `resolveUncached` ne regardait jamais `enabled` : la clé était déchiffrée et
// servie comme si de rien n'était. Mesuré sur l'installation de développement —
// l'intégration `openai` était à `enabled: false` et `POST /ai/corrective-actions`
// répondait `source: "llm"`, c'est-à-dire un vrai appel facturé.
//
// Un interrupteur qui n'interrompt rien est pire que pas d'interrupteur : il
// fait croire que les appels ont cessé.
//
// ── Les deux règles que ces tests verrouillent ────────────────────────────────
//
// 1. **Désactivé ⇒ rien**, et surtout pas de repli sur l'environnement. ADR-0013
//    §C rejette l'hybride permanent parce qu'« une variable d'environnement
//    oubliée masque silencieusement une clé pourtant rotée en base ». Retomber
//    sur `env` après une désactivation produirait ce défaut exact : l'opérateur
//    coupe, les appels continuent depuis une variable qu'il ne regarde plus.
// 2. **Absence d'enregistrement ≠ désactivation.** Sans document, on est en
//    amorçage : le secours par l'environnement doit continuer de jouer, sinon
//    toute installation neuve perd `OPENAI_API_KEY` et `S3_SECRET_KEY`.

import { randomBytes } from 'node:crypto';
import type { Model } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IntegrationDocument } from './integration.schema.js';
import { MasterKeyring, encryptSecret } from './secrets-crypto.js';
import { SecretsService } from './secrets.service.js';

const keyring = MasterKeyring.of([{ keyId: 'k-test', key: randomBytes(32) }], 'k-test');

/** Document d'intégration minimal, avec un secret réellement chiffré. */
function docOpenai(enabled: boolean): IntegrationDocument {
  return {
    _id: 'doc-1',
    provider: 'openai',
    scope: 'platform',
    enabled,
    secrets: {
      apiKey: encryptSecret({
        location: { documentId: 'doc-1', provider: 'openai', secretName: 'apiKey' },
        value: 'sk-valeur-en-base',
        keyring,
        updatedBy: 'test',
      }),
    },
  } as unknown as IntegrationDocument;
}

/** Modèle Mongoose réduit à ce que `resolveUncached` utilise. */
function modelRendant(doc: IntegrationDocument | null): Model<IntegrationDocument> {
  return {
    findOne: () => ({ exec: async () => doc }),
  } as unknown as Model<IntegrationDocument>;
}

const ENV_INITIAL = process.env['OPENAI_API_KEY'];

beforeEach(() => {
  // Une variable d'environnement renseignée est le cœur du piège : si le repli
  // jouait malgré la désactivation, ces tests passeraient au vert sans elle.
  process.env['OPENAI_API_KEY'] = 'sk-valeur-environnement';
});

afterEach(() => {
  if (ENV_INITIAL === undefined) delete process.env['OPENAI_API_KEY'];
  else process.env['OPENAI_API_KEY'] = ENV_INITIAL;
});

describe('intégration désactivée', () => {
  it('ne rend aucun secret, alors que la clé est bien en base', async () => {
    const secrets = new SecretsService(modelRendant(docOpenai(false)), keyring);

    expect(await secrets.resolve('openai', 'apiKey')).toBeNull();
  });

  it('ne retombe PAS sur la variable d’environnement', async () => {
    // C'est l'assertion qui compte. Sans elle, une implémentation qui se
    // contenterait d'ignorer le document désactivé passerait le test précédent
    // tout en continuant d'appeler OpenAI depuis `OPENAI_API_KEY`.
    const secrets = new SecretsService(modelRendant(docOpenai(false)), keyring);
    const resolu = await secrets.resolve('openai', 'apiKey');

    expect(resolu).toBeNull();
    expect(process.env['OPENAI_API_KEY']).toBe('sk-valeur-environnement');
  });

  it('vaut aussi SANS coffre, où le document n’était même pas lu', async () => {
    // `SECRETS_MASTER_KEY` absente ⇒ `keyring` vaut null. L'ancienne
    // implémentation ne lisait alors pas le document du tout, donc la
    // désactivation était ignorée et l'environnement prenait la main — le cas
    // où l'interrupteur ment le plus gravement, puisque personne ne relie une
    // clé maîtresse manquante à une intégration qu'on croyait coupée.
    const secrets = new SecretsService(modelRendant(docOpenai(false)), null);

    expect(await secrets.resolve('openai', 'apiKey')).toBeNull();
  });
});

describe('intégration activée', () => {
  it('rend la clé de la base, et signale la source', async () => {
    const secrets = new SecretsService(modelRendant(docOpenai(true)), keyring);
    const resolu = await secrets.resolve('openai', 'apiKey');

    expect(resolu?.source).toBe('db');
    expect(resolu?.secret.expose()).toBe('sk-valeur-en-base');
  });
});

describe('aucun enregistrement — amorçage', () => {
  it('laisse le secours par l’environnement jouer', async () => {
    // Sans document, rien n'a été décidé : c'est une installation neuve, pas
    // une coupure. Interdire le secours ici casserait tout démarrage à froid.
    const secrets = new SecretsService(modelRendant(null), keyring);
    const resolu = await secrets.resolve('openai', 'apiKey');

    expect(resolu?.source).toBe('env');
    expect(resolu?.secret.expose()).toBe('sk-valeur-environnement');
  });

  it('rend null quand ni document ni variable ne fournissent la valeur', async () => {
    delete process.env['OPENAI_API_KEY'];
    const secrets = new SecretsService(modelRendant(null), keyring);

    expect(await secrets.resolve('openai', 'apiKey')).toBeNull();
  });
});
