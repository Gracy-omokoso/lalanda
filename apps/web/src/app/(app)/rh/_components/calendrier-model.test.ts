import { describe, expect, it } from 'vitest';

import type { HrCalendarView } from '@/lib/api-hr';

import {
  demiDuJour,
  grillePersonnes,
  listeParJour,
  periode,
  porteesProposees,
  texteCase,
} from './calendrier-model';

const jours = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];

const vue: HrCalendarView = {
  from: '2026-11-02',
  to: '2026-11-06',
  entries: [
    {
      requestId: 'r1',
      employeeId: 'b',
      employeeName: 'Bruno',
      status: 'approved',
      start: { date: '2026-11-02', half: 'pm' },
      end: { date: '2026-11-04', half: 'am' },
      typeId: null,
      label: 'Absent',
      masked: true,
    },
    {
      requestId: 'r2',
      employeeId: 'a',
      status: 'pending',
      start: { date: '2026-11-06', half: 'full' },
      end: { date: '2026-11-06', half: 'full' },
      typeId: 't1',
      label: 'Congés',
      masked: false,
    },
  ],
  holidays: [{ date: '2026-11-05', halfDay: null, label: 'Fermeture' }],
  employees: [{ id: 'a', name: 'Awa' }],
};

describe('calendrier des absences', () => {
  it('demi-journées posées d’après les bornes de l’API', () => {
    const e = vue.entries[0]!;
    expect(jours.map((j) => demiDuJour(e, j))).toEqual(['pm', 'full', 'am', null, null]);
    expect(
      demiDuJour(
        { start: { date: '2026-11-03', half: 'am' }, end: { date: '2026-11-03', half: 'am' } },
        '2026-11-03',
      ),
    ).toBe('am');
  });

  it('grille personnes × jours, triée par nom ; un type masqué reste « Absent »', () => {
    const g = grillePersonnes(vue, jours);
    expect(g.map((l) => l.nom)).toEqual(['Awa', 'Bruno']);
    expect(g[1]!.cases.map((c) => c?.demi ?? null)).toEqual(['pm', 'full', 'am', null, null]);
    expect(g[1]!.cases[1]!.libelle).toBe('Absent');
    expect(g[0]!.cases[4]).toEqual({
      requestId: 'r2',
      demi: 'full',
      statut: 'pending',
      libelle: 'Congés',
    });
  });

  it('liste du téléphone : seulement les jours avec une absence ou un férié', () => {
    const l = listeParJour(vue, jours);
    expect(l.map((j) => j.date)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ]);
    expect(l[3]!.ferie?.libelle).toBe('Fermeture');
    expect(l[3]!.absences).toEqual([]);
    expect(l[0]!.titre).toBe('lundi 2 nov. 2026');
  });

  it('texte lisible d’une case (lecteurs d’écran)', () => {
    expect(
      texteCase('Awa', '2026-11-06', {
        requestId: 'r2',
        demi: 'am',
        statut: 'pending',
        libelle: 'Congés',
      }),
    ).toBe('Awa, vendredi 6 nov. 2026 : Congés (matin), en attente de validation');
  });

  it('portées : service par défaut, équipe aux managers, organisation à `hr.read`', () => {
    expect(porteesProposees({ isManager: false, lireRh: false })).toEqual(['me', 'department']);
    expect(porteesProposees({ isManager: true, lireRh: true })).toEqual([
      'me',
      'team',
      'department',
      'organization',
    ]);
  });

  it('période du mois en semaines complètes', () => {
    const p = periode('mois', '2026-11-15');
    expect(p.debut).toBe('2026-10-26');
    expect(p.semaines.every((s) => s.length === 7)).toBe(true);
  });
});
