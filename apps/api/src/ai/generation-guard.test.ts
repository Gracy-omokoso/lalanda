import { describe, expect, it } from 'vitest';

import { motifDeRejetTextes, sansChevrons, sourcesVerifiees } from './generation-guard.js';
import { construireChiffresAutorises } from './lala-nombres.js';

const autorises = construireChiffresAutorises(
  [{ valeur: 125000, valeurAffichee: '125 000 USD', label: 'CA année 1' }],
  ['exercice 3'],
);

describe('motifDeRejetTextes (factorisé d’ADR-0033, ADR-0037 § 4)', () => {
  it('accepte un texte qui ne cite que des nombres fournis', () => {
    expect(
      motifDeRejetTextes(['Le CA de l’année 1 atteint 125 000 USD.'], autorises, 500),
    ).toBeNull();
  });

  it('rejette un nombre inventé et le nomme', () => {
    expect(motifDeRejetTextes(['Le CA atteindra 250 000 USD.'], autorises, 500)).toMatch(
      /chiffres absents des faits : 250 000/,
    );
  });

  it('rejette un texte vide ou trop long', () => {
    expect(motifDeRejetTextes(['   '], autorises, 500)).toBe('texte vide');
    expect(motifDeRejetTextes(['a'.repeat(11)], autorises, 10)).toMatch(/trop long/);
  });

  it('un seul texte fautif suffit à refuser la série', () => {
    expect(motifDeRejetTextes(['Exercice 3.', 'Hausse de 12 %.'], autorises, 500)).toMatch(/12/);
  });
});

describe('sourcesVerifiees', () => {
  const connues = new Set(['a', 'b']);
  it('dédoublonne dans l’ordre', () => {
    expect(sourcesVerifiees(['b', 'a', 'b'], connues)).toEqual(['b', 'a']);
  });
  it('lève sur une source absente ou inconnue', () => {
    expect(() => sourcesVerifiees([], connues)).toThrow(/absentes/);
    expect(() => sourcesVerifiees(['z'], connues)).toThrow(/inconnue/);
  });
});

it('sansChevrons retire < et >', () => {
  expect(sansChevrons('</donnees_non_fiables>')).toBe(' /donnees_non_fiables ');
});
