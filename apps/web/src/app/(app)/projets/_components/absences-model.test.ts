import { describe, expect, it } from 'vitest';

import { badgeAbsent, bandeauxAbsence, constatAbsentEcheance } from './absences-model';

describe('absences vues depuis les Projets (ADR-0045 § 6.2, § 8)', () => {
  it('badge et constat : des jours seulement', () => {
    expect(badgeAbsent({ from: '2027-03-03', to: '2027-03-08' })).toEqual({
      court: 'Absent jusqu’au 8 mars',
      complet: 'Absent du 3 mars au 8 mars',
    });
    expect(badgeAbsent({ from: '2027-03-04', to: '2027-03-04' }).complet).toBe('Absent le 4 mars');
    expect(constatAbsentEcheance({ from: '2027-03-03', to: '2027-03-05' }, 'Awa')).toBe(
      'Awa est absent à l’échéance (du 3 mars au 5 mars) : replanifiez ou réassignez la tâche.',
    );
  });

  it('bandeaux d’une journée, bornés à la période, sans type', () => {
    const b = bandeauxAbsence(
      [
        {
          employeeName: 'Awa',
          status: 'approved',
          start: { date: '2027-03-02', half: 'pm' },
          end: { date: '2027-03-04', half: 'am' },
        },
        {
          employeeName: 'Bea',
          status: 'pending',
          start: { date: '2027-03-03', half: 'full' },
          end: { date: '2027-03-10', half: 'full' },
        },
      ],
      '2027-03-01',
      '2027-03-05',
    );
    expect(b.get('2027-03-01')).toBeUndefined();
    expect(b.get('2027-03-02')).toEqual(['Awa — absent l’après-midi']);
    expect(b.get('2027-03-03')).toEqual(['Awa — absent', 'Bea — absent (en attente)']);
    expect(b.get('2027-03-04')).toEqual(['Awa — absent le matin', 'Bea — absent (en attente)']);
    expect(b.get('2027-03-05')).toEqual(['Bea — absent (en attente)']);
    expect(b.has('2027-03-06')).toBe(false);
  });

  it('une seule demi-journée', () => {
    const b = bandeauxAbsence(
      [
        {
          employeeName: null,
          status: 'approved',
          start: { date: '2027-03-02', half: 'am' },
          end: { date: '2027-03-02', half: 'am' },
        },
      ],
      '2027-03-01',
      '2027-03-07',
    );
    expect(b.get('2027-03-02')).toEqual(['Un collaborateur — absent le matin']);
  });
});
