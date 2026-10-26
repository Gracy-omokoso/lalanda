// Coffre de portée organisation contre une vraie base (ADR-0021 §4.2, §13 « A0 et A »).
//
// Ce qu'aucun test unitaire ne peut voir : la liaison cryptographique au DOCUMENT
// tel qu'il est stocké (réécrire `organizationId` en base, recopier un chiffré vers
// une autre organisation), l'écriture dans une transaction annulée, et la rotation
// `secrets:rewrap` sur la collection réelle.
//
// BASE DÉDIÉE. La rotation parcourt TOUS les documents des deux collections : sur la
// base de développement partagée, elle tenterait de re-chiffrer des secrets réels
// avec un trousseau de test. La suite ouvre donc sa propre base, et la supprime.
//
// AUCUN VRAI JETON. Les valeurs sont des littéraux inventés et les clés maîtresses
// sont tirées au hasard à l'exécution.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Integration, type IntegrationDocument } from '../integrations/integration.schema.js';
import {
  OrganizationSecret,
  type OrganizationSecretDocument,
} from '../integrations/organization-secret.schema.js';
import {
  ORGANIZATION_SECRETS,
  VaultUnavailableError,
  type OrganizationSecretRef,
  type OrganizationSecretsPort,
} from '../integrations/organization-secrets.port.js';
import { OrganizationSecretsService } from '../integrations/organization-secrets.service.js';
import { PlatformAuditService } from '../integrations/platform-audit.service.js';
import { RewrapService } from '../integrations/rewrap.js';
import { SecretDecryptionError, MasterKeyring } from '../integrations/secrets-crypto.js';
import { SecretsService } from '../integrations/secrets.service.js';
import { dbOf, e2eSuite, makeE2EApp } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

const tag = Math.random().toString(36).slice(2, 8);
process.env['MONGODB_DB'] = `lalanda_e2e_orgsecrets_${tag}`;

const JETON = 'ANTIFUITE-emcf-jeton-7c41d9e2b0a5f368';
const JETON_2 = 'ANTIFUITE-emcf-jeton-remplace-19be04c7d2';
const CHAMPS_INTERDITS = ['ciphertext', 'iv', 'salt', 'authTag', 'keyId'] as const;

const k1 = { keyId: 'k1', key: randomBytes(32) };
const k2 = { keyId: 'k2', key: randomBytes(32) };
const trousseauK1 = MasterKeyring.of([k1], 'k1');
const trousseauRotation = MasterKeyring.of([k2, k1], 'k2');
const trousseauK2Seul = MasterKeyring.of([k2], 'k2');

const ref = (organizationId: string, ownerId = 'pos-1'): OrganizationSecretRef => ({
  organizationId,
  kind: 'dgi_emcf_token',
  ownerId,
});
const org = (n: string): string => `org-${tag}-${n}`;

e2eSuite('coffre de portée organisation (ADR-0021 §4.2)', () => {
  let app: INestApplication;
  let model: Model<OrganizationSecretDocument>;
  let connection: Connection;

  const coffre = (keyring: MasterKeyring | null): OrganizationSecretsService =>
    new OrganizationSecretsService(model, keyring);

  beforeAll(async () => {
    app = await makeE2EApp();
    model = app.get<Model<OrganizationSecretDocument>>(getModelToken(OrganizationSecret.name));
    connection = app.get<Connection>(getConnectionToken());
    await model.createIndexes();
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
    }
  }, E2E_HOOK_TIMEOUT_MS);

  it('l’application fournit le coffre réel sous ORGANIZATION_SECRETS', () => {
    const fourni = app.get<OrganizationSecretsPort>(ORGANIZATION_SECRETS);
    expect(fourni).toBeInstanceOf(OrganizationSecretsService);
  });

  describe('aller-retour et description', () => {
    it('put puis resolve rend la valeur ; describe ne la rend jamais', async () => {
      const c = coffre(trousseauK1);
      const desc = await c.put(ref(org('a')), JETON, 'user-1');
      expect(desc).toMatchObject({ configured: true, last4: JETON.slice(-4), updatedBy: 'user-1' });
      expect(desc.updatedAt).toBeInstanceOf(Date);

      const secret = await c.resolve(ref(org('a')));
      expect(secret?.expose()).toBe(JETON);
      expect(String(secret)).toBe('[redacted]');

      const decrit = await c.describe(ref(org('a')));
      expect(decrit).toEqual(desc);
      expect(JSON.stringify(decrit)).not.toContain(JETON);
    });

    it('le document en base porte un chiffré, pas la valeur', async () => {
      const brut = await connection
        .collection('organization_secrets')
        .findOne({ organizationId: org('a') });
      expect(brut?.['value']?.ciphertext).toBeTypeOf('string');
      expect(JSON.stringify(brut)).not.toContain(JETON);
      expect(brut?.['kind']).toBe('dgi_emcf_token');
      expect(brut?.['_schemaVersion']).toBe(1);
    });

    it('remplacer garde le même document et change le chiffré', async () => {
      const c = coffre(trousseauK1);
      await c.put(ref(org('remplace')), JETON, 'user-1');
      const avant = await model.findOne({ organizationId: org('remplace') }).exec();
      const desc = await c.put(ref(org('remplace')), JETON_2, 'user-2');
      const apres = await model.findOne({ organizationId: org('remplace') }).exec();

      expect(await model.countDocuments({ organizationId: org('remplace') })).toBe(1);
      expect(String(apres!._id)).toBe(String(avant!._id));
      expect(apres!.value.iv).not.toBe(avant!.value.iv);
      expect(desc).toMatchObject({ last4: JETON_2.slice(-4), updatedBy: 'user-2' });
      expect((await c.resolve(ref(org('remplace'))))?.expose()).toBe(JETON_2);
    });

    it('deux écritures simultanées produisent un seul document, déchiffrable', async () => {
      const c = coffre(trousseauK1);
      await Promise.all([
        c.put(ref(org('course')), JETON, 'user-1'),
        c.put(ref(org('course')), JETON_2, 'user-2'),
      ]);
      expect(await model.countDocuments({ organizationId: org('course') })).toBe(1);
      expect([JETON, JETON_2]).toContain((await c.resolve(ref(org('course'))))?.expose());
    });

    it('un secret absent : resolve → null, describe → non configuré', async () => {
      const c = coffre(trousseauK1);
      expect(await c.resolve(ref(org('vide')))).toBeNull();
      expect(await c.describe(ref(org('vide')))).toEqual({
        configured: false,
        last4: null,
        updatedAt: null,
        updatedBy: null,
      });
    });

    it('last4 vaut null sous 12 caractères (ADR-0013 §4)', async () => {
      const desc = await coffre(trousseauK1).put(ref(org('court')), 'abcdefghijk', 'user-1');
      expect(desc.last4).toBeNull();
    });

    it('describeMany décrit chaque propriétaire demandé, et seulement de cette organisation', async () => {
      const c = coffre(trousseauK1);
      await c.put(ref(org('many'), 'pos-a'), JETON, 'user-1');
      await c.put(ref(org('many'), 'pos-b'), JETON_2, 'user-1');
      await c.put(ref(org('autre-many'), 'pos-c'), JETON, 'user-1');

      const vues = await c.describeMany(org('many'), 'dgi_emcf_token', ['pos-a', 'pos-b', 'pos-c']);
      expect(vues.get('pos-a')).toMatchObject({ configured: true, last4: JETON.slice(-4) });
      expect(vues.get('pos-b')).toMatchObject({ configured: true, last4: JETON_2.slice(-4) });
      // `pos-c` appartient à une AUTRE organisation : il n'est pas vu d'ici.
      expect(vues.get('pos-c')).toMatchObject({ configured: false });
      expect((await c.describeMany(org('many'), 'dgi_emcf_token', [])).size).toBe(0);
    });

    it('destroy retire le chiffré, et une révocation vaut immédiatement (pas de cache)', async () => {
      const c = coffre(trousseauK1);
      await c.put(ref(org('destroy')), JETON, 'user-1');
      expect(await c.resolve(ref(org('destroy')))).not.toBeNull();
      await c.destroy(ref(org('destroy')));
      expect(await c.resolve(ref(org('destroy')))).toBeNull();
      expect(
        await connection.collection('organization_secrets').countDocuments({
          organizationId: org('destroy'),
        }),
      ).toBe(0);
      // Sans effet s'il n'existe pas.
      await expect(c.destroy(ref(org('destroy')))).resolves.toBeUndefined();
    });

    it('refuse une adresse invalide (erreur de programmation de l’appelant)', async () => {
      const c = coffre(trousseauK1);
      await expect(c.put(ref('', 'pos'), JETON, 'u')).rejects.toThrow();
      await expect(c.put(ref('a:b', 'pos'), JETON, 'u')).rejects.toThrow();
      await expect(
        c.put({ organizationId: 'o', kind: 'smtp' as never, ownerId: 'p' }, JETON, 'u'),
      ).rejects.toThrow();
      await expect(c.put(ref(org('x')), '', 'u')).rejects.toThrow();
    });
  });

  describe('isolation cryptographique entre organisations', () => {
    it('un document recopié vers une autre organisation ne se déchiffre pas', async () => {
      const c = coffre(trousseauK1);
      await c.put(ref(org('source')), JETON, 'user-1');
      const brut = await connection
        .collection('organization_secrets')
        .findOne({ organizationId: org('source') });
      await connection.collection('organization_secrets').insertOne({
        ...brut,
        _id: new Types.ObjectId(),
        organizationId: org('copie'),
      });
      await expect(c.resolve(ref(org('copie')))).rejects.toBeInstanceOf(SecretDecryptionError);
      // L'original, lui, reste lisible.
      expect((await c.resolve(ref(org('source'))))?.expose()).toBe(JETON);
    });

    it('réécrire organizationId en base (même document) rend le chiffré indéchiffrable', async () => {
      const c = coffre(trousseauK1);
      await c.put(ref(org('reecrit')), JETON, 'user-1');
      await connection
        .collection('organization_secrets')
        .updateOne({ organizationId: org('reecrit') }, { $set: { organizationId: org('pirate') } });
      await expect(c.resolve(ref(org('pirate')))).rejects.toBeInstanceOf(SecretDecryptionError);
    });

    it('réécrire ownerId en base rend le chiffré indéchiffrable', async () => {
      const c = coffre(trousseauK1);
      await c.put(ref(org('owner'), 'pos-1'), JETON, 'user-1');
      await connection
        .collection('organization_secrets')
        .updateOne({ organizationId: org('owner') }, { $set: { ownerId: 'pos-2' } });
      await expect(c.resolve(ref(org('owner'), 'pos-2'))).rejects.toBeInstanceOf(
        SecretDecryptionError,
      );
    });

    it('recopier le chiffré dans un autre document de la même organisation échoue', async () => {
      const c = coffre(trousseauK1);
      await c.put(ref(org('doc'), 'pos-1'), JETON, 'user-1');
      await c.put(ref(org('doc'), 'pos-2'), JETON_2, 'user-1');
      const source = await connection
        .collection('organization_secrets')
        .findOne({ organizationId: org('doc'), ownerId: 'pos-1' });
      await connection
        .collection('organization_secrets')
        .updateOne(
          { organizationId: org('doc'), ownerId: 'pos-2' },
          { $set: { value: source?.['value'] } },
        );
      await expect(c.resolve(ref(org('doc'), 'pos-2'))).rejects.toBeInstanceOf(
        SecretDecryptionError,
      );
    });
  });

  describe('coffre absent', () => {
    it('sans clé maîtresse : VaultUnavailableError, et aucune variable d’environnement lue', async () => {
      const c = coffre(null);
      const lues: string[] = [];
      const original = process.env;
      process.env = new Proxy(original, {
        get(cible, cle) {
          if (typeof cle === 'string') lues.push(cle);
          return Reflect.get(cible, cle);
        },
      });
      try {
        await expect(c.put(ref(org('sans')), JETON, 'u')).rejects.toBeInstanceOf(
          VaultUnavailableError,
        );
        await expect(c.resolve(ref(org('a')))).rejects.toBeInstanceOf(VaultUnavailableError);
      } finally {
        process.env = original;
      }
      expect(lues).toEqual([]);
      expect(await model.countDocuments({ organizationId: org('sans') })).toBe(0);
    });

    it('le code est VAULT_UNAVAILABLE (traduit en 503 par les contrôleurs)', async () => {
      const err = await coffre(null)
        .resolve(ref(org('a')))
        .catch((e: unknown) => e);
      expect((err as VaultUnavailableError).code).toBe('VAULT_UNAVAILABLE');
    });
  });

  describe('barrières de sérialisation du document', () => {
    it('JSON.stringify, String() et util.inspect ne contiennent ni valeur ni matériel chiffré', async () => {
      await coffre(trousseauK1).put(ref(org('serial')), JETON, 'user-1');
      const doc = await model.findOne({ organizationId: org('serial') }).exec();
      expect(doc?.value.ciphertext).toBeTypeOf('string'); // contre-épreuve

      for (const [forme, texte] of [
        ['JSON.stringify', JSON.stringify(doc)],
        ['String', String(doc)],
        ['util.inspect', inspect(doc, { depth: 12 })],
        ['toObject', inspect(doc!.toObject(), { depth: 12 })],
      ] as const) {
        expect(texte, forme).not.toContain(JETON);
        expect(texte, forme).not.toContain(doc!.value.ciphertext);
        for (const champ of CHAMPS_INTERDITS) {
          expect(
            new RegExp(`["']?\\b${champ}\\b["']?\\s*:`).test(texte),
            `${forme} : ${champ}`,
          ).toBe(false);
        }
      }
    });
  });

  describe('transaction de l’appelant', () => {
    it('une transaction annulée n’écrit aucun secret', async () => {
      const c = coffre(trousseauK1);
      const session = await connection.startSession();
      try {
        await expect(
          session.withTransaction(async () => {
            await c.put(ref(org('tx')), JETON, 'user-1', { session });
            throw new Error('échec simulé de l’écriture d’audit');
          }),
        ).rejects.toThrow('échec simulé');
      } finally {
        await session.endSession();
      }
      expect(await model.countDocuments({ organizationId: org('tx') })).toBe(0);
    });

    it('une transaction validée écrit le secret, et destroy en transaction le retire', async () => {
      const c = coffre(trousseauK1);
      const session = await connection.startSession();
      try {
        await session.withTransaction(async () => {
          await c.put(ref(org('tx-ok')), JETON, 'user-1', { session });
        });
        expect((await c.resolve(ref(org('tx-ok'))))?.expose()).toBe(JETON);
        await session.withTransaction(async () => {
          await c.destroy(ref(org('tx-ok')), { session });
        });
      } finally {
        await session.endSession();
      }
      expect(await c.resolve(ref(org('tx-ok')))).toBeNull();
    });
  });

  describe('rotation secrets:rewrap (k1 → k2)', () => {
    const rewrap = (keyring: MasterKeyring): RewrapService =>
      new RewrapService(
        app.get<Model<IntegrationDocument>>(getModelToken(Integration.name)),
        model,
        connection,
        keyring,
        app.get(PlatformAuditService),
        app.get(SecretsService),
      );

    it('re-chiffre organization_secrets, est rejouable sans effet, et l’ancienne clé peut partir', async () => {
      // Base dédiée vidée de ce que les tests précédents ont volontairement corrompu.
      await model.deleteMany({});
      const c1 = coffre(trousseauK1);
      await c1.put(ref(org('rot'), 'pos-1'), JETON, 'user-1');
      await c1.put(ref(org('rot'), 'pos-2'), JETON_2, 'user-1');
      const avant = await model.findOne({ organizationId: org('rot'), ownerId: 'pos-1' }).exec();

      const premier = await rewrap(trousseauRotation).run('operateur-1');
      expect(premier).toEqual({ rewrapped: 2, skipped: 0, remainingKeyIds: [] });

      const apres = await model.findOne({ organizationId: org('rot'), ownerId: 'pos-1' }).exec();
      expect(apres!.value.keyId).toBe('k2');
      expect(apres!.value.iv).not.toBe(avant!.value.iv);
      // La rotation n'est pas une modification métier.
      expect(apres!.value.updatedAt.getTime()).toBe(avant!.value.updatedAt.getTime());
      expect(apres!.value.updatedBy).toBe('user-1');

      // Rejouable sans effet.
      const second = await rewrap(trousseauRotation).run('operateur-1');
      expect(second).toEqual({ rewrapped: 0, skipped: 2, remainingKeyIds: [] });

      // `_PREVIOUS` retirée : tout se lit avec la seule nouvelle clé.
      const c2 = coffre(trousseauK2Seul);
      expect((await c2.resolve(ref(org('rot'), 'pos-1')))?.expose()).toBe(JETON);
      expect((await c2.resolve(ref(org('rot'), 'pos-2')))?.expose()).toBe(JETON_2);

      // Un `secret.rewrapped` par enregistrement, sans valeur ni organisation.
      const traces = await connection
        .collection('audit_events')
        .find({ action: 'secret.rewrapped', targetType: 'organization_secret' })
        .toArray();
      expect(traces).toHaveLength(2);
      for (const t of traces) {
        expect(t['metadata']).toEqual({ kind: 'dgi_emcf_token', keyId: 'k2' });
        expect(JSON.stringify(t)).not.toContain(JETON);
        expect(JSON.stringify(t)).not.toContain(org('rot'));
      }
    });

    it('un chiffré d’organisation sous une clé absente du trousseau fait échouer la rotation', async () => {
      await model.deleteMany({});
      const k0 = MasterKeyring.of([{ keyId: 'k0', key: randomBytes(32) }], 'k0');
      await coffre(k0).put(ref(org('orphelin')), JETON, 'user-1');
      // k0 n'est pas au trousseau de rotation : la migration lève (panne bruyante),
      // elle ne passe pas en silence.
      await expect(rewrap(trousseauRotation).run()).rejects.toThrow();
    });
  });
});
