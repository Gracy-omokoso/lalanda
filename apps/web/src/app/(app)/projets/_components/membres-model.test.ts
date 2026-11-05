import { describe, expect, it } from 'vitest';

import {
  equipesAjoutables,
  libelleEquipe,
  messageMembres,
  personnesAjoutables,
  phraseAcces,
} from './membres-model';

describe('membres d’un projet (ADR-0060)', () => {
  const membres = [
    { userId: 'a', name: 'Awa', canUpdate: true, canManage: false },
    { userId: 'b', name: 'Béni', canUpdate: false, canManage: false },
  ];

  it('personnes et équipes encore ajoutables', () => {
    expect(
      personnesAjoutables(membres, { users: [{ userId: 'a', name: 'Awa', canUpdate: true }] }),
    ).toEqual([membres[1]]);
    expect(personnesAjoutables(membres, null)).toEqual(membres);
    const equipes = [
      { teamId: 't1', name: 'Pose', memberCount: 3 },
      { teamId: 't2', name: 'Études', memberCount: 1 },
    ];
    expect(
      equipesAjoutables(equipes, {
        teams: [{ teamId: 't1', name: 'Pose', memberCount: 3, members: [] }],
      }),
    ).toEqual([equipes[1]]);
  });

  it('phrases d’accès selon la visibilité', () => {
    expect(phraseAcces({ visibility: 'organization', memberCount: 0 })).toContain(
      'Tous les membres',
    );
    expect(phraseAcces({ visibility: 'private', memberCount: 1 })).toBe(
      '1 personne a accès à ce projet, en plus de la direction.',
    );
    expect(phraseAcces({ visibility: 'private', memberCount: 7 })).toContain('7 personnes ont');
  });

  it('libellés et messages', () => {
    expect(libelleEquipe({ name: 'Pose', memberCount: 1 })).toBe('Pose · 1 membre');
    expect(messageMembres('WORK_MEMBER_NOT_ELIGIBLE', 'x')).toContain('accès aux Projets');
    expect(messageMembres(null, 'repli')).toBe('repli');
  });
});
