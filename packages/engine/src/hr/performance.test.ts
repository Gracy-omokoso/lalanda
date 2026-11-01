// Objectifs et évaluations (ADR-0051 § 2.5, § 2.6, § 3.5). Le moteur compte des
// statuts ; il ne calcule aucune note. Propriétés à graine fixe, rejouables.

import { describe, expect, it } from 'vitest';

import {
  GOAL_STATUSES,
  HR_VERSION,
  REVIEW_STATUSES,
  checkRating,
  checkReviewTemplate,
  goalTransition,
  reviewProgress,
  reviewTransition,
  type ReviewSectionInput,
  type ReviewStatus,
} from '../index.js';
import * as performance from './performance.js';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const pick = <T>(r: () => number, items: readonly T[]): T =>
  items[Math.floor(r() * items.length)] as T;

describe('checkReviewTemplate', () => {
  it('modèle vide proposé par Lalanda : titres seulement, sans échelle', () => {
    const r = checkReviewTemplate({
      sections: [
        { id: 'bilan', title: 'Bilan de la période', kind: 'text' },
        { id: 'objectifs', title: 'Objectifs', kind: 'goals' },
        { id: 'formation', title: 'Besoins de formation', kind: 'text' },
        { id: 'commentaire', title: 'Commentaire du collaborateur', kind: 'text' },
      ],
    });
    expect(r).toEqual({ version: HR_VERSION, ok: true, issues: [] });
  });

  it('échelle saisie par l’organisation', () => {
    expect(
      checkReviewTemplate({
        sections: [
          {
            id: 'q',
            title: 'Qualité',
            kind: 'scale',
            scale: { min: 1, max: 4, labels: ['a', 'b', 'c', 'd'] },
          },
        ],
      }).ok,
    ).toBe(true);
  });

  it('contrôles', () => {
    const sections: ReviewSectionInput[] = [
      { id: 'a', title: 'A', kind: 'scale' },
      { id: 'a', title: ' ', kind: 'text' },
      { id: 'c', title: 'C', kind: 'text', scale: { min: 1, max: 5 } },
      { id: 'd', title: 'D', kind: 'scale', scale: { min: 5, max: 5 } },
      { id: 'e', title: 'E', kind: 'scale', scale: { min: 1, max: 3, labels: ['x'] } },
      { id: 'f', title: 'F', kind: 'rating' as never },
      { id: 'g', title: 'G', kind: 'scale', scale: { min: 0.5, max: 3 } },
    ];
    expect(checkReviewTemplate({ sections }).issues).toEqual([
      { sectionIndex: 0, code: 'REVIEW_TEMPLATE_SCALE_MISSING' },
      { sectionIndex: 1, code: 'REVIEW_TEMPLATE_SECTION_ID_DUPLICATE' },
      { sectionIndex: 1, code: 'REVIEW_TEMPLATE_SECTION_TITLE' },
      { sectionIndex: 2, code: 'REVIEW_TEMPLATE_SCALE_UNEXPECTED' },
      { sectionIndex: 3, code: 'REVIEW_TEMPLATE_SCALE_INVALID' },
      { sectionIndex: 4, code: 'REVIEW_TEMPLATE_SCALE_LABELS' },
      { sectionIndex: 5, code: 'REVIEW_TEMPLATE_SECTION_KIND' },
      { sectionIndex: 6, code: 'REVIEW_TEMPLATE_SCALE_INVALID' },
    ]);
    expect(checkReviewTemplate({ sections: [] }).issues).toEqual([
      { sectionIndex: null, code: 'REVIEW_TEMPLATE_SECTION_COUNT' },
    ]);
    const many = Array.from({ length: 21 }, (_, i) => ({
      id: `s${i}`,
      title: 'T',
      kind: 'text' as const,
    }));
    expect(checkReviewTemplate({ sections: many }).issues).toEqual([
      { sectionIndex: null, code: 'REVIEW_TEMPLATE_SECTION_COUNT' },
    ]);
  });
});

describe('checkRating', () => {
  const s: ReviewSectionInput = { id: 'q', title: 'Q', kind: 'scale', scale: { min: 1, max: 4 } };
  it('valeur choisie dans l’échelle, entière', () => {
    expect([0, 1, 2.5, 4, 5, '3', null].map((v) => checkRating(s, v))).toEqual([
      false,
      true,
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(checkRating({ id: 't', title: 'T', kind: 'text' }, 1)).toBe(false);
  });
  it('aucune fonction de moyenne, de note globale ni de classement n’est exportée', () => {
    const names = Object.keys(performance).join(' ');
    expect(names).not.toMatch(/average|mean|score|rank|overall|weighted/i);
  });
});

describe('reviewTransition', () => {
  const withSelf = { includesSelfAssessment: true };
  const noSelf = { includesSelfAssessment: false };
  it('circuit complet avec auto-évaluation', () => {
    const path: ReviewStatus[] = [
      'not_started',
      'self_submitted',
      'manager_submitted',
      'shared',
      'acknowledged',
      'closed',
    ];
    for (let i = 0; i + 1 < path.length; i += 1) {
      expect(
        reviewTransition(path[i] as ReviewStatus, path[i + 1] as ReviewStatus, withSelf),
      ).toEqual({
        version: HR_VERSION,
        ok: true,
        unsigned: false,
      });
    }
    expect(reviewTransition('not_started', 'manager_submitted', withSelf).ok).toBe(false);
  });
  it('sans auto-évaluation : l’évaluateur rédige d’emblée', () => {
    expect(reviewTransition('not_started', 'manager_submitted', noSelf).ok).toBe(true);
    expect(reviewTransition('not_started', 'self_submitted', noSelf).ok).toBe(false);
  });
  it('clôture d’une évaluation partagée non signée : marquée « non signée »', () => {
    expect(reviewTransition('shared', 'closed', withSelf)).toEqual({
      version: HR_VERSION,
      ok: true,
      unsigned: true,
    });
  });
  it('pas de retour arrière, états finaux figés', () => {
    expect(reviewTransition('shared', 'manager_submitted', withSelf).ok).toBe(false);
    for (const to of REVIEW_STATUSES) {
      expect(reviewTransition('closed', to, withSelf).ok).toBe(false);
      expect(reviewTransition('cancelled', to, withSelf).ok).toBe(false);
    }
    expect(() => reviewTransition('done' as never, 'closed', withSelf)).toThrow(RangeError);
  });
});

describe('goalTransition', () => {
  it('proposé → convenu → statut final posé par une personne', () => {
    expect(goalTransition('proposed', 'agreed')).toEqual({ version: HR_VERSION, ok: true });
    expect(goalTransition('proposed', 'achieved').ok).toBe(false);
    for (const to of ['achieved', 'partially_achieved', 'not_achieved', 'dropped'] as const) {
      expect(goalTransition('agreed', to).ok).toBe(true);
      for (const next of GOAL_STATUSES) expect(goalTransition(to, next).ok).toBe(false);
    }
    expect(() => goalTransition('proposed', 'late' as never)).toThrow(RangeError);
  });
});

describe('reviewProgress', () => {
  it('décompte des statuts, sans contenu ni note', () => {
    const reviews = [
      { id: '1', status: 'not_started' as const },
      { id: '2', status: 'self_submitted' as const },
      { id: '3', status: 'shared' as const },
      { id: '4', status: 'acknowledged' as const },
      { id: '5', status: 'closed' as const },
      { id: '6', status: 'cancelled' as const },
    ];
    expect(reviewProgress(reviews, { includesSelfAssessment: true })).toEqual({
      version: HR_VERSION,
      total: 5,
      cancelled: 1,
      counts: {
        not_started: 1,
        self_submitted: 1,
        manager_submitted: 0,
        shared: 1,
        acknowledged: 1,
        closed: 1,
        cancelled: 1,
      },
      awaitingSelf: 1,
      awaitingManager: 1,
      awaitingAcknowledgement: 1,
      awaitingClose: 1,
      closed: 1,
    });
    expect(reviewProgress(reviews, { includesSelfAssessment: false })).toMatchObject({
      awaitingSelf: 0,
      awaitingManager: 2,
    });
  });

  it('entrées invalides', () => {
    expect(() =>
      reviewProgress([{ id: '1', status: 'x' as never }], { includesSelfAssessment: true }),
    ).toThrow(RangeError);
    expect(() =>
      reviewProgress(
        [
          { id: '1', status: 'closed' },
          { id: '1', status: 'closed' },
        ],
        { includesSelfAssessment: true },
      ),
    ).toThrow(RangeError);
  });

  it(
    'propriété : chaque évaluation comptée une fois ; les attentes partitionnent les non-annulées',
    { timeout: 120_000 },
    () => {
      const r = rng(16);
      for (let run = 0; run < 1_000; run += 1) {
        const n = Math.floor(r() * 60);
        const reviews = Array.from({ length: n }, (_, i) => ({
          id: `r${i}`,
          status: pick(r, REVIEW_STATUSES),
        }));
        for (const includesSelfAssessment of [true, false]) {
          const p = reviewProgress(reviews, { includesSelfAssessment });
          expect(Object.values(p.counts).reduce((s, c) => s + c, 0)).toBe(n);
          expect(p.total + p.cancelled).toBe(n);
          expect(
            p.awaitingSelf +
              p.awaitingManager +
              p.counts.manager_submitted +
              p.awaitingAcknowledgement +
              p.awaitingClose +
              p.closed,
          ).toBe(p.total);
        }
      }
    },
  );
});
