// Feuille de temps en lecture (ADR-0045 § 6.3). ADR-0045 — H5.

import { describe, expect, it } from 'vitest';

import { PROJECT_MARGIN_FINDINGS, WeeklyTimesheetQuery } from './index.js';

describe('WeeklyTimesheetQuery', () => {
  it('lundi seulement ; identifiant de membre ; corps strict', () => {
    expect(WeeklyTimesheetQuery.safeParse({ week: '2027-03-01' }).success).toBe(true);
    expect(WeeklyTimesheetQuery.safeParse({ week: '2027-03-02' }).success).toBe(false);
    expect(WeeklyTimesheetQuery.safeParse({ userId: 'nope' }).success).toBe(false);
    expect(WeeklyTimesheetQuery.safeParse({ validate: 'true' }).success).toBe(false);
    expect(WeeklyTimesheetQuery.safeParse({}).success).toBe(true);
  });

  it('marge 1.2.0 : le constat de double comptage est connu du contrat', () => {
    expect(PROJECT_MARGIN_FINDINGS).toContain('PERSONNEL_EXPENSES_AND_TIME_COST');
  });
});
