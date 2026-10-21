// Instantanés des listes de référence e-MCF : la valeur en vigueur est la
// dernière VUE, même quand elle revient à un contenu déjà conservé.
//
// Défaut corrigé le 20 oct. 2026 : un retour 5 % → 8 % → 5 % n'écrivait aucun
// nouveau document (contenu déjà connu) et `latest()` servait encore 8 %.

import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { EdefReferenceSnapshot } from '../edef/edef-reference-snapshot.schema.js';
import { EdefReferenceSnapshotsService } from '../edef/edef-reference-snapshots.service.js';
import { e2eSuite, makeE2EApp, teardown } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

const LIST = `taxGroups-test-${Math.random().toString(36).slice(2, 8)}`;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

e2eSuite('instantanés de référence DGI — valeur en vigueur', () => {
  let app: INestApplication;
  let model: Model<EdefReferenceSnapshot>;
  let service: EdefReferenceSnapshotsService;

  beforeAll(async () => {
    app = await makeE2EApp();
    model = app.get<Model<EdefReferenceSnapshot>>(getModelToken(EdefReferenceSnapshot.name));
    await model.createIndexes();
    service = app.get(EdefReferenceSnapshotsService);
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await model.deleteMany({ list: LIST });
    await teardown(app, []);
  }, E2E_HOOK_TIMEOUT_MS);

  it('un retour à une valeur déjà conservée redevient la valeur en vigueur', async () => {
    const cinq = { c: 5 };
    const huit = { c: 8 };

    expect((await service.record('test', LIST, cinq)).created).toBe(true);
    await pause(10);
    expect((await service.record('test', LIST, huit)).created).toBe(true);
    await pause(10);
    // Retour à 5 % : aucun nouveau document, mais il redevient le dernier vu.
    expect((await service.record('test', LIST, cinq)).created).toBe(false);

    expect((await service.latest('test', LIST))?.payload).toEqual(cinq);
    expect(await service.count('test', LIST)).toBe(2);
  });

  it('un relevé identique répété ne crée rien et reste en vigueur', async () => {
    const huit = { c: 8 };
    await service.record('test', LIST, huit);
    await pause(10);
    expect((await service.record('test', LIST, huit)).created).toBe(false);
    expect((await service.latest('test', LIST))?.payload).toEqual(huit);
  });
});
