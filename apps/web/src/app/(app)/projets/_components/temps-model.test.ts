// Feuille de temps en lecture (ADR-0045 § 6.3) — lot H7.
import { describe, expect, it } from 'vitest';

import {
  etatJour,
  formatMinutes,
  formatPrevu,
  aPresence,
  messageConstat,
  peutChoisirMembre,
  semaineVoisine,
  tonConstat,
} from './temps-model';

describe('feuille de temps', () => {
  it('navigation d’une semaine à l’autre', () => {
    expect(semaineVoisine('2026-10-26', 1)).toBe('2026-11-02');
    expect(semaineVoisine('2026-10-26', -1)).toBe('2026-10-19');
  });

  it('minutes de l’API en heures lisibles', () => {
    expect(formatMinutes(0)).toBe('—');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatMinutes(150)).toBe('2 h 30');
    expect(formatPrevu('0.5')).toBe('0,5 j');
    expect(formatPrevu('1')).toBe('1 j');
  });

  it('état du jour : férié, absent, jamais le type', () => {
    expect(etatJour({ holiday: null, absence: 'full', scheduled: '1' })).toBe('Absent');
    expect(etatJour({ holiday: 'am', absence: 'pm', scheduled: '1' })).toBe(
      'Férié (matin) · Absent (après-midi)',
    );
    expect(etatJour({ holiday: null, absence: null, scheduled: '0' })).toBe('Non travaillé');
    expect(etatJour({ holiday: null, absence: null, scheduled: '1' })).toBeNull();
  });

  it('constats rendus par l’API', () => {
    const c = { code: 'TIME_ON_LEAVE_DAY' as const, date: '2026-11-04', minutes: 120 };
    expect(messageConstat(c)).toMatch(/2 h saisies le 4 nov\. 2026/);
    expect(tonConstat(c)).toBe('attention');
    expect(tonConstat({ code: 'NO_TIME_ON_WORKING_DAY' })).toBe('info');
  });

  it('ADR-0051 — H14 : présence pointée, information seulement', () => {
    const c = { code: 'PROJECT_TIME_ABOVE_ATTENDANCE' as const, date: '2026-11-04', minutes: 60 };
    expect(messageConstat(c)).toMatch(/dépasse de 1 h la présence pointée/);
    expect(tonConstat(c)).toBe('info');
    const jour = {
      date: '2026-11-02',
      weekday: 'mon' as const,
      scheduled: '1',
      holiday: null,
      absence: null,
      expected: '1',
      totalMinutes: 0,
    };
    expect(aPresence({ days: [jour] })).toBe(false);
    expect(aPresence({ days: [{ ...jour, attendanceMinutes: 0 }] })).toBe(true);
  });

  it('autrui : work.manage', () => {
    expect(peutChoisirMembre(['work.read'])).toBe(false);
    expect(peutChoisirMembre(['work.manage'])).toBe(true);
  });
});
