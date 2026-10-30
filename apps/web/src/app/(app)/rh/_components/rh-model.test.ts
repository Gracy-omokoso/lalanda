import { describe, expect, it } from 'vitest';

import type { OrgAction } from '@/lib/api';

import { demande, employe } from './fixtures.test-utils';
import {
  PHRASE_PAS_ENCORE,
  destinationRh,
  etapeEnAttente,
  formatJours,
  initiales,
  libellePeriode,
  libelleStatutCollaborateur,
  libelleType,
  messageRh,
  nomAffiche,
  peutEntrerRh,
} from './rh-model';

describe('droits RH (actions, jamais le rôle)', () => {
  it('entrée avec `leave.request` ou `hr.read`', () => {
    expect(peutEntrerRh(['leave.request'])).toBe(true);
    expect(peutEntrerRh(['hr.read'])).toBe(true);
    expect(peutEntrerRh(['work.read'])).toBe(false);
    expect(peutEntrerRh(null)).toBe(false);
  });

  it('sans `hr.read`, on arrive sur Mon espace ; avec, sur les collaborateurs', () => {
    expect(destinationRh(['leave.request'])).toBe('/rh/moi');
    expect(destinationRh(['leave.request', 'hr.read'] as OrgAction[])).toBe('/rh/collaborateurs');
  });
});

describe('mise en forme, sans calcul', () => {
  it('durées de l’API en français', () => {
    expect(formatJours('2.50')).toBe('2,5 jours');
    expect(formatJours('3.50')).toBe('3,5 jours');
    expect(formatJours('1.00')).toBe('1 jour');
    expect(formatJours('0.50')).toBe('0,5 jour');
    expect(formatJours('12.25')).toBe('12,25 jours');
    expect(formatJours('-1.00')).toBe('-1 jour');
    expect(formatJours(null)).toBe('—');
    expect(formatJours('abc')).toBe('abc');
  });

  it('périodes avec demi-journées', () => {
    expect(
      libellePeriode({ date: '2026-11-03', half: 'full' }, { date: '2026-11-03', half: 'full' }),
    ).toBe('le 3 nov. 2026');
    expect(
      libellePeriode({ date: '2026-11-03', half: 'am' }, { date: '2026-11-03', half: 'am' }),
    ).toBe('le 3 nov. 2026 (matin)');
    expect(
      libellePeriode({ date: '2026-11-02', half: 'pm' }, { date: '2026-11-06', half: 'am' }),
    ).toBe('du 2 nov. (après-midi) au 6 nov. 2026 (matin)');
    expect(
      libellePeriode({ date: '2026-12-30', half: 'full' }, { date: '2027-01-02', half: 'full' }),
    ).toBe('du 30 déc. 2026 au 2 janv. 2027');
  });

  it('nom d’usage d’abord, initiales décoratives', () => {
    expect(nomAffiche(employe())).toBe('Awa Mbuyi');
    expect(nomAffiche(employe({ preferredName: 'Awa M.' }))).toBe('Awa M.');
    expect(initiales('Awa Kalala Mbuyi')).toBe('AM');
    expect(initiales('Awa')).toBe('A');
  });

  it('un type masqué reste « Absent »', () => {
    expect(libelleType({ typeLabel: 'Maladie', masked: true })).toBe('Absent');
    expect(libelleType({ typeLabel: 'Congés' })).toBe('Congés');
  });
});

describe('étape en attente', () => {
  it('celle servie par l’API, sinon la première sans décision', () => {
    expect(etapeEnAttente(demande({ steps: ['manager', 'hr'] }))).toBe('manager');
    expect(
      etapeEnAttente(
        demande({
          steps: ['manager', 'hr'],
          approvals: [
            {
              step: 'manager',
              userId: 'u2',
              decision: 'approved',
              at: '2026-10-30T09:00:00.000Z',
              comment: null,
              soleApprover: false,
              onBehalfOfManager: false,
            },
          ],
        }),
      ),
    ).toBe('hr');
    expect(etapeEnAttente(demande({ currentStep: 'hr' }))).toBe('hr');
    expect(etapeEnAttente(demande({ status: 'approved' }))).toBeNull();
  });
});

describe('erreurs', () => {
  it('codes de l’ADR traduits, 404 dit « pas encore disponible »', () => {
    expect(messageRh({ status: 409, detail: { code: 'LEAVE_OVERLAP' } }, 'x')).toMatch(
      /couvre déjà/,
    );
    expect(messageRh({ status: 409, detail: { code: 'SELF_APPROVAL_FORBIDDEN' } }, 'x')).toMatch(
      /propre absence/,
    );
    expect(messageRh({ status: 404, detail: 'Cannot GET /hr/me' }, 'x')).toBe(PHRASE_PAS_ENCORE);
    expect(messageRh({ status: 403 }, 'x')).toMatch(/rôle/);
    expect(messageRh({ status: 500, detail: { message: 'Panne' } }, 'x')).toBe('Panne');
    expect(messageRh('bizarre', 'repli')).toBe('repli');
  });
});

describe('statut d’un collaborateur', () => {
  it('statuts stockés et dérivés servis par l’API', () => {
    expect(libelleStatutCollaborateur(employe()).texte).toBe('Actif');
    expect(libelleStatutCollaborateur(employe({ onProbation: true })).texte).toBe(
      'Période d’essai',
    );
    expect(libelleStatutCollaborateur(employe({ upcoming: true })).texte).toBe('À venir');
    expect(libelleStatutCollaborateur(employe({ status: 'exited' })).texte).toBe('Sorti');
  });
});
