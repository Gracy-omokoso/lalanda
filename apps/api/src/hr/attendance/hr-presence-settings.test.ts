// Réglages des présences et des plannings : valeurs par défaut (ADR-0051 § 2.7, critère 17).
// ADR-0051 — H12.

import { describe, expect, it } from 'vitest';

import { addDaysIso, isMonday, mondayOfIso, spanDays } from '../planning/hr-presence-reader.js';
import { UpdatePresenceSettingsBody, presenceSettingsViewOf } from './hr-presence-settings.js';

describe('presenceSettingsViewOf', () => {
  it('rien d’enregistré : pointage et plannings éteints, aucun seuil, aucune purge', () => {
    expect(presenceSettingsViewOf(null)).toEqual({
      attendance: { enabled: false, selfClock: true, lateToleranceMinutes: null },
      planning: { enabled: false, indicativeMaxMinutesPerWeek: null },
      retention: { attendanceMonths: null },
      revision: 0,
      isDefault: true,
    });
  });

  it('un document RH sans ces champs garde les défauts ; une valeur hors contrat aussi', () => {
    const v = presenceSettingsViewOf({
      revision: 3,
      approvalFlow: 'manager_only',
      attendance: { enabled: 'oui', lateToleranceMinutes: 9999 },
      planning: { enabled: true, indicativeMaxMinutesPerWeek: 0 },
      retention: { privateDataMonthsAfterExit: 12 },
    });
    expect(v.attendance).toEqual({ enabled: false, selfClock: true, lateToleranceMinutes: null });
    expect(v.planning).toEqual({ enabled: true, indicativeMaxMinutesPerWeek: null });
    expect(v.retention).toEqual({ attendanceMonths: null });
    expect(v.revision).toBe(3);
    expect(v.isDefault).toBe(false);
  });

  it('valeurs saisies relues telles quelles', () => {
    const v = presenceSettingsViewOf({
      revision: 1,
      attendance: { enabled: true, selfClock: false, lateToleranceMinutes: 10 },
      planning: { enabled: true, indicativeMaxMinutesPerWeek: 2400 },
      retention: { attendanceMonths: 24 },
    });
    expect(v.attendance).toEqual({ enabled: true, selfClock: false, lateToleranceMinutes: 10 });
    expect(v.planning.indicativeMaxMinutesPerWeek).toBe(2400);
    expect(v.retention.attendanceMonths).toBe(24);
  });
});

describe('UpdatePresenceSettingsBody', () => {
  it('strict : aucun champ de localisation, de biométrie ni de durée légale', () => {
    expect(
      UpdatePresenceSettingsBody.safeParse({ expectedRevision: 0, attendance: { geofence: 1 } })
        .success,
    ).toBe(false);
    expect(
      UpdatePresenceSettingsBody.safeParse({
        expectedRevision: 0,
        planning: { legalMaxMinutesPerWeek: 2400 },
      }).success,
    ).toBe(false);
    expect(
      UpdatePresenceSettingsBody.safeParse({
        expectedRevision: 0,
        attendance: { enabled: true, lateToleranceMinutes: null },
        planning: { enabled: true },
      }).success,
    ).toBe(true);
  });
});

describe('jours civils', () => {
  it('addDaysIso, spanDays, lundi', () => {
    expect(addDaysIso('2027-02-28', 1)).toBe('2027-03-01');
    expect(spanDays('2027-03-01', '2027-03-07')).toBe(7);
    expect(isMonday('2027-03-01')).toBe(true);
    expect(isMonday('2027-03-02')).toBe(false);
    expect(mondayOfIso('2027-03-07')).toBe('2027-03-01');
    expect(mondayOfIso('2027-03-01')).toBe('2027-03-01');
  });
});
