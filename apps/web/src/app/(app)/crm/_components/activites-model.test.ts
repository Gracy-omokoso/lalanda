// Activités et relances — ADR-0040 § 3.5 et § 8.1.

import { describe, expect, it } from 'vitest';

import type { ActivityView } from '@/lib/api-crm';

import {
  FILTRES_ACTIVITES_INITIAUX,
  appliquerBascule,
  jourKinshasa,
  libelleEcheance,
  requeteActivites,
  tonActivite,
} from './activites-model';

const A = (p: Partial<ActivityView>): ActivityView => ({
  id: 'x',
  kind: 'follow_up',
  kindLabel: 'Relance',
  subject: 'Rappeler',
  notes: null,
  dueAt: '2026-10-30T22:59:59.000Z',
  done: false,
  doneAt: null,
  overdue: false,
  opportunityId: null,
  contactId: null,
  customerId: null,
  accountId: null,
  assigneeUserId: 'u1',
  dueDay: '2026-10-30',
  revision: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...p,
});

describe('Activités', () => {
  it('jour de Kinshasa : 23 h 30 UTC est déjà le lendemain', () => {
    expect(jourKinshasa(new Date('2026-10-29T23:30:00Z'))).toBe('2026-10-30');
    expect(jourKinshasa(new Date('2026-10-29T22:30:00Z'))).toBe('2026-10-29');
  });

  it('filtres → requête ; « les miennes » par défaut', () => {
    expect(requeteActivites(FILTRES_ACTIVITES_INITIAUX, '2026-10-30')).toEqual({
      limit: 50,
      assignee: 'me',
      status: 'open',
    });
    expect(requeteActivites({ statut: 'a_venir', miennes: false }, '2026-10-30', 'c')).toEqual({
      limit: 50,
      cursor: 'c',
      status: 'open',
      dueFrom: '2026-10-30',
    });
    expect(requeteActivites({ statut: 'en_retard', miennes: true }, 'j').status).toBe('overdue');
    expect(requeteActivites({ statut: 'faites', miennes: true }, 'j').status).toBe('done');
    expect(requeteActivites({ statut: 'toutes', miennes: true }, 'j').status).toBe('all');
  });

  it('échéance et ton : aujourd’hui, en retard (selon l’API), faite, note', () => {
    expect(libelleEcheance(A({}), '2026-10-30')).toBe('Aujourd’hui');
    expect(tonActivite(A({}), '2026-10-30')).toBe('aujourdhui');
    const retard = A({ dueDay: '2026-10-20', overdue: true });
    expect(libelleEcheance(retard, '2026-10-30')).toMatch(/^En retard — 20 oct/);
    expect(tonActivite(retard, '2026-10-30')).toBe('retard');
    expect(tonActivite(A({ done: true }), '2026-10-30')).toBe('faite');
    expect(libelleEcheance(A({ kind: 'note', dueDay: null }), '2026-10-30')).toBe('Note');
    expect(libelleEcheance(A({ kind: 'call', dueDay: null }), '2026-10-30')).toBe('Sans échéance');
    expect(libelleEcheance(A({ dueDay: '2027-01-05' }), '2026-10-30')).toMatch(/2027/);
    expect(tonActivite(A({ dueDay: '2026-11-02' }), '2026-10-30')).toBe('neutre');
  });

  it('cocher retire de « à faire », rouvrir retire de « faites », « toutes » remplace', () => {
    const liste = [A({ id: '1' }), A({ id: '2' })];
    const faite = A({ id: '1', done: true });
    expect(appliquerBascule(liste, faite, 'a_faire').map((a) => a.id)).toEqual(['2']);
    expect(appliquerBascule(liste, faite, 'toutes')[0]?.done).toBe(true);
    expect(appliquerBascule([faite], A({ id: '1' }), 'faites')).toEqual([]);
  });
});
