// ADR-0080 : heures de début et d'échéance — règles pures côté API (sans base).

import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { parseDayTime } from './work-import.parser.js';
import { checkFinalDates, finalTimes, overdueExpr, overdueFilter } from './work.common.js';

function erreur(fn: () => unknown): { status: number; body: unknown } {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() };
    throw e;
  }
  throw new Error('aucune erreur levée');
}

describe('heures retenues après une modification partielle', () => {
  const stocke = {
    startDate: '2026-11-18',
    dueDate: '2026-11-20',
    startTime: '08:00',
    dueTime: '17:00',
  };

  it('absente du corps : la valeur stockée', () => {
    expect(finalTimes({}, stocke)).toEqual({ startTime: '08:00', dueTime: '17:00' });
  });

  it('effacer le jour efface son heure', () => {
    expect(finalTimes({ dueDate: null }, stocke)).toEqual({ startTime: '08:00', dueTime: null });
  });

  it('retirer l’heure seule', () => {
    expect(finalTimes({ dueTime: null }, stocke)).toEqual({ startTime: '08:00', dueTime: null });
  });

  it('une heure sans jour (stocké ou envoyé) : 400 WORK_TIME_WITHOUT_DATE', () => {
    const e = erreur(() => finalTimes({ dueTime: '10:00' }, { dueDate: null }));
    expect(e.status).toBe(400);
    expect(JSON.stringify(e.body)).toContain('WORK_TIME_WITHOUT_DATE');
  });
});

describe('ordre final des dates et des heures', () => {
  it('le même jour, l’heure d’échéance ne précède pas l’heure de début', () => {
    const e = erreur(() =>
      checkFinalDates({
        startDate: '2026-11-18',
        dueDate: '2026-11-18',
        startTime: '10:00',
        dueTime: '09:00',
      }),
    );
    expect(e.status).toBe(400);
    expect(JSON.stringify(e.body)).toContain('WORK_DATES_INVERTED');
    expect(() =>
      checkFinalDates({
        startDate: '2026-11-18',
        dueDate: '2026-11-18',
        startTime: '10:00',
        dueTime: null,
      }),
    ).not.toThrow();
  });
});

describe('filtres « en retard » (fuseau de l’organisation)', () => {
  it('jour passé, ou jour même et heure atteinte', () => {
    expect(overdueFilter({ today: '2026-11-18', time: '14:00' })).toEqual({
      $or: [
        { dueDate: { $ne: null, $lt: '2026-11-18' } },
        { dueDate: '2026-11-18', dueTime: { $ne: null, $lte: '14:00' } },
      ],
    });
    expect(JSON.stringify(overdueExpr({ today: '2026-11-18', time: '14:00' }))).toContain(
      '"$lte":["$dueTime","14:00"]',
    );
  });
});

describe('import : date et heure d’une cellule', () => {
  it('lit l’heure facultative', () => {
    expect(parseDayTime('15/01/2027 14:30')).toEqual({ day: '2027-01-15', time: '14:30' });
    expect(parseDayTime('2027-01-15T09:05')).toEqual({ day: '2027-01-15', time: '09:05' });
    expect(parseDayTime('15/01/2027 9h05')).toEqual({ day: '2027-01-15', time: '09:05' });
    expect(parseDayTime('15/01/2027')).toEqual({ day: '2027-01-15', time: null });
    expect(parseDayTime('')).toBeNull();
  });

  it('minuit d’un export de tableur = sans heure ; heure impossible = illisible', () => {
    expect(parseDayTime('2027-01-15T00:00:00.000Z')).toEqual({ day: '2027-01-15', time: null });
    expect(parseDayTime('15/01/2027 25:00')).toBeUndefined();
    expect(parseDayTime('31/02/2027 10:00')).toBeUndefined();
  });
});
