// Vue d'ensemble (ADR-0046 § 5.1, § 6.6) : ruptures, sous le seuil, à traiter,
// valeur seulement pour qui la voit, une ligne par devise, jamais de zéro inventé.

import { describe, expect, it } from 'vitest';

import { MAGASINIER, PROPRIETAIRE, niveau } from './fixtures.test-utils';
import { lignesEnRupture, tuilesVue, type LecturesVue } from './vue-ensemble-model';

const ok = <T>(valeur: T) => ({ ok: true as const, valeur });
const ko = (status: number) => ({ ok: false as const, erreur: { status } });

const base: LecturesVue = {
  niveaux: ok({
    items: [niveau({ quantity: '0' }), niveau({ quantity: '-2' }), niveau()],
    nextCursor: null,
  }),
  sousSeuil: ok({ items: [1, 2], nextCursor: null }),
  aTraiter: ok({ items: [], nextCursor: null }),
  valorisation: ok({
    until: null,
    locationId: null,
    byCurrency: [
      { currency: 'USD' as const, value: '1200.50', itemCount: 3, complete: true },
      { currency: 'CDF' as const, value: '90000.00', itemCount: 1, complete: false },
    ],
  }),
};

describe('tuiles de la vue d’ensemble', () => {
  it('ruptures, sous le seuil, à traiter, valeur par devise (propriétaire)', () => {
    const t = tuilesVue(PROPRIETAIRE, base);
    expect(t.map((x) => x.id)).toEqual(['ruptures', 'sous-seuil', 'a-traiter', 'valeur']);
    expect(t[0]!.contenu).toMatchObject({ etat: 'connu', lignes: ['2'], attention: true });
    expect(t[1]!.contenu).toMatchObject({ lignes: ['2'], attention: true });
    expect(t[2]!.contenu).toMatchObject({ lignes: ['0'], attention: false });
    expect(t[3]!.contenu).toMatchObject({
      etat: 'connu',
      lignes: ['1 200,50 USD', '90 000,00 CDF'],
      detail: 'Incomplète : des entrées attendent leur coût',
    });
  });

  it('Magasinier : aucune tuile de valeur (non demandée)', () => {
    const t = tuilesVue(MAGASINIER, { ...base, valorisation: null });
    expect(t.map((x) => x.id)).toEqual(['ruptures', 'sous-seuil', 'a-traiter']);
  });

  it('valeur servie mais masquée par l’API : une phrase, pas de chiffre', () => {
    const v = ok({ until: null, locationId: null, byCurrency: [], valuesHidden: true });
    expect(tuilesVue(PROPRIETAIRE, { ...base, valorisation: v })[3]!.contenu).toEqual({
      etat: 'indisponible',
      phrase: 'Masquée pour votre rôle',
    });
  });

  it('route absente (404) : une phrase à la place du chiffre', () => {
    const t = tuilesVue(PROPRIETAIRE, { ...base, aTraiter: ko(404), niveaux: ko(500) });
    expect(t[2]!.contenu).toEqual({ etat: 'indisponible', phrase: 'Pas encore disponible' });
    expect(t[0]!.contenu).toEqual({
      etat: 'indisponible',
      phrase: 'Lecture impossible pour le moment',
    });
  });

  it('page incomplète : « au moins » et « et plus », jamais un total deviné', () => {
    const t = tuilesVue(PROPRIETAIRE, {
      ...base,
      niveaux: ok({ items: [niveau({ quantity: '0' })], nextCursor: 'c' }),
      sousSeuil: ok({ items: [1], nextCursor: 'c' }),
    });
    expect(t[0]!.contenu).toMatchObject({ lignes: ['Au moins 1'] });
    expect(t[1]!.contenu).toMatchObject({ lignes: ['1 et plus'] });
  });

  it('lignes en rupture : quantité nulle ou négative', () => {
    expect(
      lignesEnRupture([niveau({ quantity: '0.000' }), niveau({ quantity: '1' })]),
    ).toHaveLength(1);
  });
});
