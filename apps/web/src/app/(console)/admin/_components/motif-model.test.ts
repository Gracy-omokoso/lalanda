import { describe, expect, it } from 'vitest';

import {
  CATEGORIES_MOTIF,
  echeanceSupportParDefaut,
  MOTIF_VIDE,
  motifComplet,
  rechercheSuffisante,
} from './motif-model';

describe('motif d’un geste de la console (ADR-0053 — P2)', () => {
  const plein = {
    reasonCategory: 'abuse' as const,
    clientMessage: 'Activité anormale.',
    internalNote: 'Signalement n° 12.',
  };
  const tout = { avecCategorie: true, avecMessageClient: true };

  it('exige catégorie, message client et note de dix caractères', () => {
    expect(motifComplet(MOTIF_VIDE, tout)).toBe(false);
    expect(motifComplet(plein, tout)).toBe(true);
    expect(motifComplet({ ...plein, reasonCategory: '' }, tout)).toBe(false);
    expect(motifComplet({ ...plein, clientMessage: '  ' }, tout)).toBe(false);
    expect(motifComplet({ ...plein, internalNote: 'court' }, tout)).toBe(false);
  });

  it('un débloquage n’exige que la note interne', () => {
    expect(
      motifComplet(
        { ...MOTIF_VIDE, internalNote: 'Contestation acceptée.' },
        { avecCategorie: false, avecMessageClient: false },
      ),
    ).toBe(true);
  });

  it('six catégories libellées', () => {
    expect(CATEGORIES_MOTIF).toHaveLength(6);
    for (const c of CATEGORIES_MOTIF) expect(c.libelle.length).toBeGreaterThan(2);
  });

  it('recherche de trois caractères au moins', () => {
    expect(rechercheSuffisante(' ab ')).toBe(false);
    expect(rechercheSuffisante('abc')).toBe(true);
  });

  it('l’échéance par défaut du Support reste dans les 90 jours', () => {
    const now = new Date('2026-11-02T10:00:00.000Z');
    const delta = Date.parse(echeanceSupportParDefaut(now)) - now.getTime();
    expect(delta).toBeGreaterThan(89 * 86_400_000);
    expect(delta).toBeLessThanOrEqual(90 * 86_400_000);
  });
});
