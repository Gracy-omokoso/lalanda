import type { ProjectMarginView } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import { constatsTempsValide } from './marge-model';

const vue = (timeApproval?: ProjectMarginView['timeApproval']): ProjectMarginView => ({
  projectId: 'p',
  version: '1.4.0',
  from: null,
  to: null,
  currencies: [],
  findings: [],
  minutesWithoutRate: 0,
  byMember: null,
  ...(timeApproval ? { timeApproval } : {}),
});

describe('ADR-0077 § 4.5 — part du temps validé (informative)', () => {
  it('une phrase quand du temps est saisi', () => {
    expect(constatsTempsValide(vue({ totalMinutes: 150, approvedMinutes: 60 }))).toEqual([
      {
        code: 'TIME_APPROVAL_SHARE',
        ton: 'info',
        texte:
          'Temps validé : 1 h sur 2 h 30 saisies (feuilles de temps validées). Tout le temps saisi compte dans la marge.',
      },
    ]);
  });

  it('rien sans la donnée ni sans temps saisi', () => {
    expect(constatsTempsValide(vue())).toEqual([]);
    expect(constatsTempsValide(vue({ totalMinutes: 0, approvedMinutes: 0 }))).toEqual([]);
  });
});
