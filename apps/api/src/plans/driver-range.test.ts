// Bornes DSL appliquées côté serveur avant de figer un plan (S18c — revue CTO B1).

import { describe, expect, it } from 'vitest';
import { TemplateSchema, type Template } from '@lalanda/engine';

import { findDriverRangeViolations } from './driver-range.js';

const template: Template = TemplateSchema.parse({
  slug: 'demo',
  version: '1.0.0',
  drivers: [
    { id: 'borne', label: 'Borné', type: 'number', min: 0, max: 100, defaut: 50 },
    { id: 'plancher', type: 'number', min: 0, defaut: 1 },
    { id: 'plafond', type: 'number', max: 10, defaut: 1 },
    { id: 'libre', type: 'number', defaut: 1 },
    { id: 'taux', label: 'Taux', type: 'percent', min: 0, max: 0.6, defaut: 0.3 },
  ],
  feuilles: [{ id: 'f', lignes: [{ id: 'l', formule: 'borne * 2' }] }],
});

describe('findDriverRangeViolations', () => {
  it('ne signale rien quand toutes les valeurs sont dans les bornes', () => {
    expect(findDriverRangeViolations(template, { borne: 50, taux: 0.3 })).toEqual([]);
  });

  it('accepte les valeurs exactement sur les bornes', () => {
    expect(findDriverRangeViolations(template, { borne: 0 })).toEqual([]);
    expect(findDriverRangeViolations(template, { borne: 100 })).toEqual([]);
  });

  it('signale une valeur sous le minimum, avec le contexte nécessaire au message', () => {
    expect(findDriverRangeViolations(template, { borne: -1 })).toEqual([
      { driverId: 'borne', label: 'Borné', value: -1, min: 0, max: 100 },
    ]);
  });

  it('signale une valeur au-dessus du maximum', () => {
    expect(findDriverRangeViolations(template, { borne: 101 })).toHaveLength(1);
  });

  it('applique une borne unique (plancher seul, plafond seul)', () => {
    expect(findDriverRangeViolations(template, { plancher: -0.5 })).toHaveLength(1);
    expect(findDriverRangeViolations(template, { plafond: 11 })).toHaveLength(1);
    expect(findDriverRangeViolations(template, { plancher: 999, plafond: -999 })).toEqual([]);
  });

  it('laisse passer un driver sans bornes déclarées', () => {
    expect(findDriverRangeViolations(template, { libre: -1e9 })).toEqual([]);
  });

  it('compare les pourcentages en fraction, comme le DSL les déclare', () => {
    // 0.8 = 80 %, au-delà du max 0.6 ; 0.5 = 50 %, dans les bornes.
    expect(findDriverRangeViolations(template, { taux: 0.8 })).toHaveLength(1);
    expect(findDriverRangeViolations(template, { taux: 0.5 })).toEqual([]);
  });

  it('ignore les drivers non fournis — pack et défauts prennent le relais', () => {
    expect(findDriverRangeViolations(template, {})).toEqual([]);
  });

  it('ignore un driver inconnu du template (le moteur le signalera)', () => {
    expect(findDriverRangeViolations(template, { fantome: 42 })).toEqual([]);
  });

  it('signale une valeur non finie, incomparable à toute borne', () => {
    expect(findDriverRangeViolations(template, { libre: Number.NaN })).toHaveLength(1);
    expect(findDriverRangeViolations(template, { libre: Number.POSITIVE_INFINITY })).toHaveLength(
      1,
    );
  });

  it('remonte toutes les violations, pas seulement la première', () => {
    const found = findDriverRangeViolations(template, { borne: 500, plafond: 50, taux: 9 });
    expect(found.map((v) => v.driverId)).toEqual(['borne', 'plafond', 'taux']);
  });
});
