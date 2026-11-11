// ADR-0074, décision n° 1 : fériés de l'organisation dans les calendriers.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { marquesDesFeries, nomDuFerie, peutLireFeries } from './feries-marques';

const ferie = {
  id: 'h1',
  date: '2027-06-30',
  label: 'Indépendance',
  halfDay: null,
  recurring: false,
  toVerify: false,
  source: 'Ordonnance-loi',
  createdAt: '2026-11-11T00:00:00.000Z',
} as const;

describe('fériés → jours marqués', () => {
  it('ne transmet que la date, le nom et la récurrence', () => {
    expect(marquesDesFeries([ferie])).toEqual([
      { date: '2027-06-30', label: 'Indépendance', recurring: false },
    ]);
    const [m] = marquesDesFeries([{ ...ferie, recurring: true }]);
    expect(Object.keys(m!).sort()).toEqual(['date', 'label', 'recurring']);
  });

  it('demi-journée et date à vérifier sont dites dans le nom', () => {
    expect(nomDuFerie({ label: 'Fermeture', halfDay: 'pm', toVerify: false })).toBe(
      'Fermeture (après-midi)',
    );
    expect(nomDuFerie({ label: ' Kimbangu ', halfDay: 'am', toVerify: true })).toBe(
      'Kimbangu (matin) — à vérifier',
    );
  });

  it('écarte un nom vide', () => {
    expect(marquesDesFeries([{ ...ferie, label: '  ' }])).toEqual([]);
  });

  it('lecture tentée seulement si l’API l’accepterait', () => {
    expect(peutLireFeries(null, 'included')).toBe(false);
    expect(peutLireFeries(['sales.read'], 'included')).toBe(false);
    expect(peutLireFeries(['analytics.read'], 'not_in_plan')).toBe(false);
    expect(peutLireFeries(['analytics.read'], null)).toBe(false);
    expect(peutLireFeries(['analytics.read'], 'included')).toBe(true);
    expect(peutLireFeries(['analytics.read'], 'override')).toBe(true);
  });

  it('le fournisseur lit la route existante, une fois par organisation', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./organization-holidays.tsx', import.meta.url)),
      'utf8',
    );
    expect(source).toContain('hrAdminApi.listHolidays()');
    expect(source).toContain('[lisible, organizationId]');
    expect(source).toContain('DateMarksProvider');
  });
});
