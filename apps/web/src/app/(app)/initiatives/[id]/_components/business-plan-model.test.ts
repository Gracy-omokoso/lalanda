import { describe, expect, it } from 'vitest';

import type { DraftResult } from '@/lib/business-plan-api';

import {
  avancement,
  empreinteCourte,
  etatValidation,
  libelleOrigine,
  messageBrouillon,
  statutDocument,
} from './business-plan-model';

const version = {
  version: 2,
  approvedAt: '2026-10-20T10:00:00.000Z',
  approvedBy: 'u',
  soleApprover: false,
  plan: { version: 1, fingerprint: 'f', approvedAt: '2026-10-12T10:00:00.000Z' },
  contentSha256: 'c',
};

describe('origine d’un texte', () => {
  it('dit qui a écrit, et rien pour une section vide', () => {
    expect(libelleOrigine({ origin: 'user', empty: false })).toBe('Rédigé par vous');
    expect(libelleOrigine({ origin: 'ai_accepted', empty: false })).toMatch(/IA, accepté/);
    expect(libelleOrigine({ origin: null, empty: true })).toBeNull();
  });
});

describe('statut du document', () => {
  it('brouillon jamais validé, validé, ou modifié depuis', () => {
    expect(statutDocument({ versions: [], changedSinceLastVersion: true }).libelle).toMatch(
      /jamais validé/,
    );
    expect(statutDocument({ versions: [version], changedSinceLastVersion: false })).toEqual({
      libelle: 'Validé — version 2',
      ton: 'success',
    });
    expect(statutDocument({ versions: [version], changedSinceLastVersion: true }).ton).toBe(
      'warning',
    );
  });
});

describe('brouillon de l’IA', () => {
  const base: DraftResult = {
    proposal: null,
    source: 'fallback',
    reason: null,
    detail: null,
    mention: '',
  };

  it('une proposition invite à relire avant d’accepter', () => {
    const r = messageBrouillon({
      ...base,
      source: 'llm',
      proposal: { text: 'x', sources: ['reponses'], generatedAt: '' },
    });
    expect(r.ton).toBe('success');
    expect(r.texte).toMatch(/relisez/);
  });

  it('un rejet du vérificateur le dit, avec son motif, et précise que rien n’est décompté', () => {
    const r = messageBrouillon({
      ...base,
      reason: 'rejetee',
      detail: 'chiffres absents des faits : 250 000',
    });
    expect(r.texte).toMatch(/250 000/);
    expect(r.texte).toMatch(/ni décompté/);
  });

  it('IA désactivée ou indisponible', () => {
    expect(messageBrouillon({ ...base, reason: 'desactivee_organisation' }).texte).toMatch(
      /désactivée pour votre organisation/,
    );
    expect(messageBrouillon({ ...base, reason: 'indisponible' }).ton).toBe('danger');
  });
});

describe('validation', () => {
  it('refusée au rôle sans plan.approve, sinon suit les blocages du serveur', () => {
    expect(
      etatValidation({ permissions: { write: true, validate: false, export: true }, blockers: [] })
        .possible,
    ).toBe(false);
    const bloque = etatValidation({
      permissions: { write: true, validate: true, export: true },
      blockers: [{ code: 'BUSINESS_PLAN_PENDING_AI', message: 'Propositions en attente.' }],
    });
    expect(bloque).toEqual({ possible: false, raisons: ['Propositions en attente.'] });
    expect(
      etatValidation({ permissions: { write: true, validate: true, export: true }, blockers: [] })
        .possible,
    ).toBe(true);
  });
});

it('avancement et empreinte abrégée', () => {
  expect(avancement([{ empty: false }, { empty: true }, { empty: false }])).toBe(
    '2 / 3 sections renseignées',
  );
  expect(empreinteCourte('abcdef0123456789')).toBe('abcdef012345…');
  expect(empreinteCourte(null)).toBe('—');
});
