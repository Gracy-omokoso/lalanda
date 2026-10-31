// Emplacements (§ 2.2), niveaux (§ 2.5) et grand livre (§ 2.3).

import { describe, expect, it } from 'vitest';

import {
  RAISON_EMPLACEMENT_DEFAUT,
  formulaireEmplacement,
  gestesEmplacement,
  preparerEmplacement,
} from './emplacements-model';
import { ID1, ID2, MAGASINIER, PROPRIETAIRE, emplacement, niveau } from './fixtures.test-utils';
import {
  FILTRES_VIDES,
  coutAffiche,
  motifMouvement,
  origineMouvement,
  requeteMouvements,
} from './mouvements-model';
import { alerteDe, etatNiveau, requeteNiveaux } from './niveaux-model';

describe('emplacements', () => {
  it('nom obligatoire ; adresse vide → null', () => {
    expect(preparerEmplacement(formulaireEmplacement(null)).ok).toBe(false);
    expect(
      preparerEmplacement({
        ...formulaireEmplacement(null),
        name: ' Chantier Gombe ',
        kind: 'site',
      }),
    ).toEqual({
      ok: true,
      corps: { name: 'Chantier Gombe', kind: 'site', address: null, responsibleUserId: null },
    });
  });

  it('l’emplacement par défaut ne s’archive pas ; le Magasinier ne gère pas', () => {
    expect(gestesEmplacement(emplacement({ isDefault: true }), PROPRIETAIRE)[1]).toMatchObject({
      actif: false,
      raison: RAISON_EMPLACEMENT_DEFAUT,
    });
    expect(gestesEmplacement(emplacement(), MAGASINIER)).toEqual([]);
  });
});

describe('niveaux', () => {
  it('requête : emplacement, sous le seuil (réponse complète, sans pagination)', () => {
    expect(requeteNiveaux('', false)).toEqual({});
    expect(requeteNiveaux('L', true)).toEqual({ locationId: 'L', below: 'reorder' });
  });

  it('état d’une ligne : négatif, rupture, sous le seuil (moteur), rien', () => {
    const alerte = {
      itemId: ID1,
      itemCode: null,
      itemName: 'Ciment 50 kg',
      unit: 'sac',
      locationId: null,
      locationName: null,
      available: '4',
      minQuantity: '10',
      targetQuantity: null,
      onOrder: '0',
      suggestedQuantity: '6',
      preferredSupplierId: null,
    };
    expect(etatNiveau(niveau({ quantity: '-1' }), null).libelle).toBe('Négatif');
    expect(etatNiveau(niveau({ quantity: '0' }), null).libelle).toBe('Rupture');
    expect(etatNiveau(niveau({ quantity: '4' }), alerte)).toEqual({
      libelle: 'Sous le seuil',
      ton: 'warning',
    });
    expect(etatNiveau(niveau({ quantity: '40' }), null).libelle).toBeNull();
    // Seuil global : vaut pour chaque emplacement ; seuil d'un emplacement : pour lui seul.
    expect(alerteDe(niveau(), [alerte])).toBe(alerte);
    expect(alerteDe(niveau(), [{ ...alerte, locationId: 'autre' }])).toBeNull();
    expect(alerteDe(niveau({ itemId: ID2 }), [alerte])).toBeNull();
  });
});

describe('grand livre', () => {
  it('filtres → requête ; période inversée refusée', () => {
    expect(requeteMouvements(FILTRES_VIDES)).toEqual({ ok: true, requete: { limit: 50 } });
    expect(
      requeteMouvements(
        { locationId: 'L', kind: 'issue', from: '2026-10-01', to: '2026-10-31' },
        'c',
      ),
    ).toEqual({
      ok: true,
      requete: {
        limit: 50,
        locationId: 'L',
        kind: 'issue',
        from: '2026-10-01',
        to: '2026-10-31',
        cursor: 'c',
      },
    });
    expect(requeteMouvements({ ...FILTRES_VIDES, from: '2026-11-01', to: '2026-10-01' }).ok).toBe(
      false,
    );
  });

  const m = {
    id: 'm',
    itemId: 'i',
    locationId: 'l',
    kind: 'purchase_receipt' as const,
    quantity: '72',
    occurredOn: '2026-10-30',
    unitCost: '1.000000',
    costStatus: 'valued' as const,
    value: '72.00',
    source: { kind: 'reception' as const, receptionId: 'r', orderLineId: 'o' },
    sourceKey: 'reception:r:o:in',
    workProjectId: null,
    transferId: null,
    reason: null,
    reversalOf: null,
    recordedAt: '2026-10-30T08:00:00Z',
    createdBy: 'u1',
    revision: 1,
  };

  it('coût d’entrée seulement si les valeurs sont visibles', () => {
    expect(coutAffiche(m, false)).toBeNull();
    expect(coutAffiche(m, true)).toBe('1.000000');
    expect(coutAffiche({ ...m, costStatus: 'pending_cost', unitCost: null }, true)).toBe(
      'coût à saisir',
    );
  });

  it('origine : la nature de la source servie par l’API', () => {
    expect(origineMouvement(m)).toBe('Réception d’achat');
    expect(origineMouvement({ source: { kind: 'invoice', invoiceId: 'f', lineIndex: 0 } })).toBe(
      'Facture de vente',
    );
  });

  it('motif d’un ajustement : la note, sinon la clé', () => {
    expect(motifMouvement(m)).toBeNull();
    expect(motifMouvement({ reason: { key: 'breakage', note: null } })).toBe('breakage');
    expect(motifMouvement({ reason: { key: 'other', note: 'Casse au déchargement' } })).toBe(
      'Casse au déchargement',
    );
  });
});
