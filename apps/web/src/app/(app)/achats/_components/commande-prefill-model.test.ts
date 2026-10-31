// Préremplissage d'une demande d'achat depuis les stocks (ADR-0046 § 6.1, S8).

import { describe, expect, it } from 'vitest';

import { preparerCommande, formulaireCommande } from './commandes-model';
import { lignesPreremplies, lireArticlesPreremplis, refStock } from './commande-prefill-model';

const A = 'a'.repeat(24);
const B = 'B'.repeat(24);

describe('préremplissage par identifiants et quantités', () => {
  it('lit `id:quantité`, ignore le reste, sans doublon ni zéro', () => {
    expect(
      lireArticlesPreremplis(`${A}:18,${B}:2.5,${A}:3,xyz:1,${A.slice(1)}:1,${'c'.repeat(24)}:0`),
    ).toEqual([
      { itemId: A, quantity: '18' },
      { itemId: B.toLowerCase(), quantity: '2.5' },
    ]);
    expect(lireArticlesPreremplis(null)).toEqual([]);
    expect(lireArticlesPreremplis(`${A}:1.2345`)).toEqual([]);
  });

  it('lignes : référence stk:<id>, désignation et unité relues, prix vide', () => {
    const l = lignesPreremplies(
      [{ itemId: A, quantity: '18' }],
      new Map([[A, { name: 'Ciment', unit: 'sac' }]]),
    );
    expect(l).toEqual([
      {
        label: 'Ciment',
        kind: 'goods',
        quantity: '18',
        unit: 'sac',
        unitPrice: '',
        itemRef: refStock(A),
      },
    ]);
    expect(refStock(A)).toBe(`stk:${A}`);
    expect(lignesPreremplies([{ itemId: A, quantity: '1' }], new Map())[0]!.label).toBe('');
  });

  it('la référence part avec la ligne, une fois le prix saisi par l’utilisateur', () => {
    const lignes = lignesPreremplies(
      [{ itemId: A, quantity: '18' }],
      new Map([[A, { name: 'Ciment', unit: 'sac' }]]),
    );
    const p = preparerCommande({
      ...formulaireCommande(),
      title: 'Réassort',
      lignes: [{ ...lignes[0]!, unitPrice: '12' }],
    });
    expect(p.ok && p.corps.lines[0]).toEqual({
      label: 'Ciment',
      kind: 'goods',
      quantity: '18',
      unitPrice: '12',
      unit: 'sac',
      itemRef: `stk:${A}`,
    });
    // Sans prix : la demande n'est pas prête, rien ne part.
    expect(preparerCommande({ ...formulaireCommande(), title: 'Réassort', lignes }).ok).toBe(false);
  });
});
