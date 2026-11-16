import { describe, expect, it } from 'vitest';

import {
  CreateProjectFromContractBody,
  DecideTimesheetBody,
  DecideTimesheetWithReasonBody,
  SubmitTimesheetBody,
  isMondayDay,
  timesheetHref,
} from './sync.js';

const ID = 'a'.repeat(24);

describe('ADR-0077 — contrat → projet', () => {
  it('accepte un contrat seul, ramène l’identifiant en minuscules', () => {
    const r = CreateProjectFromContractBody.parse({ contractId: 'A'.repeat(24) });
    expect(r.contractId).toBe(ID);
    expect(r.scheduleMilestones).toBeUndefined();
  });

  it('refuse un champ inconnu et une ligne retenue deux fois', () => {
    expect(CreateProjectFromContractBody.safeParse({ contractId: ID, amount: '1' }).success).toBe(
      false,
    );
    expect(
      CreateProjectFromContractBody.safeParse({ contractId: ID, lineIndexes: [0, 0] }).success,
    ).toBe(false);
  });
});

describe('ADR-0077 — feuilles de temps', () => {
  it('reconnaît un lundi', () => {
    expect(isMondayDay('2026-11-16')).toBe(true);
    expect(isMondayDay('2026-11-17')).toBe(false);
    expect(isMondayDay('2026-13-01')).toBe(false);
  });

  it('soumission : un lundi, révision 0 admise', () => {
    expect(SubmitTimesheetBody.safeParse({ week: '2026-11-16', expectedRevision: 0 }).success).toBe(
      true,
    );
    expect(SubmitTimesheetBody.safeParse({ week: '2026-11-18', expectedRevision: 0 }).success).toBe(
      false,
    );
  });

  it('décision : révision ≥ 1, motif obligatoire pour un renvoi', () => {
    expect(
      DecideTimesheetBody.safeParse({ userId: ID, week: '2026-11-16', expectedRevision: 0 })
        .success,
    ).toBe(false);
    expect(
      DecideTimesheetWithReasonBody.safeParse({
        userId: ID,
        week: '2026-11-16',
        expectedRevision: 1,
        reason: '   ',
      }).success,
    ).toBe(false);
    const ok = DecideTimesheetWithReasonBody.parse({
      userId: ID,
      week: '2026-11-16',
      expectedRevision: 2,
      reason: '  Mardi manquant  ',
    });
    expect(ok.reason).toBe('Mardi manquant');
  });

  it('lien vers la feuille d’un membre', () => {
    expect(timesheetHref(ID, '2026-11-16')).toBe(
      `/projets/mes-taches/temps?membre=${ID}&semaine=2026-11-16`,
    );
  });
});
