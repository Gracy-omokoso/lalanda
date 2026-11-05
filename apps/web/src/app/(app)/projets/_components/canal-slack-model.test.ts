import { describe, expect, it } from 'vitest';

import { etatCanalSlack, valeurCanalSaisi } from './canal-slack-model';

const base = {
  connected: true,
  projectPrivate: false,
  channel: {
    id: 'C0123456',
    name: 'projets',
    privateConfirmed: false,
    setAt: '2026-11-05T10:00:00Z',
  },
  publishing: true,
  canManage: true,
};

describe('canal Slack d’un projet (ADR-0064)', () => {
  it('états affichés', () => {
    expect(etatCanalSlack({ ...base, connected: false, publishing: false }).libelle).toBe(
      'Slack non connecté',
    );
    expect(etatCanalSlack({ ...base, channel: null, publishing: false }).libelle).toBe(
      'Aucun canal',
    );
    expect(etatCanalSlack(base)).toMatchObject({ ton: 'ok', libelle: 'Publie' });
    const prive = etatCanalSlack({ ...base, projectPrivate: true, publishing: false });
    expect(prive.libelle).toBe('En pause');
    expect(prive.avertissement).toContain('privé');
  });

  it('saisie : seuls les identifiants de canal public', () => {
    expect(valeurCanalSaisi(' c0123abcd ')).toBe('C0123ABCD');
    expect(valeurCanalSaisi('G0123ABCD')).toBeNull();
    expect(valeurCanalSaisi('#general')).toBeNull();
  });
});
