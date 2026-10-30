import { describe, expect, it } from 'vitest';

import { demande } from './fixtures.test-utils';
import { historiqueDecisions, libelleEtape, nomDemandeur, vueAbsences } from './validations-model';

describe('absences à valider', () => {
  it('« toutes » exige `hr.read`, sinon « à valider »', () => {
    expect(vueAbsences('toutes', ['hr.read'])).toBe('toutes');
    expect(vueAbsences('toutes', ['leave.request'])).toBe('a-valider');
    expect(vueAbsences('a-valider', ['hr.read'])).toBe('a-valider');
    expect(vueAbsences(null, null)).toBe('a-valider');
  });

  it('étape et rang du circuit', () => {
    expect(libelleEtape(demande())).toBe('Étape : manager');
    expect(libelleEtape(demande({ steps: ['manager', 'hr'], currentStep: 'hr' }))).toBe(
      'Étape : ressources humaines (2 sur 2)',
    );
    expect(libelleEtape(demande({ status: 'approved' }))).toBeNull();
  });

  it('historique : suppléance et approbateur unique dits', () => {
    const h = historiqueDecisions(
      demande({
        approvals: [
          {
            step: 'manager',
            userId: 'u2',
            userName: 'Jean',
            decision: 'approved',
            at: '2026-10-30T09:00:00.000Z',
            comment: 'OK',
            soleApprover: false,
            onBehalfOfManager: true,
          },
        ],
      }),
      () => '30 oct. 2026',
    );
    expect(h).toEqual([
      'Validée par Jean (manager, en suppléance du manager) le 30 oct. 2026 — « OK »',
    ]);
  });

  it('nom du demandeur servi, sinon neutre', () => {
    expect(nomDemandeur(demande({ employeeName: 'Awa' }))).toBe('Awa');
    expect(nomDemandeur(demande())).toBe('Un collaborateur');
  });
});
