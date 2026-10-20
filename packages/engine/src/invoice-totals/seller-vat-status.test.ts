// Assujettissement du vendeur et groupes de taxation — ADR-0023, amendement du
// 20 oct. 2026. Attentes écrites en littéral depuis la règle de l'ADR.

import { describe, expect, it } from 'vitest';

import {
  TAX_GROUP_LETTERS,
  TAX_GROUPS_RESERVED_TO_VAT_REGISTERED,
  checkSellerVatStatus,
  type TaxGroupLetter,
} from './index.js';

const line = (taxGroup: TaxGroupLetter, outOfScope = false) => ({ taxGroup, outOfScope });

describe('checkSellerVatStatus — vendeur non assujetti', () => {
  it('la liste des groupes réservés aux assujettis est celle de l’ADR', () => {
    expect([...TAX_GROUPS_RESERVED_TO_VAT_REGISTERED]).toEqual([
      'B',
      'C',
      'D',
      'F',
      'G',
      'M',
      'N',
      'O',
      'P',
    ]);
  });

  it('groupe B (le cas de production du 20 oct. 2026) : bloquant, message clair', () => {
    const r = checkSellerVatStatus({ vatRegistered: false, lines: [line('B')] });
    expect(r.ok).toBe(false);
    expect(r.warnings).toEqual([]);
    expect(r.issues).toHaveLength(1);
    const [i] = r.issues;
    expect(i?.code).toBe('TAX_GROUP_REQUIRES_VAT_REGISTRATION');
    expect(i?.lineIndex).toBe(0);
    expect(i?.details).toEqual({ taxGroup: 'B' });
    expect(i?.message).toContain(
      'Votre profil fiscal indique que l’entreprise n’est pas assujettie à la TVA',
    );
    expect(i?.message).toContain('groupe B (Taxable 16 %)');
    expect(i?.message).toContain('Utilisez le groupe K');
    expect(i?.message).toContain('mettez à jour le profil fiscal');
  });

  it('chaque groupe interdit est signalé, tous ensemble, avec sa position', () => {
    const groups: TaxGroupLetter[] = ['K', 'B', 'C', 'D', 'F', 'G', 'M', 'N', 'O', 'P'];
    const r = checkSellerVatStatus({ vatRegistered: false, lines: groups.map((g) => line(g)) });
    expect(r.issues.map((i) => [i.lineIndex, i.details.taxGroup])).toEqual([
      [1, 'B'],
      [2, 'C'],
      [3, 'D'],
      [4, 'F'],
      [5, 'G'],
      [6, 'M'],
      [7, 'N'],
      [8, 'O'],
      [9, 'P'],
    ]);
  });

  it('A exonéré : interdit ; A hors champ : permis', () => {
    const exonere = checkSellerVatStatus({ vatRegistered: false, lines: [line('A')] });
    expect(exonere.ok).toBe(false);
    expect(exonere.issues[0]?.message).toContain('opération exonérée (groupe A)');
    const horsChamp = checkSellerVatStatus({ vatRegistered: false, lines: [line('A', true)] });
    expect(horsChamp).toEqual({ ok: true, issues: [], warnings: [] });
  });

  it('K, E, H, I, J, L : permis, sans avertissement', () => {
    for (const g of ['K', 'E', 'H', 'I', 'J', 'L'] as const) {
      expect(checkSellerVatStatus({ vatRegistered: false, lines: [line(g)] }), g).toEqual({
        ok: true,
        issues: [],
        warnings: [],
      });
    }
  });

  it('aucune ligne : rien à signaler (NO_LINES appartient au calcul)', () => {
    expect(checkSellerVatStatus({ vatRegistered: false, lines: [] })).toEqual({
      ok: true,
      issues: [],
      warnings: [],
    });
  });
});

describe('checkSellerVatStatus — vendeur assujetti', () => {
  it('aucun groupe n’est bloquant', () => {
    const r = checkSellerVatStatus({
      vatRegistered: true,
      lines: TAX_GROUP_LETTERS.map((g) => line(g)),
    });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('groupe K : avertissement non bloquant, sur la bonne ligne', () => {
    const r = checkSellerVatStatus({ vatRegistered: true, lines: [line('B'), line('K')] });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]?.code).toBe('TAX_GROUP_K_WHILE_VAT_REGISTERED');
    expect(r.warnings[0]?.lineIndex).toBe(1);
    expect(r.warnings[0]?.message).toContain('groupe K');
  });
});
