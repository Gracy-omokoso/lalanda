import { describe, expect, it } from 'vitest';

import {
  decaler,
  duree,
  explicationEteinte,
  instantKinshasa,
  joursSemaine,
  lundiDe,
} from './rh2-model';
import {
  MENTION_POINTAGE,
  accesPresences,
  libelleConstat,
  pointageSuggere,
  separationCorrection,
} from './presences-model';

const reglages = (enabled: boolean, selfClock = true) => ({
  attendance: { enabled, selfClock, lateToleranceMinutes: null },
});

describe('ADR-0051 H16 — présences', () => {
  it('éteint par défaut : rien n’est offert, l’écran explique comment l’activer', () => {
    const acces = accesPresences(reglages(false), ['attendance.clock', 'hr.read'], true);
    expect(acces).toEqual({
      active: false,
      pointer: false,
      equipe: false,
      saisirPourAutrui: false,
    });
    expect(accesPresences(null, ['attendance.clock'], false).active).toBe(false);
    expect(explicationEteinte('attendance', ['hr.manage']).action).toMatch(/Réglages/);
    expect(explicationEteinte('attendance', []).action).toMatch(/Seule une personne/);
    expect(explicationEteinte('attendance', []).texte).toMatch(/aucune position/);
  });

  it('activé : pointer exige `attendance.clock` et le pointage par soi', () => {
    expect(accesPresences(reglages(true), ['attendance.clock'], false).pointer).toBe(true);
    expect(accesPresences(reglages(true, false), ['attendance.clock'], false).pointer).toBe(false);
    expect(accesPresences(reglages(true), ['hr.read'], false)).toMatchObject({
      pointer: false,
      equipe: true,
      saisirPourAutrui: false,
    });
  });

  it('le bouton dit ce qui est enregistré', () => {
    expect(MENTION_POINTAGE).toMatch(/heure du serveur, rien d’autre/);
  });

  it('pointage suggéré : départ après une arrivée ouverte ; les annulés ne comptent pas', () => {
    expect(pointageSuggere([])).toBe('in');
    const arrivee = { kind: 'in' as const, at: '2026-11-02T07:02:00Z', voidedBy: null };
    expect(pointageSuggere([arrivee])).toBe('out');
    expect(pointageSuggere([{ ...arrivee, voidedBy: 'c1' }])).toBe('in');
    expect(
      pointageSuggere([arrivee, { kind: 'out', at: '2026-11-02T16:10:00Z', voidedBy: null }]),
    ).toBe('in');
  });

  it('une correction n’est jamais décidée par son bénéficiaire ni par son auteur', () => {
    const moi = { employeeId: 'e1', userId: 'u1' };
    const c = { employeeId: 'e2', requestedBy: 'u2', status: 'pending' as const };
    expect(separationCorrection(c, moi)).toBeNull();
    expect(separationCorrection({ ...c, employeeId: 'e1' }, moi)).toMatch(/votre propre/);
    expect(separationCorrection({ ...c, requestedBy: 'u1' }, moi)).toMatch(/saisi/);
    expect(separationCorrection({ ...c, status: 'approved' }, moi)).toBeNull();
  });

  it('constats en mots simples, code inconnu rendu tel quel', () => {
    expect(libelleConstat('ATTENDANCE_UNPAIRED')).toMatch(/sans arrivée/);
    expect(libelleConstat('X')).toBe('X');
  });
});

describe('ADR-0051 H16 — jours et heures', () => {
  it('semaine du lundi au dimanche, décalages', () => {
    expect(lundiDe('2026-11-05')).toBe('2026-11-02');
    expect(lundiDe('2026-11-08')).toBe('2026-11-02');
    expect(joursSemaine('2026-11-02')).toHaveLength(7);
    expect(decaler('2026-10-31', 1)).toBe('2026-11-01');
  });

  it('heure saisie à Kinshasa → instant UTC ; durées du moteur mises en forme', () => {
    expect(instantKinshasa('2026-11-02', '08:02')).toBe('2026-11-02T07:02:00Z');
    expect(instantKinshasa('2026-11-02', '00:30')).toBe('2026-11-01T23:30:00Z');
    expect(instantKinshasa('2026-11-02', '8h')).toBeNull();
    expect(duree(548)).toBe('9 h 08');
    expect(duree(45)).toBe('45 min');
  });
});
