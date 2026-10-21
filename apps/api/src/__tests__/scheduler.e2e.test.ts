// Ordonnanceur contre une vraie base (S25a, ADR-0020).
//
// Ce qu'aucun test unitaire ne peut voir : l'atomicité de la réclamation
// (`findOneAndUpdate`) face à deux instances, la reprise d'une tâche abandonnée
// par un processus mort, et l'index unique qui rend `schedule()` rejouable. Les
// instances sont construites ici, sur le modèle de l'application, et l'heure est
// passée explicitement à `tick()` : aucun minuteur, aucune attente réelle.

import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { ScheduledJob } from '../scheduler/scheduled-job.schema.js';
import { LEASE_MS, POLL_MS, SchedulerService } from '../scheduler/scheduler.service.js';
import { e2eSuite, makeE2EApp, teardown } from './e2e-utils.js';

const tag = Math.random().toString(36).slice(2, 8);
const T0 = new Date('2030-01-01T10:00:00Z');
const at = (ms: number): Date => new Date(T0.getTime() + ms);

e2eSuite('ordonnanceur (S25a)', () => {
  let app: INestApplication;
  let model: Model<ScheduledJob>;

  beforeAll(async () => {
    app = await makeE2EApp();
    model = app.get<Model<ScheduledJob>>(getModelToken(ScheduledJob.name));
    // L'index unique sur `key` doit exister pour ces tests comme en production.
    await model.createIndexes();
  }, 60_000);

  afterAll(async () => {
    await model.deleteMany({ key: { $regex: `^t-${tag}-` } });
    await teardown(app, []);
  }, 30_000);

  /** Une instance d'ordonnanceur neuve, comme un second processus d'API. */
  const instance = (): SchedulerService => new SchedulerService(model);
  const name = (n: string): string => `t-${tag}-${n}`;

  it('enregistre la tâche billing.sweep au démarrage de l’application', async () => {
    const job = await model.findOne({ key: 'billing.sweep' }).lean();
    expect(job).toMatchObject({ name: 'billing.sweep', everyMs: 60 * 60_000 });
  });

  it('ne crée qu’une tâche pour une même clé, même planifiée deux fois', async () => {
    const s = instance();
    s.register(name('unique'), async () => undefined);
    const first = await s.schedule({ name: name('unique'), runAt: T0 });
    const second = await s.schedule({ name: name('unique'), runAt: at(999_999) });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(await model.countDocuments({ key: name('unique') })).toBe(1);
    // La seconde planification n'a pas déplacé l'échéance.
    expect((await model.findOne({ key: name('unique') }).lean())!.runAt).toEqual(T0);
  });

  it('n’exécute pas une tâche avant son heure, puis l’exécute une fois', async () => {
    const s = instance();
    let calls = 0;
    s.register(name('heure'), async () => {
      calls += 1;
    });
    await s.schedule({ name: name('heure'), runAt: at(60_000) });

    expect(await s.tick(at(59_000))).toBe(0);
    expect(calls).toBe(0);
    expect(await s.tick(at(60_000))).toBe(1);
    expect(await s.tick(at(120_000))).toBe(0);
    expect(calls).toBe(1);
    expect((await model.findOne({ key: name('heure') }).lean())!.status).toBe('done');
  });

  it('deux instances concurrentes n’exécutent la tâche qu’une seule fois', async () => {
    let calls = 0;
    const handler = async (): Promise<void> => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 50));
    };
    const a = instance();
    const b = instance();
    a.register(name('concurrence'), handler);
    b.register(name('concurrence'), handler);
    await a.schedule({ name: name('concurrence'), runAt: T0 });

    const [na, nb] = await Promise.all([a.tick(at(1_000)), b.tick(at(1_000))]);
    expect(na + nb).toBe(1);
    expect(calls).toBe(1);
  });

  it('reprend une tâche abandonnée par un processus mort, après son bail', async () => {
    const s = instance();
    let calls = 0;
    s.register(name('reprise'), async () => {
      calls += 1;
    });
    await s.schedule({ name: name('reprise'), runAt: T0 });
    // Simule un processus qui a réclamé la tâche puis s'est arrêté net.
    await model.updateOne(
      { key: name('reprise') },
      {
        $set: { status: 'running', lockedBy: 'processus-mort', lockedUntil: at(LEASE_MS) },
        $inc: { attempts: 1 },
      },
    );

    expect(await s.tick(at(LEASE_MS - 1_000))).toBe(0); // bail encore valide
    expect(await s.tick(at(LEASE_MS))).toBe(1);
    expect(calls).toBe(1);
    const job = (await model.findOne({ key: name('reprise') }).lean())!;
    expect(job).toMatchObject({ status: 'done', attempts: 2, lockedBy: null });
  });

  it('replanifie un échec avec un délai croissant, puis l’abandonne', async () => {
    const s = instance();
    s.register(name('echec'), async () => {
      throw new Error('fournisseur indisponible');
    });
    await s.schedule({ name: name('echec'), runAt: T0, maxAttempts: 2 });

    await s.tick(at(0));
    let job = (await model.findOne({ key: name('echec') }).lean())!;
    expect(job).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'fournisseur indisponible',
    });
    expect(job.runAt).toEqual(at(30_000));

    expect(await s.tick(at(29_000))).toBe(0); // pas avant le délai
    await s.tick(at(30_000));
    job = (await model.findOne({ key: name('echec') }).lean())!;
    expect(job).toMatchObject({ status: 'failed', attempts: 2 });
  });

  it('une tâche récurrente se replanifie, et n’est inscrite qu’une fois', async () => {
    const s = instance();
    let calls = 0;
    s.every(name('recurrente'), 10 * POLL_MS, async () => {
      calls += 1;
    });
    await s.ensureRecurring(T0);
    await s.ensureRecurring(T0); // redémarrage
    expect(await model.countDocuments({ key: name('recurrente') })).toBe(1);

    await s.tick(at(0));
    const job = (await model.findOne({ key: name('recurrente') }).lean())!;
    expect(job).toMatchObject({ status: 'pending', attempts: 0 });
    expect(job.runAt).toEqual(at(10 * POLL_MS));
    await s.tick(at(10 * POLL_MS));
    expect(calls).toBe(2);
  });

  it('une tâche récurrente en échec répété ne s’éteint pas', async () => {
    const s = instance();
    s.every(name('recurrente-echec'), 10 * POLL_MS, async () => {
      throw new Error('panne');
    });
    await s.ensureRecurring(T0);
    await model.updateOne({ key: name('recurrente-echec') }, { $set: { maxAttempts: 1 } });

    await s.tick(at(0));
    const job = (await model.findOne({ key: name('recurrente-echec') }).lean())!;
    expect(job).toMatchObject({ status: 'pending', attempts: 0, lastError: 'panne' });
    expect(job.runAt).toEqual(at(10 * POLL_MS));
  });

  it('ne touche pas aux tâches dont cette instance n’a pas le gestionnaire', async () => {
    const connue = instance();
    connue.register(name('orpheline'), async () => undefined);
    await connue.schedule({ name: name('orpheline'), runAt: T0 });

    const autre = instance();
    autre.register(name('autre-chose'), async () => undefined);
    expect(await autre.tick(at(1_000))).toBe(0);
    expect((await model.findOne({ key: name('orpheline') }).lean())!.status).toBe('pending');
  });

  it('refuse de planifier une tâche sans gestionnaire', async () => {
    await expect(instance().schedule({ name: name('inconnue'), runAt: T0 })).rejects.toThrow(
      /Aucun gestionnaire/,
    );
  });

  it('annule une tâche en attente, pas une tâche terminée', async () => {
    const s = instance();
    s.register(name('annulable'), async () => undefined);
    await s.schedule({ name: name('annulable'), key: name('annulable-1'), runAt: at(60_000) });
    expect((await s.cancel(name('annulable-1'))).cancelled).toBe(true);
    expect(await model.countDocuments({ key: name('annulable-1') })).toBe(0);

    await s.schedule({ name: name('annulable'), key: name('annulable-2'), runAt: T0 });
    await s.tick(at(1_000));
    expect((await s.cancel(name('annulable-2'))).cancelled).toBe(false);
  });
});
