// Articles (ADR-0046 § 2.1) : filtres, formulaire, gestes de la fiche.

import { describe, expect, it } from 'vitest';

import {
  formulaireArticle,
  gestesArticle,
  phraseSeuil,
  preparerArticle,
  requeteArticles,
  RAISON_STOCK_RESTANT,
} from './articles-model';
import { MAGASINIER, PROPRIETAIRE, article } from './fixtures.test-utils';
import { formatQuantite } from './stocks-model';

describe('liste', () => {
  it('filtres → requête', () => {
    expect(requeteArticles('actifs', ' cim ')).toEqual({ limit: 50, q: 'cim', active: 'true' });
    expect(requeteArticles('archives', '', 'c1')).toEqual({
      limit: 50,
      cursor: 'c1',
      active: 'false',
    });
    expect(requeteArticles('consumable', '')).toEqual({
      limit: 50,
      active: 'true',
      kind: 'consumable',
    });
  });
});

describe('formulaire', () => {
  it('création : nom et unité obligatoires', () => {
    const p = preparerArticle({ ...formulaireArticle(null), unit: '' });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(Object.keys(p.champs).sort()).toEqual(['name', 'unit']);
  });

  it('corps : seuil, conversions, champs vides à null, aucune quantité ni valeur', () => {
    const p = preparerArticle({
      ...formulaireArticle(null),
      name: ' Ciment ',
      code: ' ',
      minQuantity: '10',
      targetQuantity: '30',
      conversions: [{ unit: 'palette', factor: '40' }],
    });
    expect(p).toEqual({
      ok: true,
      corps: {
        code: null,
        name: 'Ciment',
        description: null,
        kind: 'goods',
        unit: 'pièce',
        unitConversions: [{ unit: 'palette', factor: '40' }],
        costCurrency: 'USD',
        tracked: true,
        defaultLocationId: null,
        catalogItemId: null,
        preferredSupplierId: null,
        reorder: { minQuantity: '10', targetQuantity: '30', locationId: null },
      },
    });
  });

  it('conversions : unité de stock, doublon et facteur nul refusés', () => {
    const p = preparerArticle({
      ...formulaireArticle(null),
      name: 'X',
      unit: 'pièce',
      conversions: [
        { unit: 'Pièce', factor: '2' },
        { unit: 'carton', factor: '0' },
        { unit: 'carton', factor: '12' },
      ],
    });
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.champs['conversion-0-unit']).toMatch(/unité de stock/);
      expect(p.champs['conversion-1-factor']).toBeDefined();
      expect(p.champs['conversion-2-unit']).toBe('Unité en double.');
    }
  });

  it('modification : préremplie depuis l’article (quantités pour saisie)', () => {
    const f = formulaireArticle(
      article({ reorder: { minQuantity: '10.000', targetQuantity: null, locationId: null } }),
    );
    expect(f).toMatchObject({
      name: 'Ciment 50 kg',
      minQuantity: '10',
      targetQuantity: '',
      unit: 'sac',
    });
  });
});

describe('gestes de la fiche', () => {
  it('Magasinier : aucun geste (stock.manage requis)', () => {
    expect(gestesArticle(article(), MAGASINIER)).toEqual([]);
  });

  it('archiver un article qui a du stock : visible, désactivé, avec sa raison', () => {
    const g = gestesArticle(article({ quantity: '12.000' }), PROPRIETAIRE);
    expect(g.find((x) => x.id === 'archiver')).toEqual({
      id: 'archiver',
      libelle: 'Archiver',
      actif: false,
      raison: RAISON_STOCK_RESTANT,
    });
    expect(gestesArticle(article({ quantity: '0' }), PROPRIETAIRE)[1]!.actif).toBe(true);
    expect(gestesArticle(article({ active: false }), PROPRIETAIRE).map((x) => x.id)).toEqual([
      'modifier',
      'restaurer',
    ]);
  });

  it('phrase du seuil', () => {
    expect(phraseSeuil(article(), () => null, formatQuantite)).toBe('Aucun seuil');
    expect(
      phraseSeuil(
        article({ reorder: { minQuantity: '10', targetQuantity: '30', locationId: 'L' } }),
        () => 'Gombe',
        formatQuantite,
      ),
    ).toBe('Seuil 10 sac, cible 30 (Gombe)');
  });
});
