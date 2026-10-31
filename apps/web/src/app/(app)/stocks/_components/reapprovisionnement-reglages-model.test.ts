// Réapprovisionnement (§ 5.1, § 6.1) et réglages (§ 2.8).

import { describe, expect, it } from 'vitest';

import { ID1, ID2, MAGASINIER, PROPRIETAIRE } from './fixtures.test-utils';
import {
  RAISON_SANS_DEMANDE,
  boutonDemande,
  groupesParFournisseur,
  lienDemandeAchat,
} from './reapprovisionnement-model';
import { cleMotif, formulaireReglages, preparerReglages } from './reglages-model';

const s = (itemId: string, supplier: string | null, q = '18') => ({
  itemId,
  itemName: 'x',
  itemCode: null,
  unit: 'u',
  locationId: null,
  locationName: null,
  available: '4',
  minQuantity: '10',
  targetQuantity: '30',
  onOrder: '8',
  suggestedQuantity: q,
  preferredSupplierId: supplier,
  preferredSupplierName: supplier ? 'Fournisseur' : null,
});

describe('réapprovisionnement', () => {
  it('regroupe par fournisseur habituel, « sans fournisseur » en dernier', () => {
    const g = groupesParFournisseur([s(ID1, null), s(ID2, 'f1'), s(ID1, 'f1')]);
    expect(g.map((x) => [x.supplierId, x.suggestions.length])).toEqual([
      ['f1', 2],
      [null, 1],
    ]);
  });

  it('lien vers le formulaire R3 : identifiants et quantités seulement, jamais de nom', () => {
    const lien = lienDemandeAchat('f1', [s(ID1, 'f1'), s(ID2, 'f1', '0.000')])!;
    expect(lien).toBe(`/achats/commandes?nouvelle=1&fournisseur=f1&articles=${ID1}%3A18`);
    expect(lien).not.toMatch(/x|Fournisseur/);
    expect(lienDemandeAchat(null, [s(ID1, null)])).toBe(
      `/achats/commandes?nouvelle=1&articles=${ID1}%3A18`,
    );
    expect(lienDemandeAchat('f1', [s(ID1, 'f1', '0')])).toBeNull();
  });

  it('bouton actif avec purchase.request ; le Magasinier le voit désactivé, avec sa raison', () => {
    expect(boutonDemande(PROPRIETAIRE)).toEqual({ actif: true, raison: null });
    expect(boutonDemande(MAGASINIER)).toEqual({ actif: false, raison: RAISON_SANS_DEMANDE });
  });
});

describe('réglages', () => {
  const vue = {
    salesIssueMode: 'automatic' as const,
    allowNegativeManualMoves: false,
    adjustmentReasons: [{ key: 'breakage', label: 'Casse' }],
    countReminderDays: 0,
    revision: 5,
  };

  it('corps de PUT, révision attendue', () => {
    expect(preparerReglages({ ...formulaireReglages(vue), countReminderDays: '30' }, 5)).toEqual({
      ok: true,
      corps: {
        salesIssueMode: 'automatic',
        allowNegativeManualMoves: false,
        countReminderDays: 30,
        adjustmentReasons: [{ key: 'breakage', label: 'Casse' }],
        expectedRevision: 5,
      },
    });
  });

  it('rappel 0 à 365 jours ; au moins un motif ; libellé obligatoire', () => {
    const f = formulaireReglages(vue);
    expect(preparerReglages({ ...f, countReminderDays: '400' }, 5).ok).toBe(false);
    expect(preparerReglages({ ...f, motifs: [] }, 5).ok).toBe(false);
    expect(preparerReglages({ ...f, motifs: [{ key: 'k', label: ' ' }] }, 5).ok).toBe(false);
  });

  it('clé d’un motif nouveau : sans accents, unique', () => {
    expect(cleMotif('Perte en route', [])).toBe('perte_en_route');
    expect(cleMotif('Casse', ['casse'])).toBe('casse_2');
    expect(cleMotif('!!!', [])).toBe('motif');
  });
});
