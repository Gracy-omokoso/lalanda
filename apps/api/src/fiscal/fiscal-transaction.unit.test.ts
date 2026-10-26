// Réessai avec attente des transactions fiscales (voir l'en-tête de
// fiscal-transaction.ts).

import type { ClientSession, Connection } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';

import { inFiscalTransaction, transactionBackoffMs } from './fiscal-transaction.js';

describe('transactionBackoffMs', () => {
  it('croît de 5 ms par facteur 1,5 et plafonne à 500 ms (gigue maximale)', () => {
    const max = () => 1;
    expect(transactionBackoffMs(2, max)).toBe(5);
    expect(transactionBackoffMs(3, max)).toBe(7.5);
    expect(transactionBackoffMs(4, max)).toBeCloseTo(11.25);
    expect(transactionBackoffMs(30, max)).toBe(500);
  });

  it('tire la gigue dans [0, plafond)', () => {
    expect(transactionBackoffMs(10, () => 0)).toBe(0);
    const v = transactionBackoffMs(10);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(500);
  });
});

describe('inFiscalTransaction', () => {
  /** Session simulée : `withTransaction` rejoue le rappel `rejeux` fois, comme le driver. */
  function connexion(rejeux: number, instants: number[]) {
    const session = {
      withTransaction: async (cb: () => Promise<unknown>) => {
        for (let i = 0; i <= rejeux; i += 1) {
          instants.push(Date.now());
          await cb();
        }
      },
      endSession: vi.fn(async () => undefined),
    };
    return {
      connection: { startSession: async () => session } as unknown as Connection,
      session,
    };
  }

  it('première tentative sans attente ; chaque rejeu attend avant d’exécuter quoi que ce soit', async () => {
    vi.useFakeTimers();
    const hasard = vi.spyOn(Math, 'random').mockReturnValue(1);
    try {
      const instants: number[] = [];
      const appels: number[] = [];
      const { connection, session } = connexion(3, instants);
      const fn = vi.fn(async (_s: ClientSession) => {
        appels.push(Date.now());
        return 'ok';
      });
      const promesse = inFiscalTransaction(connection, fn);
      await vi.runAllTimersAsync();
      expect(await promesse).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(4);
      // Tentative 1 : exécutée tout de suite.
      expect(appels[0]).toBe(instants[0]);
      // Rejeux : `fn` n'est appelée qu'après l'attente (gigue maximale ici :
      // 5, 7,5 et 11,25 ms, que les minuteurs simulés tronquent à la milliseconde).
      expect(appels.map((t, i) => t - instants[i]!)).toEqual([0, 5, 7, 11]);
      expect(session.endSession).toHaveBeenCalledOnce();
    } finally {
      hasard.mockRestore();
      vi.useRealTimers();
    }
  });

  it('ferme la session même si la transaction échoue', async () => {
    const { connection, session } = connexion(0, []);
    await expect(
      inFiscalTransaction(connection, async () => {
        throw new Error('refus');
      }),
    ).rejects.toThrow('refus');
    expect(session.endSession).toHaveBeenCalledOnce();
  });
});
