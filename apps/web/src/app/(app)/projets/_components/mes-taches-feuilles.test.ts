import {
  WORK_TIMESHEET_APPROVAL_KIND_LABEL,
  groupMyTasks,
  type WorkTimesheetMyTaskItem,
} from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import { estFeuilleTemps, sousTitreFeuilleTemps, titreFeuilleTemps } from './mes-taches-model';

const feuille: WorkTimesheetMyTaskItem = {
  source: 'work_timesheet',
  kind: 'timesheet_approval',
  id: `work:timesheet:${'a'.repeat(24)}:2026-11-16`,
  userId: 'a'.repeat(24),
  userName: 'Bea Kanku',
  week: '2026-11-16',
  totalMinutes: 450,
  dueDate: '2026-11-22',
  priority: 'none',
  rank: '2026-11-20T08:00:00.000Z',
  done: false,
  kindLabel: WORK_TIMESHEET_APPROVAL_KIND_LABEL,
  href: '/projets/mes-taches/temps?membre=x&semaine=2026-11-16',
};

describe('ADR-0077 § 4.6 — feuille de temps à valider dans « Mes tâches »', () => {
  it('se reconnaît par sa source, sans case à cocher', () => {
    expect(estFeuilleTemps(feuille)).toBe(true);
    expect(feuille.done).toBe(false);
  });

  it('titre : le membre ; sous-titre : la semaine et la durée rendue par l’API', () => {
    expect(titreFeuilleTemps(feuille)).toBe('Feuille de Bea Kanku');
    expect(sousTitreFeuilleTemps(feuille)).toBe('Semaine du 16/11 · 7 h 30');
    expect(sousTitreFeuilleTemps({ ...feuille, totalMinutes: 0 })).toBe(
      'Semaine du 16/11 · aucun temps saisi',
    );
  });

  it('se range au dimanche de la semaine', () => {
    const g = groupMyTasks([feuille], '2026-11-22', 1);
    expect(g.today.map((e) => e.id)).toEqual([feuille.id]);
  });
});
