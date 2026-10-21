// Création des index en production (S25a).
//
// Le défaut corrigé : `autoIndex` est coupé en production et rien ne créait les
// index à sa place — aucune collection de production n'en avait. Ce test vérifie
// que `IndexesService.ensureAll()` crée bien les index UNIQUES dont dépendent les
// garde-fous du code, y compris sur les collections de better-auth, et qu'il est
// rejouable sans erreur.

import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { IndexesService } from '../database/indexes.service.js';
import { e2eSuite, makeE2EApp, teardown } from './e2e-utils.js';

e2eSuite('index MongoDB de production (S25a)', () => {
  let app: INestApplication;
  let connection: Connection;

  beforeAll(async () => {
    app = await makeE2EApp();
    connection = app.get<Connection>(getConnectionToken());
  }, 60_000);

  afterAll(async () => {
    await teardown(app, []);
  }, 30_000);

  async function uniqueIndexKeys(collection: string): Promise<string[]> {
    const indexes = await connection.collection(collection).indexes();
    return indexes.filter((i) => i.unique).map((i) => Object.keys(i.key).join('+'));
  }

  it('crée les index de tous les modèles et des collections de better-auth, sans échec', async () => {
    const report = await app.get(IndexesService).ensureAll();
    expect(report.failed).toEqual([]);
    expect(report.ensured).toEqual(
      expect.arrayContaining(['scheduled_jobs', 'payment_events', 'user {"email":1}']),
    );
  });

  it('pose les index uniques dont dépendent les garde-fous', async () => {
    await app.get(IndexesService).ensureAll();
    expect(await uniqueIndexKeys('scheduled_jobs')).toContain('key');
    expect(await uniqueIndexKeys('payment_events')).toContain('provider+eventId');
    expect(await uniqueIndexKeys('financial_plans')).toContain('projectId+version');
    expect(await uniqueIndexKeys('user')).toContain('email');
    expect(await uniqueIndexKeys('session')).toContain('token');
  });

  it('est rejouable : un second passage ne produit aucun échec', async () => {
    const report = await app.get(IndexesService).ensureAll();
    expect(report.failed).toEqual([]);
  });
});
