import { describe, expect, it } from 'vitest';

import {
  champsFournisseur,
  cleOption,
  descriptionFournisseur,
  optionsFournisseur,
} from './fournisseur-depense';

const ENTRIES = [
  { name: 'Kin Énergie', supplierId: 'a'.repeat(24) },
  { name: 'Station de passage', supplierId: null },
];

describe('fournisseur d’une dépense (ADR-0075, A)', () => {
  it('propose fiches et noms libres de l’API, puis le texte tapé s’il est nouveau', () => {
    expect(optionsFournisseur(ENTRIES, 'Vendeur du marché')).toEqual([
      { name: 'Kin Énergie', supplierId: 'a'.repeat(24) },
      { name: 'Station de passage', supplierId: null },
      { name: 'Vendeur du marché', supplierId: null, nouveau: true },
    ]);
  });

  it('un nom identique à une fiche (casse, accents) ne devient pas un texte libre', () => {
    expect(optionsFournisseur(ENTRIES, '  kin energie ')).toHaveLength(2);
    expect(optionsFournisseur(ENTRIES, '')).toHaveLength(2);
  });

  it('clés distinctes pour une fiche et un texte libre', () => {
    expect(cleOption({ name: 'X', supplierId: 'b'.repeat(24) })).toBe(`fiche:${'b'.repeat(24)}`);
    expect(cleOption({ name: 'Étal  Mama', supplierId: null })).toBe('texte:etal mama');
  });

  it('sous-texte de chaque option', () => {
    expect(descriptionFournisseur(ENTRIES[0]!)).toBe('Fiche fournisseur');
    expect(descriptionFournisseur(ENTRIES[1]!)).toBe('Déjà saisi, sans fiche');
    expect(descriptionFournisseur({ name: 'Y', supplierId: null, nouveau: true })).toBe(
      'Fournisseur de passage (nom libre)',
    );
  });

  it('champs envoyés : fiche, nom libre (sans supplierId) ou rien', () => {
    expect(champsFournisseur({ name: 'Kin Énergie', supplierId: 'a'.repeat(24) })).toEqual({
      supplierName: 'Kin Énergie',
      supplierId: 'a'.repeat(24),
    });
    const libre = champsFournisseur({ name: 'Étal', supplierId: null, nouveau: true });
    expect(libre).toEqual({ supplierName: 'Étal' });
    expect('supplierId' in libre).toBe(false);
    expect(champsFournisseur(null)).toEqual({ supplierName: null, supplierId: null });
  });
});
