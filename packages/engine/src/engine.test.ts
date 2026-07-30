import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, engineHealth } from './index.js';

describe('engineHealth()', () => {
  it('retourne un statut healthy avec la version', () => {
    expect(engineHealth()).toEqual({ ok: true, version: ENGINE_VERSION });
  });
});
