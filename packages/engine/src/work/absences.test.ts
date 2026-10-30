// Absences des assignés (ADR-0045 § 6.2) — badge et constat d'échéance.

import { describe, expect, it } from 'vitest';

import { absenceSpansByUser, taskAbsences } from '../index.js';

describe('absences des assignés (ADR-0045 § 6.2, critère 17)', () => {
  const absences = [
    { userId: 'c', startDate: '2027-03-03', endDate: '2027-03-05' },
    // Absence suivante, collée : une seule période du 3 au 8.
    { userId: 'c', startDate: '2027-03-06', endDate: '2027-03-08' },
    { userId: 'd', startDate: '2027-03-20', endDate: '2027-03-20' },
  ];

  it('réunit les absences qui se recouvrent ou se suivent', () => {
    expect(absenceSpansByUser(absences).get('c')).toEqual([
      { from: '2027-03-03', to: '2027-03-08' },
    ]);
    expect(
      absenceSpansByUser([
        { userId: 'x', startDate: '2027-01-10', endDate: '2027-01-12' },
        { userId: 'x', startDate: '2027-01-01', endDate: '2027-01-03' },
        { userId: 'x', startDate: '2027-01-11', endDate: '2027-01-11' },
      ]).get('x'),
    ).toEqual([
      { from: '2027-01-01', to: '2027-01-03' },
      { from: '2027-01-10', to: '2027-01-12' },
    ]);
  });

  it('C absent du 3 au 5 : une tâche à échéance le 4 lève le constat ; le badge suit aujourd’hui', () => {
    const r = taskAbsences(
      [
        { id: 't1', assigneeUserId: 'c', dueDate: '2027-03-04', done: false },
        { id: 't2', assigneeUserId: 'c', dueDate: '2027-03-04', done: true },
        { id: 't3', assigneeUserId: 'c', dueDate: '2027-03-10', done: false },
        { id: 't4', assigneeUserId: null, dueDate: '2027-03-04', done: false },
        { id: 't5', assigneeUserId: 'd', dueDate: null, done: false },
      ],
      absences,
      '2027-03-04',
    );
    expect(r[0]).toEqual({
      taskId: 't1',
      assigneeAbsence: { from: '2027-03-03', to: '2027-03-08' },
      dueDateAbsence: { from: '2027-03-03', to: '2027-03-08' },
    });
    // Tâche terminée : badge, mais aucun constat.
    expect(r[1]!.dueDateAbsence).toBeNull();
    expect(r[1]!.assigneeAbsence).not.toBeNull();
    // Échéance hors absence.
    expect(r[2]!.dueDateAbsence).toBeNull();
    // Sans assigné, sans échéance : rien.
    expect(r[3]).toEqual({ taskId: 't4', assigneeAbsence: null, dueDateAbsence: null });
    expect(r[4]).toEqual({ taskId: 't5', assigneeAbsence: null, dueDateAbsence: null });
  });

  it('refuse une date invalide ou une absence inversée', () => {
    expect(() => taskAbsences([], [], '2027-02-30')).toThrow(RangeError);
    expect(() =>
      absenceSpansByUser([{ userId: 'x', startDate: '2027-01-05', endDate: '2027-01-04' }]),
    ).toThrow(RangeError);
  });
});
