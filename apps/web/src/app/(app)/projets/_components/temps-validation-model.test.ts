import type { TimesheetApprovalView } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import {
  ligneHistorique,
  lireParamsFeuille,
  pastilleSemaine,
  phraseValidation,
} from './temps-model';

const base: TimesheetApprovalView = {
  status: 'open',
  revision: 0,
  submittedAt: null,
  decidedAt: null,
  decidedBy: null,
  approvedMinutes: null,
  reason: null,
  locked: false,
  canSubmit: true,
  canDecide: false,
  canReopen: false,
  history: [],
};

describe('ADR-0077 § 4 — validation de la semaine (écran)', () => {
  it('pastilles : libellé et ton par état', () => {
    expect(pastilleSemaine({ status: 'approved' })).toEqual({ label: 'Validée', ton: 'ok' });
    expect(pastilleSemaine({ status: 'submitted' })).toEqual({ label: 'Soumise', ton: 'wait' });
    expect(pastilleSemaine({ status: 'returned' })).toEqual({ label: 'Renvoyée', ton: 'late' });
    expect(pastilleSemaine({ status: 'open' })).toEqual({ label: 'En cours', ton: 'draft' });
  });

  it('phrases : validateur et motif repris tels quels', () => {
    expect(
      phraseValidation({
        ...base,
        status: 'approved',
        decidedBy: { userId: 'u', name: 'Aline' },
      }),
    ).toBe('Semaine validée par Aline : les saisies sont verrouillées.');
    expect(phraseValidation({ ...base, status: 'returned', reason: 'Mardi manquant' })).toBe(
      'Semaine renvoyée : « Mardi manquant ». Corrigez puis soumettez de nouveau.',
    );
  });

  it('historique', () => {
    expect(
      ligneHistorique({
        action: 'reopened',
        at: '2026-11-20T09:00:00.000Z',
        by: { userId: 'u', name: 'Aline' },
        reason: 'Correction',
      }),
    ).toMatch(/^Rouverte par Aline, le .+ — « Correction »$/);
  });

  it('paramètres d’URL : membre et lundi, sinon ignorés', () => {
    const p = new URLSearchParams(`membre=${'A'.repeat(24)}&semaine=2026-11-16`);
    expect(lireParamsFeuille(p)).toEqual({ membre: 'a'.repeat(24), semaine: '2026-11-16' });
    expect(lireParamsFeuille(new URLSearchParams('membre=x&semaine=2026-11-17'))).toEqual({
      membre: '',
      semaine: undefined,
    });
  });
});
