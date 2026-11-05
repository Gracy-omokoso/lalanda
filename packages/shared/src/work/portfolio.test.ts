import { describe, expect, it } from 'vitest';

import {
  WorkPortfolioQuery,
  kinshasaDayStartInstant,
  kinshasaWeekStart,
  progressPercent,
  projectColor,
  projectHealth,
  type ProjectHealthInput,
} from './portfolio.js';

const base: ProjectHealthInput = {
  status: 'active',
  dueDate: '2026-11-30',
  openTaskCount: 4,
  doneTaskCount: 4,
  overdueTaskCount: 0,
  overdueMilestoneCount: 0,
};

describe('santé d’un projet (ADR-0058 § 2)', () => {
  it('en bonne voie sans retard', () => {
    expect(projectHealth(base, '2026-11-04')).toBe('on_track');
  });
  it('même règle que l’Aperçu (ADR-0057) : une tâche en retard suffit pour « à risque »', () => {
    expect(projectHealth({ ...base, overdueTaskCount: 1 }, '2026-11-04')).toBe('at_risk');
    // 3 retards sur 4 tâches ouvertes : au moins le quart → en retard.
    expect(projectHealth({ ...base, overdueTaskCount: 3 }, '2026-11-04')).toBe('late');
    // Échéance dans les 7 jours et moins de 75 % terminées → à risque.
    expect(projectHealth(base, '2026-11-25')).toBe('at_risk');
  });
  it('en retard : échéance du projet passée avec des tâches ouvertes', () => {
    expect(projectHealth(base, '2026-12-01')).toBe('late');
    // Le jour même de l'échéance, le projet n'est pas encore en retard (mais à risque).
    expect(projectHealth(base, '2026-11-30')).toBe('at_risk');
    // Échéance passée mais plus rien d'ouvert : pas en retard.
    expect(projectHealth({ ...base, openTaskCount: 0 }, '2026-12-01')).toBe('on_track');
  });
  it('terminé ou archivé : fermé', () => {
    expect(projectHealth({ ...base, status: 'completed' }, '2026-12-01')).toBe('closed');
    expect(projectHealth({ ...base, status: 'archived' }, '2026-12-01')).toBe('closed');
  });
  it('refuse une date invalide', () => {
    expect(() => projectHealth(base, '2026-02-30')).toThrow(RangeError);
  });
});

describe('semaine et jour de Kinshasa', () => {
  it('le lundi de la semaine ISO', () => {
    expect(kinshasaWeekStart('2026-11-04')).toBe('2026-11-02'); // mercredi
    expect(kinshasaWeekStart('2026-11-02')).toBe('2026-11-02'); // lundi
    expect(kinshasaWeekStart('2026-11-08')).toBe('2026-11-02'); // dimanche
    expect(kinshasaWeekStart('2027-01-01')).toBe('2026-12-28'); // chevauche l'année
  });
  it('minuit à Kinshasa = 23 h UTC la veille', () => {
    expect(kinshasaDayStartInstant('2026-11-02').toISOString()).toBe('2026-11-01T23:00:00.000Z');
  });
});

describe('avancement, couleur, requête', () => {
  it('pourcentage entier, borné', () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(3, 3)).toBe(100);
  });
  it('couleur stable, jamais grise', () => {
    const c = projectColor('65f0a1b2c3d4e5f601234567');
    expect(projectColor('65f0a1b2c3d4e5f601234567')).toBe(c);
    expect(c).not.toBe('gray');
    expect(c).not.toBe('red');
    const ids = Array.from(
      { length: 40 },
      (_, i) => `6aebb0bfa2b52bab8a6d12${(i + 16).toString(16)}`,
    );
    expect(new Set(ids.map(projectColor)).size).toBeGreaterThanOrEqual(5);
  });
  it('filtre par défaut « all », filtre inconnu refusé', () => {
    expect(WorkPortfolioQuery.parse({}).scope).toBe('all');
    expect(WorkPortfolioQuery.safeParse({ scope: 'x' }).success).toBe(false);
    expect(WorkPortfolioQuery.safeParse({ scope: 'mine', other: 1 }).success).toBe(false);
  });
});
