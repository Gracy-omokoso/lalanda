import { describe, expect, it } from 'vitest';

import { mondayOfDay, timeApprovalShare } from './time-approval.js';

describe('ADR-0077 § 4.5 — part du temps validé', () => {
  it('lundi de la semaine', () => {
    expect(mondayOfDay('2026-11-16')).toBe('2026-11-16');
    expect(mondayOfDay('2026-11-22')).toBe('2026-11-16');
    expect(mondayOfDay('2026-11-23')).toBe('2026-11-23');
    expect(mondayOfDay('2027-01-01')).toBe('2026-12-28');
  });

  it('compte tout le temps, et à part celui des semaines validées de son auteur', () => {
    const r = timeApprovalShare(
      [
        { userId: 'a', workedOn: '2026-11-17', minutes: 60 },
        { userId: 'a', workedOn: '2026-11-24', minutes: 30 },
        { userId: 'b', workedOn: '2026-11-18', minutes: 45 },
      ],
      [
        { userId: 'a', week: '2026-11-16' },
        { userId: 'c', week: '2026-11-16' },
      ],
    );
    expect(r).toEqual({ totalMinutes: 135, approvedMinutes: 60 });
  });

  it('sans saisie : zéro', () => {
    expect(timeApprovalShare([], [])).toEqual({ totalMinutes: 0, approvedMinutes: 0 });
  });
});
