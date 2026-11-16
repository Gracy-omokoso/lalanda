import { describe, expect, it } from 'vitest';

import {
  OPTIONS_STATUT,
  TONS_STATUT,
  corpsStatut,
  resumeStatut,
  statutDeclareAffiche,
} from './statut-model';

describe('statut déclaré du projet (ADR-0076 § 5)', () => {
  it('quatre statuts dans l’ordre, chacun son ton', () => {
    expect(OPTIONS_STATUT.map((o) => o.label)).toEqual([
      'Dans les temps',
      'À risque',
      'En retard',
      'Terminé',
    ]);
    expect(TONS_STATUT.off_track).toBe('late');
  });

  it('résumé daté et signé', () => {
    expect(
      resumeStatut({ status: 'at_risk', date: '2026-11-16', author: { userId: 'u', name: 'Awa' } }),
    ).toBe('À risque · 16/11/2026 · Awa');
  });

  it('corps : texte obligatoire, date facultative', () => {
    expect(corpsStatut({ status: 'on_track', text: '   ', date: '' })).toBeNull();
    expect(corpsStatut({ status: 'on_track', text: ' OK ', date: '' })).toEqual({
      status: 'on_track',
      text: 'OK',
    });
    expect(corpsStatut({ status: 'done', text: 'Livré', date: '2026-11-15' })).toEqual({
      status: 'done',
      text: 'Livré',
      date: '2026-11-15',
    });
  });

  it('pastille du portefeuille, rien sans statut', () => {
    expect(statutDeclareAffiche(null)).toBeNull();
    const p = statutDeclareAffiche({
      id: 's',
      projectId: 'p',
      status: 'off_track',
      text: 'Retard du client',
      date: '2026-11-16',
      author: { userId: 'u', name: 'Awa' },
      createdAt: '2026-11-16T08:00:00.000Z',
    });
    expect(p?.libelle).toBe('Déclaré : En retard');
    expect(p?.ton).toBe('late');
    expect(p?.titre).toContain('Retard du client');
  });
});
