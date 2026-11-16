import { describe, expect, it } from 'vitest';

import {
  aDesFiltres,
  ecrireFiltres,
  lienDepensesFournisseur,
  lireFiltres,
  nomFicheFiltree,
  optionsFiltreFournisseur,
  periodeListe,
} from './filtres-depenses';

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);

describe('ADR-0077 § 3 — filtres des dépenses', () => {
  it('lit les filtres de l’URL et ignore un identifiant malformé', () => {
    expect(lireFiltres(new URLSearchParams(`fournisseur=${A.toUpperCase()}&projet=${B}`))).toEqual({
      fournisseurId: A,
      projetId: B,
    });
    expect(lireFiltres(new URLSearchParams('fournisseur=abc&projet='))).toEqual({
      fournisseurId: null,
      projetId: null,
    });
  });

  it('écrit les filtres dans un ordre stable', () => {
    expect(ecrireFiltres({ fournisseurId: A, projetId: B })).toBe(`?fournisseur=${A}&projet=${B}`);
    expect(ecrireFiltres({ fournisseurId: null, projetId: null })).toBe('');
    expect(aDesFiltres({ fournisseurId: null, projetId: B })).toBe(true);
  });

  it('lien depuis la fiche fournisseur', () => {
    expect(lienDepensesFournisseur(A)).toBe(`/tresorerie/depenses?fournisseur=${A}`);
  });

  it('options : fiches seulement', () => {
    expect(
      optionsFiltreFournisseur([
        { name: 'Socimex', supplierId: A },
        { name: 'Marché Gambela', supplierId: null },
      ]),
    ).toEqual([{ name: 'Socimex', supplierId: A }]);
  });

  it('nom d’une fiche arrivée par l’URL', () => {
    expect(nomFicheFiltree(A, [{ supplierId: A, supplierName: 'Socimex SARL' }])).toBe(
      'Socimex SARL',
    );
    expect(nomFicheFiltree(A, [])).toBe('Fiche fournisseur choisie');
  });

  it('période : le mois, ou toutes les dates', () => {
    const fin = () => '2026-11-30';
    expect(periodeListe('2026-11', false, fin)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(periodeListe('2026-11', true, fin)).toEqual({});
  });
});
