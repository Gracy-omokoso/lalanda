// Emplacements (§ 2.2), niveaux (§ 2.5) et grand livre (§ 2.3).

import { describe, expect, it } from 'vitest';

import {
  RAISON_EMPLACEMENT_DEFAUT,
  formulaireEmplacement,
  gestesEmplacement,
  preparerEmplacement,
} from './emplacements-model';
import { MAGASINIER, PROPRIETAIRE, emplacement, niveau } from './fixtures.test-utils';
import {
  FILTRES_VIDES,
  coutAffiche,
  origineMouvement,
  requeteMouvements,
} from './mouvements-model';
import { etatNiveau, requeteNiveaux } from './niveaux-model';

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
  it('requête : emplacement, sous le seuil, curseur', () => {
    expect(requeteNiveaux('', false)).toEqual({ limit: 100 });
    expect(requeteNiveaux('L', true, 'c')).toEqual({
      limit: 100,
      locationId: 'L',
      below: 'reorder',
      cursor: 'c',
    });
  });

  it('état d’une ligne : négatif, rupture, sous le seuil (moteur), rien', () => {
    expect(etatNiveau(niveau({ quantity: '-1' })).libelle).toBe('Négatif');
    expect(etatNiveau(niveau({ quantity: '0' })).libelle).toBe('Rupture');
    expect(etatNiveau(niveau({ quantity: '4', belowReorder: true }))).toEqual({
      libelle: 'Sous le seuil',
      ton: 'warning',
    });
    expect(etatNiveau(niveau({ quantity: '40', belowReorder: false })).libelle).toBeNull();
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
    source: { kind: 'reception' as const },
    workProjectId: null,
    transferId: null,
    reason: null,
    reversalOf: null,
    createdBy: null,
    createdAt: '2026-10-30T08:00:00Z',
  };

  it('coût d’entrée seulement si les valeurs sont visibles', () => {
    expect(coutAffiche(m, false)).toBeNull();
    expect(coutAffiche(m, true)).toBe('1.000000');
    expect(coutAffiche({ ...m, costStatus: 'pending_cost', unitCost: null }, true)).toBe(
      'coût à saisir',
    );
  });

  it('origine : pièce servie par l’API, sinon la nature de la source', () => {
    expect(origineMouvement(m)).toBe('Réception d’achat');
    expect(origineMouvement({ ...m, sourceLabel: 'BS2610-000004' })).toBe('BS2610-000004');
    expect(origineMouvement({ ...m, source: null })).toBeNull();
  });
});
