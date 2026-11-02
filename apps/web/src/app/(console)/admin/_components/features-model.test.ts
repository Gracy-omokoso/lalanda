import { describe, expect, it } from 'vitest';

import {
  derogationComplete,
  derogationVide,
  echeanceIso,
  echeanceValide,
  identifiantValide,
  libelleFonctionnalite,
  resumeGrille,
} from './features-model';

const NOW = new Date('2026-11-02T12:00:00Z');

describe('module fonctionnalités de la console', () => {
  it('propose une échéance à 30 jours, valide', () => {
    const v = derogationVide(NOW);
    expect(v.echeance).toBe('2026-12-02');
    expect(echeanceValide(v.echeance, NOW)).toBe(true);
  });

  it('refuse une échéance passée ou au-delà de 90 jours', () => {
    expect(echeanceValide('2026-11-01', NOW)).toBe(false);
    expect(echeanceValide('2027-02-01', NOW)).toBe(false);
    expect(echeanceValide('2027-01-30', NOW)).toBe(true);
    expect(echeanceIso('pas une date')).toBeNull();
    expect(echeanceIso('2026-12-02')).toBe('2026-12-02T23:59:00.000Z');
  });

  it('exige organisation, fonctionnalité du catalogue, catégorie et note interne', () => {
    const base = derogationVide(NOW);
    expect(derogationComplete(base, NOW)).toBe(false);
    const complete = {
      ...base,
      targetOrganizationId: 'a'.repeat(24),
      feature: 'crm' as const,
      motif: {
        reasonCategory: 'request' as const,
        clientMessage: '',
        internalNote: 'Essai demandé.',
      },
    };
    expect(derogationComplete(complete, NOW)).toBe(true);
    expect(derogationComplete({ ...complete, targetOrganizationId: 'x' }, NOW)).toBe(false);
    expect(
      derogationComplete({ ...complete, motif: { ...complete.motif, internalNote: 'court' } }, NOW),
    ).toBe(false);
    expect(identifiantValide(` ${'b'.repeat(24)} `)).toBe(true);
  });

  it('nomme les fonctionnalités et dit que la grille est ouverte', () => {
    expect(libelleFonctionnalite('crm')).toBe('CRM');
    expect(libelleFonctionnalite('inconnue')).toBe('inconnue');
    expect(resumeGrille({ closedCells: 0 })).toMatch(/entièrement ouverte/);
    expect(resumeGrille({ closedCells: 2 })).toMatch(/2 case/);
  });
});
