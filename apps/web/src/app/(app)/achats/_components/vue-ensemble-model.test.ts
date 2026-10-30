import { describe, expect, it } from 'vitest';

import type { PayablesView } from '@/lib/api-purchases';

import { compteDePage, lire, phraseIndisponible, tuilesVue } from './vue-ensemble-model';

const page = (n: number, suite = false) => ({
  items: Array.from({ length: n }, (_, i) => ({ id: String(i) })),
  nextCursor: suite ? 'c' : null,
});
const echeancier: PayablesView = {
  asOf: '2026-10-30',
  dueSoonDays: 7,
  byCurrency: [
    {
      currency: 'USD',
      overdue: { amount: '300.00', count: 1 },
      dueSoon: { amount: '200.00', count: 2 },
      disputed: { amount: '0.00', count: 0 },
    },
    {
      currency: 'CDF',
      overdue: { amount: '0.00', count: 0 },
      dueSoon: { amount: '0.00', count: 0 },
      disputed: { amount: '0.00', count: 0 },
    },
  ],
};
const ok = <T>(valeur: T) => ({ ok: true as const, valeur });
const ko = (status: number) => ({ ok: false as const, erreur: { status } });

describe('tuiles', () => {
  it('404 (lot pas encore livré) : une phrase, jamais un zéro', () => {
    const t = tuilesVue(['purchase.read'], {
      enAttente: null,
      aRecevoir: ko(404),
      facturesEcart: ko(404),
      echeancier: ko(404),
    });
    expect(t.map((x) => x.id)).toEqual(['a-recevoir', 'factures-ecart', 'a-payer', 'en-retard']);
    for (const x of t) expect(x.contenu).toEqual({ etat: 'indisponible', phrase: 'Pas encore disponible' });
  });

  it('« À approuver » seulement pour qui approuve', () => {
    const t = tuilesVue(['purchase.read', 'purchase.approve'], {
      enAttente: ok(page(3)),
      aRecevoir: ok(page(50, true)),
      facturesEcart: ok(page(0)),
      echeancier: ok(echeancier),
    });
    expect(t[0]).toMatchObject({
      id: 'a-approuver',
      lien: '/achats/validations',
      contenu: { etat: 'connu', lignes: ['3'], attention: true },
    });
    expect(t[1]!.contenu).toMatchObject({ lignes: ['50 et plus'] });
  });

  it('montants par devise, devises sans facture omises, aucune somme entre devises', () => {
    const t = tuilesVue(['purchase.read'], {
      enAttente: null,
      aRecevoir: ok(page(0)),
      facturesEcart: ok(page(0)),
      echeancier: ok(echeancier),
    });
    expect(t.find((x) => x.id === 'a-payer')!.contenu).toEqual({
      etat: 'connu',
      lignes: ['200,00 USD · 2 factures'],
      detail: 'Échéance sous 7 jours',
      attention: false,
    });
    expect(t.find((x) => x.id === 'en-retard')!.contenu).toMatchObject({ attention: true });
  });
});

describe('lectures', () => {
  it('phrases d’indisponibilité', () => {
    expect(phraseIndisponible({ status: 403 })).toMatch(/rôles/);
    expect(phraseIndisponible(new Error('x'))).toMatch(/impossible/);
    expect(compteDePage(page(2))).toBe('2');
  });
  it('`lire` ne rejette jamais', async () => {
    await expect(lire(Promise.reject({ status: 404 }))).resolves.toEqual({
      ok: false,
      erreur: { status: 404 },
    });
    await expect(lire(Promise.resolve(1))).resolves.toEqual({ ok: true, valeur: 1 });
  });
});
