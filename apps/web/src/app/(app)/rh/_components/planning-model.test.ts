import { describe, expect, it } from 'vitest';

import type { ShiftView } from '@/lib/api-rh-2';

import {
  brouillonsPublies,
  constatsDe,
  grille,
  horaire,
  peutPlanifier,
  phraseSousEffectif,
  porteeParDefaut,
} from './planning-model';
import { joursSemaine } from './rh2-model';

function creneau(p: Partial<ShiftView>): ShiftView {
  return {
    id: 's1',
    employeeId: 'e1',
    employeeName: 'Zoé',
    date: '2026-11-02',
    start: '08:00',
    end: '16:00',
    crossesMidnight: false,
    label: null,
    location: null,
    departmentId: null,
    workProjectId: null,
    status: 'draft',
    publishedAt: null,
    note: null,
    unavailability: null,
    canPlan: true,
    revision: 1,
    createdAt: '',
    updatedAt: '',
    ...p,
  };
}

describe('ADR-0051 H16 — plannings', () => {
  const jours = joursSemaine('2026-11-02');

  it('grille par personne et par jour, annulés exclus, triée par nom puis heure', () => {
    const g = grille(
      [
        creneau({ id: 'a', start: '14:00' }),
        creneau({ id: 'b', start: '08:00' }),
        creneau({ id: 'c', employeeId: 'e2', employeeName: 'Ange', date: '2026-11-03' }),
        creneau({ id: 'd', status: 'cancelled' }),
        creneau({ id: 'e', date: '2026-11-20' }),
      ],
      jours,
    );
    expect(g.map((l) => l.nom)).toEqual(['Ange', 'Zoé']);
    expect(g[1]!.jours[0]!.map((c) => c.id)).toEqual(['b', 'a']);
    expect(g[0]!.jours[1]!.map((c) => c.id)).toEqual(['c']);
  });

  it('publier : les brouillons que l’on planifie seulement', () => {
    expect(
      brouillonsPublies([
        creneau({ id: 'a' }),
        creneau({ id: 'b', status: 'published' }),
        creneau({ id: 'c', canPlan: false }),
      ]),
    ).toEqual(['a']);
  });

  it('planificateur : manager ou `hr.manage` ; portée par défaut', () => {
    expect(peutPlanifier(['hr.read'], false)).toBe(false);
    expect(peutPlanifier(['hr.manage'], false)).toBe(true);
    expect(peutPlanifier([], true)).toBe(true);
    expect(porteeParDefaut(['hr.read'], false)).toBe('organization');
    expect(porteeParDefaut([], true)).toBe('team');
    expect(porteeParDefaut([], false)).toBe('me');
  });

  it('constats et sous-effectif : des faits et des nombres, jamais un nom', () => {
    expect(horaire({ start: '22:00', end: '06:00', crossesMidnight: true })).toBe(
      '22:00 – 06:00 (lendemain)',
    );
    expect(
      constatsDe('a', [
        {
          code: 'SHIFT_DURING_LEAVE',
          employeeId: 'e1',
          shiftIds: ['a'],
          week: null,
          minutes: null,
        },
      ]),
    ).toEqual(['Créneau pendant une absence accordée']);
    const phrase = phraseSousEffectif({
      code: 'UNDERSTAFFED_SLOT',
      needId: 'n',
      date: '2026-11-02',
      start: '08:00',
      end: '12:00',
      minStaff: 2,
      planned: 1,
      available: 1,
      shortfall: 1,
      departmentId: null,
      location: 'Accueil',
      label: null,
    });
    expect(phrase).toBe('Accueil · 08:00–12:00 : 1 disponible sur 2 demandés (1 planifié).');
  });
});
