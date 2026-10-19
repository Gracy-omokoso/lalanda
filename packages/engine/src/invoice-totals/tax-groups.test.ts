// Groupes de taxation par défaut — critères d'acceptation D0 d'ADR-0022.
//
// Les attentes sont écrites en littéral depuis l'ADR (§ S25d.2 et § « Règles
// DGI ») et non recalculées depuis le code : un test qui relirait
// `DEFAULT_TAX_GROUPS` pour fabriquer ses attentes ne vérifierait rien.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TAX_GROUPS,
  DEFAULT_TAX_GROUPS_SOURCE,
  ITEM_TYPES,
  OUT_OF_SCOPE_ITEM_CODE,
  TAX_GROUP_LETTERS,
  isItemTypeAllowed,
  isTaxGroupLetter,
  taxGroupDefinition,
  type ItemType,
  type TaxGroupLetter,
} from '../index.js';

const LETTRES_ATTENDUES = 'ABCDEFGHIJKLMNOP'.split('');

const LIBELLES_ATTENDUS: Record<string, string> = {
  A: 'Exonéré et hors champ',
  B: 'Taxable 16 %',
  C: 'Taxable 5 %',
  D: 'Régimes dérogatoires',
  E: 'Exportation',
  F: 'Marché public à financement extérieur 16 %',
  G: 'Marché public à financement extérieur 5 %',
  H: "Consignation d'emballage",
  I: 'Garantie et caution',
  J: 'Débours',
  K: 'Opérations des non-assujettis',
  L: 'Prélèvements sur ventes',
  M: 'Ventes réglementées à TVA spécifique',
  N: 'TVA spécifique',
  O: 'Taxable 1 %',
  P: 'Marché public à financement extérieur 1 %',
};

describe('liste des groupes de taxation (ADR-0022 § S25d.2)', () => {
  it('compte seize lettres, A à P, uniques et dans l’ordre', () => {
    expect([...TAX_GROUP_LETTERS]).toEqual(LETTRES_ATTENDUES);
    expect(DEFAULT_TAX_GROUPS.map((g) => g.letter)).toEqual(LETTRES_ATTENDUES);
    expect(new Set(DEFAULT_TAX_GROUPS.map((g) => g.letter)).size).toBe(16);
  });

  it('porte les libellés de l’ADR', () => {
    for (const groupe of DEFAULT_TAX_GROUPS) {
      expect(groupe.label, groupe.letter).toBe(LIBELLES_ATTENDUS[groupe.letter]);
    }
  });

  it('seul le groupe N est « TVA seulement »', () => {
    const vatOnly = DEFAULT_TAX_GROUPS.filter((g) => g.nature === 'vat_only').map((g) => g.letter);
    expect(vatOnly).toEqual(['N']);
  });

  it('l’opération hors champ n’est admise qu’en groupe A', () => {
    const horsChamp = DEFAULT_TAX_GROUPS.filter((g) => g.outOfScopeAllowed).map((g) => g.letter);
    expect(horsChamp).toEqual(['A']);
    expect(OUT_OF_SCOPE_ITEM_CODE).toBe('HORS CHAMP');
  });

  it('est sourcée et datée', () => {
    expect(DEFAULT_TAX_GROUPS_SOURCE.date).toBe('2026-02');
    expect(DEFAULT_TAX_GROUPS_SOURCE.label).toMatch(/DGI/);
  });

  it('ne porte aucun taux (ADR-0019 : jamais de taux codé en dur)', () => {
    // Dans les objets livrés : aucun champ dont le nom évoque un taux.
    for (const groupe of DEFAULT_TAX_GROUPS) {
      for (const cle of Object.keys(groupe)) {
        expect(cle, `${groupe.letter}.${cle}`).not.toMatch(/rate|taux|percent|pourcent/i);
      }
    }
    // Dans la source : aucune propriété de taux déclarée ou affectée, même
    // optionnelle ou sur un futur objet qui échapperait au contrôle ci-dessus.
    const source = readFileSync(new URL('./tax-groups.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\b\w*(rate|taux|percent)\w*\??\s*:/i);
  });

  it('est figée : on ne peut pas la modifier à l’exécution', () => {
    expect(Object.isFrozen(DEFAULT_TAX_GROUPS)).toBe(true);
    for (const groupe of DEFAULT_TAX_GROUPS) {
      expect(Object.isFrozen(groupe), groupe.letter).toBe(true);
      expect(Object.isFrozen(groupe.itemTypes), groupe.letter).toBe(true);
    }
  });
});

describe('isItemTypeAllowed : TAX si et seulement si L ou N', () => {
  // 16 × 3 = 48 combinaisons, attendues en littéral.
  for (const lettre of LETTRES_ATTENDUES as TaxGroupLetter[]) {
    for (const type of ['BIE', 'SER', 'TAX'] as ItemType[]) {
      const groupeTaxe = lettre === 'L' || lettre === 'N';
      const attendu = type === 'TAX' ? groupeTaxe : !groupeTaxe;
      it(`${lettre} × ${type} → ${attendu ? 'admis' : 'refusé'}`, () => {
        expect(isItemTypeAllowed(lettre, type)).toBe(attendu);
      });
    }
  }

  it('couvre exactement les trois types de la spécification', () => {
    expect([...ITEM_TYPES]).toEqual(['BIE', 'SER', 'TAX']);
  });

  it('refuse un type inconnu reçu sans vérification', () => {
    expect(isItemTypeAllowed('B', 'XYZ' as ItemType)).toBe(false);
  });

  it('concorde avec les types déclarés par chaque définition', () => {
    for (const groupe of DEFAULT_TAX_GROUPS) {
      for (const type of ITEM_TYPES) {
        expect(isItemTypeAllowed(groupe.letter, type)).toBe(groupe.itemTypes.includes(type));
      }
    }
  });
});

describe('isTaxGroupLetter', () => {
  it('accepte les seize lettres A à P', () => {
    for (const lettre of LETTRES_ATTENDUES) expect(isTaxGroupLetter(lettre), lettre).toBe(true);
  });

  it('refuse Q à Z (présentes dans la spécification, définies par aucun document)', () => {
    for (const lettre of 'QRSTUVWXYZ'.split('')) {
      expect(isTaxGroupLetter(lettre), lettre).toBe(false);
    }
  });

  it('refuse les minuscules, les chaînes vides ou longues et les non-chaînes', () => {
    for (const valeur of ['a', 'b', '', 'AB', ' A', null, undefined, 1, {}, ['A']]) {
      expect(isTaxGroupLetter(valeur), String(valeur)).toBe(false);
    }
  });
});

describe('taxGroupDefinition', () => {
  it('renvoie la définition de chaque lettre', () => {
    for (const lettre of LETTRES_ATTENDUES as TaxGroupLetter[]) {
      expect(taxGroupDefinition(lettre).letter).toBe(lettre);
    }
  });

  it('lève une erreur pour une lettre non vérifiée hors A–P', () => {
    expect(() => taxGroupDefinition('Q' as TaxGroupLetter)).toThrow(RangeError);
  });
});
