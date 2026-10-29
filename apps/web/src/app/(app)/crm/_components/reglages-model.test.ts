// Motifs de perte paramétrables — ADR-0040 § 2.5.

import { describe, expect, it } from 'vitest';

import { MAX_MOTIFS, ajouterMotif, cleMotif } from './reglages-model';

describe('Réglages — motifs de perte', () => {
  it('clé lisible tirée du libellé', () => {
    expect(cleMotif('Délai trop long !')).toBe('delai_trop_long');
    expect(cleMotif('!!!')).toBe('');
  });

  it('ajoute un motif actif, clé dédoublée, refuse vide, trop long ou plafond', () => {
    const base = [{ key: 'prix', label: 'Prix', active: true }];
    expect(ajouterMotif(base, ' Délai ')).toEqual([
      ...base,
      { key: 'delai', label: 'Délai', active: true },
    ]);
    expect(ajouterMotif(base, 'Prix')?.at(-1)?.key).toBe('prix_2');
    expect(ajouterMotif(base, '  ')).toBeNull();
    expect(ajouterMotif(base, 'x'.repeat(61))).toBeNull();
    const plein = Array.from({ length: MAX_MOTIFS }, (_, i) => ({
      key: `m${i}`,
      label: `M${i}`,
      active: true,
    }));
    expect(ajouterMotif(plein, 'Autre')).toBeNull();
  });
});
