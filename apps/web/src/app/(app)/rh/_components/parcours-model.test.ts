// Entrées et sorties (ADR-0045 § 2.9, § 3.1) — lot H7.
import { describe, expect, it } from 'vitest';

import type { ChecklistTemplateView } from '@/lib/api-hr-admin';

import {
  avancement,
  confirmationAnonymisation,
  etatElement,
  libelleDecalage,
  modelesProposes,
  peutCocher,
  peutDemanderAnonymisation,
  peutReintegrer,
  validerSortie,
} from './parcours-model';

describe('sortie', () => {
  it('date requise, pas avant l’entrée, nature requise', () => {
    const fiche = { startDate: '2025-01-01', revision: 4 };
    expect(validerSortie({ endDate: '', exitCategory: '' }, fiche)).toMatchObject({ ok: false });
    expect(
      validerSortie({ endDate: '2024-12-31', exitCategory: 'resignation' }, fiche),
    ).toMatchObject({ ok: false, erreurs: { endDate: expect.stringMatching(/précéder/) } });
    expect(validerSortie({ endDate: '2026-11-30', exitCategory: 'resignation' }, fiche)).toEqual({
      ok: true,
      corps: { endDate: '2026-11-30', exitCategory: 'resignation', expectedRevision: 4 },
    });
  });

  it('réintégration tant que la sortie est future', () => {
    expect(peutReintegrer({ status: 'exited', endDate: '2026-11-30' }, '2026-10-30')).toBe(true);
    expect(peutReintegrer({ status: 'exited', endDate: '2026-10-01' }, '2026-10-30')).toBe(false);
    expect(peutReintegrer({ status: 'active', endDate: null }, '2026-10-30')).toBe(false);
  });
});

describe('anonymisation', () => {
  it('confirmation forte : le nom retapé à l’identique', () => {
    expect(confirmationAnonymisation('Aline Mbuyi', 'Aline Mbuyi')).toBe(true);
    expect(confirmationAnonymisation(' Aline Mbuyi ', 'Aline Mbuyi')).toBe(true);
    expect(confirmationAnonymisation('aline mbuyi', 'Aline Mbuyi')).toBe(false);
    expect(confirmationAnonymisation('', '')).toBe(false);
  });

  it('collaborateur sorti, hr.manage ET hr.sensitive.read', () => {
    const tous = ['hr.manage', 'hr.sensitive.read'] as const;
    expect(peutDemanderAnonymisation([...tous], { status: 'exited' })).toBe(true);
    expect(peutDemanderAnonymisation([...tous], { status: 'active' })).toBe(false);
    expect(peutDemanderAnonymisation(['hr.manage'], { status: 'exited' })).toBe(false);
  });
});

describe('listes', () => {
  const modele = (id: string, kind: 'onboarding' | 'offboarding', label: string) =>
    ({
      id,
      kind,
      label,
      items: [],
      isDefault: false,
      revision: 1,
      updatedAt: '',
    }) as ChecklistTemplateView;

  it('la liste de départ d’abord pour un sorti', () => {
    const m = [modele('a', 'onboarding', 'Accueil'), modele('b', 'offboarding', 'Départ')];
    expect(modelesProposes(m, { status: 'exited' }).map((x) => x.id)).toEqual(['b', 'a']);
    expect(modelesProposes(m, { status: 'active' }).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('avancement et état en texte, comptes de l’API', () => {
    expect(avancement({ done: 1, total: 4 })).toBe('1 sur 4 fait');
    expect(avancement({ done: 3, total: 4 })).toBe('3 sur 4 faits');
    expect(etatElement({ doneAt: null, dueDate: '2026-10-01' }, '2026-10-30')).toEqual({
      texte: 'En retard — prévu le 1 oct. 2026',
      retard: true,
    });
    expect(
      etatElement({ doneAt: '2026-10-02T10:00:00Z', dueDate: '2026-10-01' }, '2026-10-30').texte,
    ).toBe('Fait le 2 oct. 2026');
  });

  it('cocher : l’assigné ou hr.manage', () => {
    expect(peutCocher(['leave.request'], { assigneeUserId: 'u1' }, 'u1')).toBe(true);
    expect(peutCocher(['leave.request'], { assigneeUserId: 'u2' }, 'u1')).toBe(false);
    expect(peutCocher(['hr.manage'], { assigneeUserId: 'u2' }, null)).toBe(true);
  });

  it('décalage d’un élément de modèle en mots', () => {
    expect(libelleDecalage(-3, 'onboarding')).toBe('3 jours avant l’entrée');
    expect(libelleDecalage(0, 'offboarding')).toBe('le jour de la sortie');
    expect(libelleDecalage(1, 'offboarding')).toBe('1 jour après la sortie');
  });
});
