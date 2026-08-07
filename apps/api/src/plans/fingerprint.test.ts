import { describe, expect, it } from 'vitest';

import { canonicalJson, computePlanFingerprint } from './fingerprint.js';

describe('canonicalJson', () => {
  it("trie les clés d'objets récursivement", () => {
    expect(canonicalJson({ b: 1, a: { z: 2, y: 3 } })).toBe('{"a":{"y":3,"z":2},"b":1}');
  });

  it("préserve l'ordre des tableaux", () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('omet les valeurs undefined', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('gère les scalaires et null', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(1.5)).toBe('1.5');
    expect(canonicalJson('x')).toBe('"x"');
  });
});

describe('computePlanFingerprint', () => {
  const base = {
    driverValues: { prix_unitaire: 10, quantite_mois: 100 },
    templateSlug: 'hello-world',
    templateVersion: '1.0.0',
    parameterPackSlug: 'cd-2026',
    packVersion: '2026',
    engineVersion: '0.1.0',
  };

  it("est déterministe et insensible à l'ordre des clés des drivers", () => {
    const a = computePlanFingerprint(base);
    const b = computePlanFingerprint({
      ...base,
      driverValues: { quantite_mois: 100, prix_unitaire: 10 },
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("change si un driver change", () => {
    const a = computePlanFingerprint(base);
    const b = computePlanFingerprint({
      ...base,
      driverValues: { ...base.driverValues, prix_unitaire: 12 },
    });
    expect(a).not.toBe(b);
  });

  it('change si la version moteur change', () => {
    const a = computePlanFingerprint(base);
    const b = computePlanFingerprint({ ...base, engineVersion: '0.2.0' });
    expect(a).not.toBe(b);
  });

  it('change si le pack change', () => {
    const a = computePlanFingerprint(base);
    const b = computePlanFingerprint({ ...base, parameterPackSlug: 'ci-2026' });
    expect(a).not.toBe(b);
  });

  it('distingue « pack absent » de « pack présent »', () => {
    const a = computePlanFingerprint({ ...base, parameterPackSlug: undefined, packVersion: undefined });
    const b = computePlanFingerprint(base);
    expect(a).not.toBe(b);
  });
});
