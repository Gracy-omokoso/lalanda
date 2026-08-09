// Tests de non-régression du portillon de rendu PDF (S22e).
//
// Le test qui compte est le premier : AVANT ce correctif, 40 exports concurrents
// ouvraient 40 pages Chromium simultanées (mesuré : 149 processus, 5,7 Go de
// RSS). L'assertion porte donc sur le PIC de concurrence, pas sur le résultat —
// un portillon qui rendrait les bonnes valeurs en laissant passer tout le monde
// serait vert sur n'importe quel autre test.

import { describe, expect, it } from 'vitest';

import { RenderGate, RenderGateBusyError, readLimits } from './render-gate.js';

/** Promesse dont on déclenche la résolution à la main. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('RenderGate', () => {
  it('borne la concurrence : 40 rendus simultanés ne dépassent jamais maxConcurrent', async () => {
    const gate = new RenderGate({ maxConcurrent: 2, maxQueued: 100, queueTimeoutMs: 5_000 });
    let inFlight = 0;
    let peak = 0;

    const runs = Array.from({ length: 40 }, () =>
      gate.run(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
      }),
    );

    await Promise.all(runs);

    expect(peak).toBe(2);
    expect(gate.stats()).toEqual({ active: 0, queued: 0 });
  });

  it('refuse immédiatement quand la file est pleine, sans attendre le délai', async () => {
    const gate = new RenderGate({ maxConcurrent: 1, maxQueued: 1, queueTimeoutMs: 60_000 });
    const held = deferred();

    const running = gate.run(() => held.promise); // occupe le seul jeton
    const queued = gate.run(async () => {}); // occupe la seule place en file

    // La troisième n'a ni jeton ni place : elle doit être rejetée tout de suite.
    const started = Date.now();
    await expect(gate.run(async () => {})).rejects.toBeInstanceOf(RenderGateBusyError);
    expect(Date.now() - started).toBeLessThan(1_000);

    held.resolve();
    await Promise.all([running, queued]);
  });

  it('expose la raison et le Retry-After du refus', async () => {
    const gate = new RenderGate({ maxConcurrent: 1, maxQueued: 0, queueTimeoutMs: 9_000 });
    const held = deferred();
    const running = gate.run(() => held.promise);

    const err = await gate.run(async () => {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderGateBusyError);
    expect((err as RenderGateBusyError).reason).toBe('queue_full');
    expect((err as RenderGateBusyError).retryAfterSec).toBe(9);

    held.resolve();
    await running;
  });

  it('abandonne une attente trop longue plutôt que de rendre pour un client parti', async () => {
    const gate = new RenderGate({ maxConcurrent: 1, maxQueued: 4, queueTimeoutMs: 20 });
    const held = deferred();
    const running = gate.run(() => held.promise);

    const err = await gate.run(async () => {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderGateBusyError);
    expect((err as RenderGateBusyError).reason).toBe('queue_timeout');
    // La place en file est rendue : le portillon ne fuit pas.
    expect(gate.stats().queued).toBe(0);

    held.resolve();
    await running;
  });

  it('libère le jeton même si le rendu lève — sinon le service se fige à zéro', async () => {
    const gate = new RenderGate({ maxConcurrent: 1, maxQueued: 1, queueTimeoutMs: 1_000 });

    await expect(
      gate.run(async () => {
        throw new Error('Chromium a explosé');
      }),
    ).rejects.toThrow('Chromium a explosé');

    expect(gate.stats()).toEqual({ active: 0, queued: 0 });
    await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('sérialise réellement : la seconde ne démarre pas avant la fin de la première', async () => {
    const gate = new RenderGate({ maxConcurrent: 1, maxQueued: 2, queueTimeoutMs: 1_000 });
    const order: string[] = [];
    const first = deferred();

    const a = gate.run(async () => {
      order.push('a:start');
      await first.promise;
      order.push('a:end');
    });
    const b = gate.run(async () => {
      order.push('b:start');
    });

    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(['a:start']);

    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
  });
});

describe('readLimits', () => {
  it('retombe sur les valeurs sûres quand la variable est absente ou illisible', () => {
    expect(readLimits({})).toEqual({ maxConcurrent: 2, maxQueued: 8, queueTimeoutMs: 20_000 });
    // Une valeur hostile ne doit ni lever ni désactiver la borne.
    expect(
      readLimits({
        REPORTS_PDF_MAX_CONCURRENCY: '0',
        REPORTS_PDF_MAX_QUEUE: '-1',
        REPORTS_PDF_QUEUE_TIMEOUT_MS: 'beaucoup',
      }).maxConcurrent,
    ).toBe(2);
  });

  it('honore une surcharge valide', () => {
    expect(readLimits({ REPORTS_PDF_MAX_CONCURRENCY: '4' }).maxConcurrent).toBe(4);
  });
});
