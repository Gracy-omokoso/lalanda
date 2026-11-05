import { defaultWorkNotificationPreferences, type WorkSettingsView } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import {
  basculerCanal,
  basculerJour,
  corpsComportement,
  corpsPreferences,
  createurs,
  libelleHeure,
  libelleEtatSlack,
  ongletParametres,
  ongletsVisibles,
  retourSlack,
  toutLeCanal,
} from './parametres-model';

const reglages: WorkSettingsView = {
  labels: [{ key: 'u', label: 'Urgent', color: 'red' }],
  defaultColumns: [
    { key: 'todo', label: 'À faire', category: 'todo' },
    { key: 'done', label: 'Terminé', category: 'done' },
  ],
  dueSoonDays: 1,
  projectCreatorRoles: null,
  defaultVisibility: 'organization',
  defaultView: 'overview',
  workingDays: [1, 2, 3, 4, 5],
  autoArchiveCompletedDays: null,
  managersModerateComments: true,
  showTaskNumbers: true,
  revision: 3,
  updatedAt: null,
};

describe('paramètres des Projets (ADR-0061)', () => {
  it('onglets : le comportement est réservé aux gestionnaires', () => {
    expect(ongletParametres('comportement', true)).toBe('comportement');
    expect(ongletParametres('comportement', false)).toBe('notifications');
    expect(ongletParametres(null, true)).toBe('notifications');
  });

  it('mes notifications : bascule et corps', () => {
    const p = defaultWorkNotificationPreferences();
    const q = basculerCanal(p, 'mentioned', 'email');
    expect(q.events.mentioned).toEqual({ bell: true, email: false, slack: true });
    expect(p.events.mentioned.email).toBe(true); // immuable
    const sans = toutLeCanal(p, 'email', false);
    expect(Object.values(sans.events).every((c) => !c.email && c.bell)).toBe(true);
    expect(corpsPreferences(q, 2)).toEqual({
      expectedRevision: 2,
      events: q.events,
      digest: q.digest,
    });
    expect(libelleHeure(7)).toBe('07 h 00');
  });

  it('Slack (ADR-0064) : onglet réservé à la direction, colonne Slack, retours OAuth', () => {
    expect(ongletParametres('slack', true, false)).toBe('notifications');
    expect(ongletParametres('slack', false, true)).toBe('slack');
    expect(ongletsVisibles(true, false).map((o) => o.id)).toEqual([
      'notifications',
      'comportement',
    ]);
    expect(ongletsVisibles(false, true).map((o) => o.id)).toEqual(['notifications', 'slack']);
    const p = defaultWorkNotificationPreferences();
    expect(p.events.task_assigned.slack).toBe(true);
    expect(p.events.task_overdue.slack).toBe(false);
    expect(basculerCanal(p, 'task_overdue', 'slack').events.task_overdue.slack).toBe(true);
    expect(Object.values(toutLeCanal(p, 'slack', false).events).every((c) => !c.slack)).toBe(true);
    expect(retourSlack(null)).toBeNull();
    expect(retourSlack('connecte')?.ton).toBe('succes');
    expect(retourSlack('erreur-session')?.message).toContain('même session');
    expect(retourSlack('n-importe-quoi')?.ton).toBe('erreur');
    expect(libelleEtatSlack('reconnect_required')).toBe('À reconnecter');
  });

  it('comportement : les réglages existants sont repris tels quels', () => {
    const c = corpsComportement(reglages, { defaultView: 'board', autoArchiveCompletedDays: 30 });
    expect(c.labels).toEqual(reglages.labels);
    expect(c.defaultColumns).toEqual(reglages.defaultColumns);
    expect(c.expectedRevision).toBe(3);
    expect(c.defaultView).toBe('board');
    expect(c.autoArchiveCompletedDays).toBe(30);
    expect(
      corpsComportement(reglages, { autoArchiveCompletedDays: null }).autoArchiveCompletedDays,
    ).toBeNull();
  });

  it('jours ouvrés : jamais vides, triés', () => {
    expect(basculerJour([1, 2, 3, 4, 5], 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(basculerJour([3], 3)).toEqual([3]);
    expect(basculerJour([5, 1], 3)).toEqual([1, 3, 5]);
  });

  it('créateurs : tous cochés → null (tous les gestionnaires)', () => {
    expect(createurs(null, 'finance_director', false)).toEqual(['owner', 'admin', 'team_manager']);
    expect(createurs(['owner', 'admin', 'team_manager'], 'finance_director', true)).toBeNull();
    // ADR-0059 : le Manager / Chef d'équipe se décoche comme les autres.
    expect(createurs(null, 'team_manager', false)).toEqual(['owner', 'admin', 'finance_director']);
  });
});
