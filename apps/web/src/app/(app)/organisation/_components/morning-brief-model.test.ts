import { describe, expect, it } from 'vitest';

import type { BriefAnswerView, BriefFactView } from '@/lib/morning-brief-api';

import {
  formatDecimalFr,
  libelleSeuil,
  lignesTuile,
  provenance,
  resumeQuota,
  valeurFait,
} from './morning-brief-model';

const SOURCE = { module: 'run.sales', collection: 'sales_invoices', rule: 'r', reference: 'ADR' };

function f(over: Partial<BriefFactView>): BriefFactView {
  return {
    id: 'ca_mois.CDF',
    label: 'CA',
    kind: 'amount',
    status: 'known',
    value: '1250000.50',
    currency: 'CDF',
    source: SOURCE,
    ...over,
  };
}

describe('valeurs du brief', () => {
  it('formate une chaîne décimale en français sans flottant', () => {
    expect(formatDecimalFr('1250000.50')).toBe('1 250 000,50');
    expect(formatDecimalFr('-200.00')).toBe('−200,00');
    expect(formatDecimalFr('12')).toBe('12');
  });

  it('écrit le statut d’un fait inconnu, jamais zéro', () => {
    expect(valeurFait(f({}))).toBe('1 250 000,50 CDF');
    expect(valeurFait(f({ status: 'to_fill', value: null }))).toBe('À renseigner');
    expect(valeurFait(f({ status: 'unavailable', value: null }))).toBe('Non disponible');
    expect(valeurFait(f({ status: 'hidden', value: null }))).toBe('Masqué pour votre rôle');
  });

  it('omet une devise à zéro quand une autre porte un montant, garde zéro sinon', () => {
    const usd0 = f({ id: 'ca_mois.USD', value: '0.00', currency: 'USD' });
    expect(lignesTuile([f({}), usd0])).toEqual(['1 250 000,50 CDF']);
    expect(lignesTuile([f({ value: '0.00' }), usd0])).toEqual(['0,00 CDF']);
    expect(lignesTuile([f({ status: 'hidden', value: null })])).toEqual(['Masqué pour votre rôle']);
  });

  it('cite le seuil comme paramètre à valider', () => {
    expect(
      libelleSeuil({
        id: 'S4',
        value: 30,
        unit: 'jours',
        label: 'x',
        nature: 'parametre_produit_a_valider',
      }),
    ).toBe('Seuil S4 : 30 jours — paramètre à valider');
    expect(libelleSeuil(null)).toBeNull();
  });
});

describe('provenance de l’explication', () => {
  const base: BriefAnswerView = {
    intent: 'explain',
    items: [],
    source: 'llm',
    cached: false,
    reason: null,
    mention: '',
    factsSha256: '',
  };
  it('distingue l’IA vérifiée de la lecture automatique, et dit pourquoi', () => {
    expect(provenance(base)).toBe('Rédigé par l’IA — chiffres vérifiés');
    expect(provenance({ ...base, cached: true })).toContain('plus tôt aujourd’hui');
    expect(provenance({ ...base, source: 'fallback', reason: 'rejetee' })).toContain(
      'chiffre non vérifiable',
    );
    expect(
      provenance({ ...base, source: 'fallback', reason: 'desactivee_organisation' }),
    ).toContain('votre organisation');
  });
});

describe('quota', () => {
  it('annonce le reste, l’épuisement ou l’illimité', () => {
    const q = {
      limit: 20,
      used: 18,
      remaining: 2,
      unlimited: false,
      exceeded: false,
      resetInDays: 9,
    };
    expect(resumeQuota(q)).toBe('2 messages IA restants ce mois-ci.');
    expect(resumeQuota({ ...q, remaining: 0, exceeded: true })).toContain('9 jours');
    expect(resumeQuota({ ...q, unlimited: true, limit: null, remaining: null })).toContain(
      'illimités',
    );
    expect(resumeQuota(null)).toBeNull();
  });
});
