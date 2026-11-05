import { describe, expect, it } from 'vitest';

import {
  candidatsAjoutables,
  formEquipe,
  messageEquipe,
  resumeEquipe,
  validerEquipe,
} from './equipes-model';

describe('équipes (ADR-0060 § 2)', () => {
  it('formulaire vide puis repris d’une équipe', () => {
    expect(formEquipe(null)).toEqual({ name: '', description: '', leadUserId: '' });
    expect(
      formEquipe({
        id: 't',
        name: 'Chantier',
        description: null,
        lead: { userId: 'u1', name: 'Awa' },
        members: [],
        memberCount: 1,
        projectCount: 0,
        revision: 1,
        createdAt: '',
        updatedAt: '',
      }),
    ).toEqual({ name: 'Chantier', description: '', leadUserId: 'u1' });
  });

  it('validation : nom obligatoire, borné, vides → null', () => {
    expect(validerEquipe({ name: '  ', description: '', leadUserId: '' }).ok).toBe(false);
    expect(validerEquipe({ name: 'x'.repeat(81), description: '', leadUserId: '' }).ok).toBe(false);
    expect(validerEquipe({ name: ' Pose ', description: ' ', leadUserId: '' })).toEqual({
      ok: true,
      corps: { name: 'Pose', description: null, leadUserId: null },
    });
  });

  it('candidats : ceux qui ne sont pas encore membres', () => {
    const c = [
      { userId: 'a', name: 'A' },
      { userId: 'b', name: 'B' },
    ];
    expect(candidatsAjoutables(c, { members: [{ userId: 'a', name: 'A' }] })).toEqual([
      { userId: 'b', name: 'B' },
    ]);
    expect(candidatsAjoutables(c, null)).toEqual(c);
  });

  it('résumé et messages', () => {
    expect(resumeEquipe({ memberCount: 1, projectCount: 0 })).toBe('1 membre');
    expect(resumeEquipe({ memberCount: 3, projectCount: 2 })).toBe('3 membres · 2 projets');
    expect(messageEquipe('HR_TEAM_NAME_EXISTS', 'x')).toContain('déjà');
    expect(messageEquipe(null, 'repli')).toBe('repli');
  });
});
