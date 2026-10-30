// Rappel du double comptage (ADR-0045 § 6.3) — lot H7.
import { describe, expect, it } from 'vitest';

import { RAPPEL_PERSONNEL_PROJET, rappelPersonnel } from './depense-personnel';

describe('rappel « personnel » sur un projet', () => {
  it('seulement pour une dépense personnel rattachée à un projet', () => {
    expect(rappelPersonnel('personnel', 'p1')).toBe(RAPPEL_PERSONNEL_PROJET);
    expect(rappelPersonnel('personnel', '')).toBeNull();
    expect(rappelPersonnel('loyer', 'p1')).toBeNull();
    expect(RAPPEL_PERSONNEL_PROJET).toMatch(/ne retranche rien/);
  });
});
