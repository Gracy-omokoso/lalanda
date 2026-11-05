import type { WorkImportPreview, WorkPlanTask } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import {
  boutonImport,
  corpsCreation,
  fichierRefuse,
  formulaireIa,
  groupesRelecture,
  heures,
  hrefImportProjet,
  messagePlan,
  modifierTache,
  phraseApercu,
  preparerIa,
  problemesParLigne,
  retirerTache,
} from './import-model';

const apercu = (over: Partial<WorkImportPreview['counts']> = {}): WorkImportPreview => ({
  fileName: 'plan.csv',
  format: 'csv',
  rows: [],
  issues: [
    { row: 3, column: 'Échéance', severity: 'error', code: 'IMPORT_DATE_INVALID', message: 'x' },
    {
      row: 3,
      column: 'Responsable (e-mail)',
      severity: 'warning',
      code: 'IMPORT_ASSIGNEE_UNKNOWN',
      message: 'y',
    },
    { row: null, column: null, severity: 'error', code: 'IMPORT_TOO_MANY_ROWS', message: 'z' },
  ],
  counts: {
    rows: 12,
    valid: 10,
    invalid: 2,
    warnings: 3,
    milestones: 2,
    subtasks: 1,
    dependencies: 4,
    ...over,
  },
  newSections: ['Préparation'],
  newLabels: [],
  ignoredColumns: [],
});

describe('import : présentation de l’aperçu', () => {
  it('refuse localement les formats et tailles hors limites', () => {
    expect(fichierRefuse({ name: 'plan.pdf', size: 10 })).toMatch(/\.xlsx ou \.csv/);
    expect(fichierRefuse({ name: 'plan.XLSX', size: 3 * 1024 * 1024 })).toMatch(/2 Mo/);
    expect(fichierRefuse({ name: 'plan.csv', size: 10 })).toBeNull();
  });

  it('range les problèmes par ligne, le fichier entier à part', () => {
    const m = problemesParLigne(apercu().issues);
    expect(m.get(3)).toHaveLength(2);
    expect(m.get(null)).toHaveLength(1);
  });

  it('phrase et bouton : confirmation exigée s’il y a des lignes écartées', () => {
    expect(phraseApercu(apercu())).toBe(
      '10 tâches, dont 1 sous-tâche, 2 jalons, 4 dépendances ; à créer : 1 section (Préparation).',
    );
    expect(boutonImport(apercu())).toEqual({
      libelle: 'Importer les 10 lignes valides',
      confirmer: true,
      actif: true,
    });
    expect(boutonImport(apercu({ invalid: 0 }))).toMatchObject({
      libelle: 'Importer 10 tâches',
      confirmer: false,
    });
    expect(boutonImport(apercu({ valid: 0 })).actif).toBe(false);
  });

  it('heures lisibles et lien d’import d’un projet', () => {
    expect(heures(90)).toBe('1,5 h');
    expect(heures(120)).toBe('2 h');
    expect(heures(null)).toBe('—');
    expect(hrefImportProjet('abc')).toBe('/projets/importer?projet=abc');
  });

  it('message : celui du serveur pour les codes du parcours, sinon le message commun', () => {
    const e = (status: number, code: string, message: string) => ({
      status,
      detail: { code, message },
    });
    expect(messagePlan(e(422, 'IMPORT_HAS_ERRORS', '2 lignes…'), 'repli')).toBe('2 lignes…');
    expect(messagePlan(e(403, 'AI_QUOTA_EXCEEDED', 'Vous avez utilisé…'), 'repli')).toBe(
      'Vous avez utilisé…',
    );
    expect(messagePlan({ status: 413, detail: 'x' }, 'repli')).toBe('Le fichier dépasse 2 Mo.');
  });
});

describe('IA : formulaire et relecture', () => {
  it('formulaire : objectif et dates obligatoires, butoir après le début', () => {
    const f = formulaireIa('2026-11-05');
    const r = preparerIa(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.champs).sort()).toEqual(['dueDate', 'name', 'objective']);
    const ok = preparerIa({
      ...f,
      name: 'Site',
      objective: 'Mettre en ligne',
      dueDate: '2026-12-18',
    });
    expect(ok.ok).toBe(true);
    if (ok.ok)
      expect(ok.corps).toMatchObject({ context: null, sprintWeeks: 2, detail: 'standard' });
    const trop = preparerIa({
      ...f,
      name: 'X',
      objective: 'Y',
      dueDate: '2027-12-31',
      sprintWeeks: 1,
    });
    expect(trop.ok).toBe(false);
  });

  const tasks: WorkPlanTask[] = [
    { ref: 'T1', title: 'A', labels: ['Sprint 1'], startDate: '2026-11-09', dueDate: '2026-11-22' },
    { ref: 'T2', title: 'B', labels: ['Sprint 2', 'Design'], dependsOn: ['T1'] },
    { ref: 'J1', title: 'Fin', isMilestone: true, dueDate: '2026-12-18', dependsOn: ['T2'] },
  ];

  it('regroupe par sprint, jalons à part', () => {
    const g = groupesRelecture(
      {
        sprints: [
          {
            number: 1,
            label: 'Sprint 1',
            startDate: '2026-11-09',
            endDate: '2026-11-22',
            goal: '',
          },
          {
            number: 2,
            label: 'Sprint 2',
            startDate: '2026-11-23',
            endDate: '2026-12-06',
            goal: '',
          },
        ],
      },
      tasks,
    );
    expect(g.jalons.map((t) => t.ref)).toEqual(['J1']);
    expect(g.sprints.map((s) => s.taches.map((t) => t.ref))).toEqual([['T1'], ['T2']]);
  });

  it('retirer une tâche la retire des dépendances ; modifier garde les dates dans l’ordre', () => {
    const r = retirerTache(tasks, 'T2');
    expect(r.map((t) => t.ref)).toEqual(['T1', 'J1']);
    expect(r[1]!.dependsOn).toEqual([]);
    const m = modifierTache(tasks, 'T1', { dueDate: '2026-11-01', title: 'Cadrer' });
    expect(m[0]).toMatchObject({ title: 'Cadrer', startDate: '2026-11-01', dueDate: '2026-11-01' });
  });

  it('corps de création : origine IA, brouillon relié', () => {
    const f = { ...formulaireIa('2026-11-09'), name: ' Site ', dueDate: '2026-12-18' };
    const c = corpsCreation({ draftId: 'a'.repeat(24) }, f, 'Desc', tasks);
    expect(c).toMatchObject({
      origin: 'ai',
      aiDraftId: 'a'.repeat(24),
      project: { name: 'Site', kind: 'internal' },
    });
    expect(c.tasks).toHaveLength(3);
  });
});
