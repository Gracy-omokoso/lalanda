// Attente des index hors production (voir `awaitAutoIndex`).

import { MongoNetworkError, MongoServerError } from 'mongodb';
import type { Connection } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IndexesService, isTransientMongoError } from './indexes.service.js';

function modele(nom: string, init: () => Promise<unknown>, createIndexes: () => Promise<unknown>) {
  return {
    collection: { collectionName: nom },
    init: vi.fn(init),
    createIndexes: vi.fn(createIndexes),
  };
}

function service(models: Record<string, ReturnType<typeof modele>>) {
  return new IndexesService({ models } as unknown as Connection);
}

describe('isTransientMongoError', () => {
  it('réseau et pool vidé : transitoires ; erreur serveur (doublon) : non', () => {
    expect(isTransientMongoError(new MongoNetworkError('connect ETIMEDOUT'))).toBe(true);
    expect(isTransientMongoError(new MongoServerError({ code: 11000, errmsg: 'E11000' }))).toBe(
      false,
    );
    expect(isTransientMongoError(new Error('autre'))).toBe(false);
  });
});

describe('IndexesService hors production', () => {
  const env = process.env['NODE_ENV'];
  afterEach(() => {
    process.env['NODE_ENV'] = env;
  });

  it('attend les index : le démarrage ne rend la main qu’après `init()`', async () => {
    process.env['NODE_ENV'] = 'test';
    let fini = false;
    const m = modele(
      'customers',
      () => new Promise((r) => setTimeout(() => r((fini = true)), 20)),
      async () => undefined,
    );
    await service({ Customer: m }).onApplicationBootstrap();
    expect(fini).toBe(true);
    expect(m.createIndexes).not.toHaveBeenCalled();
  });

  it('`init()` rejeté sur une coupure réseau → index recréés, avec réessai', async () => {
    process.env['NODE_ENV'] = 'test';
    let essais = 0;
    const m = modele(
      'customers',
      async () => {
        throw new MongoNetworkError('connect ETIMEDOUT 127.0.0.1:27017');
      },
      async () => {
        essais += 1;
        if (essais < 2) throw new MongoNetworkError('pool cleared');
      },
    );
    await service({ Customer: m }).onApplicationBootstrap();
    expect(m.createIndexes).toHaveBeenCalledTimes(2);
  });

  it('erreur non transitoire (doublons existants) : journalisée, aucun réessai', async () => {
    process.env['NODE_ENV'] = 'test';
    const m = modele(
      'customers',
      async () => {
        throw new MongoServerError({ code: 11000, errmsg: 'E11000 duplicate key' });
      },
      async () => undefined,
    );
    await service({ Customer: m }).onApplicationBootstrap();
    expect(m.createIndexes).not.toHaveBeenCalled();
  });
});
