import { describe, expect, it } from 'vitest';

import { backoffMs } from './scheduler.service.js';

describe('backoffMs — délai avant la tentative suivante', () => {
  it('double à chaque tentative, à partir de 30 s', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
  });

  it('plafonne à une heure, même après de très nombreux échecs', () => {
    expect(backoffMs(8)).toBe(60 * 60_000);
    expect(backoffMs(50)).toBe(60 * 60_000);
  });

  it('traite une tentative nulle ou négative comme la première', () => {
    expect(backoffMs(0)).toBe(30_000);
    expect(backoffMs(-3)).toBe(30_000);
  });
});
