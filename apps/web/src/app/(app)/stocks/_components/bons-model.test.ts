// Bons (ADR-0046 § 2.4) : types proposés par droit, formulaire, gestes.

import { describe, expect, it } from 'vitest';

import {
  RAISON_AJUSTEMENT,
  emplacementsDuBon,
  formulaireBon,
  gestesBon,
  preparerBon,
  requeteBons,
  trajetBon,
  typesBon,
} from './bons-model';
import {
  COMMERCIAL,
  COMPTABLE,
  ID1,
  ID2,
  MAGASINIER,
  PROPRIETAIRE,
  bon,
} from './fixtures.test-utils';

const AUJ = '2026-10-31';

describe('types de bon proposés', () => {
  it('Magasinier : sortie, entrée, transfert, retour ; ajustement désactivé avec sa raison', () => {
    const t = typesBon(MAGASINIER);
    expect(t.map((x) => [x.kind, x.actif])).toEqual([
      ['issue', true],
      ['issue_return', true],
      ['transfer', true],
      ['adjustment', false],
      ['supplier_return', true],
    ]);
    expect(t[3]!.raison).toBe(RAISON_AJUSTEMENT);
  });

  it('Commercial (lecture seule) : aucun ; Comptable : l’ajustement seulement', () => {
    expect(typesBon(COMMERCIAL)).toEqual([]);
    expect(
      typesBon(COMPTABLE)
        .filter((x) => x.actif)
        .map((x) => x.kind),
    ).toEqual(['adjustment']);
    expect(typesBon(PROPRIETAIRE).every((x) => x.actif)).toBe(true);
  });

  it('emplacements exigés par type', () => {
    expect(emplacementsDuBon('transfer')).toEqual({ depart: true, arrivee: true });
    expect(emplacementsDuBon('issue_return')).toEqual({ depart: false, arrivee: true });
    expect(emplacementsDuBon('issue')).toEqual({ depart: true, arrivee: false });
  });

  it('filtres', () => {
    expect(requeteBons('tous')).toEqual({ limit: 50 });
    expect(requeteBons('posted', 'c')).toEqual({ limit: 50, status: 'posted', cursor: 'c' });
  });
});

describe('formulaire', () => {
  const ligne = {
    itemId: ID1,
    itemName: 'Ciment',
    unit: 'sac',
    quantity: '4',
    sens: 'out' as const,
    note: '',
  };

  it('bon de sortie : corps, emplacement par défaut, projet facultatif', () => {
    const f = { ...formulaireBon('issue', AUJ, ID2), lignes: [ligne], workProjectId: 'p1' };
    expect(preparerBon(f, AUJ)).toEqual({
      ok: true,
      corps: {
        kind: 'issue',
        fromLocationId: ID2,
        toLocationId: null,
        lines: [{ itemId: ID1, quantity: '4', note: null }],
        workProjectId: 'p1',
        recipient: null,
        reason: null,
        reasonNote: null,
        postedOn: AUJ,
      },
    });
  });

  it('transfert : deux emplacements distincts', () => {
    const f = { ...formulaireBon('transfer', AUJ, ID2), lignes: [ligne], toLocationId: ID2 };
    const p = preparerBon(f, AUJ);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.champs['to']).toMatch(/AUTRE/);
  });

  it('date future refusée ; article et quantité exigés', () => {
    const p = preparerBon(
      {
        ...formulaireBon('issue', AUJ, ID2),
        postedOn: '2026-11-01',
        lignes: [{ ...ligne, itemId: '', quantity: '0' }],
      },
      AUJ,
    );
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(Object.keys(p.champs).sort()).toEqual([
        'ligne-0-item',
        'ligne-0-quantity',
        'postedOn',
      ]);
    }
  });

  it('ajustement : motif obligatoire ; le sens devient le signe', () => {
    const sans = preparerBon({ ...formulaireBon('adjustment', AUJ, ID2), lignes: [ligne] }, AUJ);
    expect(sans.ok).toBe(false);
    const p = preparerBon(
      {
        ...formulaireBon('adjustment', AUJ, ID2),
        reason: 'breakage',
        lignes: [ligne, { ...ligne, itemId: ID2, sens: 'in', quantity: '1,5' }],
      },
      AUJ,
    );
    expect(p.ok && p.corps.lines.map((l) => l.quantity)).toEqual(['-4', '1.5']);
    expect(p.ok && p.corps.reason).toBe('breakage');
  });
});

describe('gestes d’un bon', () => {
  it('brouillon : passer ; passé : annuler ; annulé : rien', () => {
    expect(gestesBon(bon(), MAGASINIER).map((g) => [g.id, g.actif])).toEqual([['passer', true]]);
    expect(gestesBon(bon({ status: 'posted' }), MAGASINIER).map((g) => g.id)).toEqual(['annuler']);
    expect(gestesBon(bon({ status: 'cancelled' }), PROPRIETAIRE)).toEqual([]);
  });

  it('un ajustement reste au Magasinier visible mais désactivé', () => {
    expect(gestesBon(bon({ kind: 'adjustment' }), MAGASINIER)[0]).toMatchObject({
      actif: false,
      raison: RAISON_AJUSTEMENT,
    });
  });

  it('trajet lisible', () => {
    const nom = (id: string) => (id === ID1 ? 'Magasin' : 'Chantier');
    expect(trajetBon(bon({ kind: 'transfer', toLocationId: ID2 }), nom)).toBe('Magasin → Chantier');
    expect(trajetBon(bon({ fromLocationId: null, toLocationId: ID2 }), nom)).toBe('vers Chantier');
  });
});
