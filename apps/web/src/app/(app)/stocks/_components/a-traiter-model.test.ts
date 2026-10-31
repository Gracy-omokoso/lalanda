// « À traiter » (ADR-0046 § 2.6) : droit par motif, saisie exigée, corps.

import { describe, expect, it } from 'vitest';

import type { StockPendingLineView } from '@/lib/api-stock';

import {
  RAISON_COUT,
  SAISIE_VIDE,
  champsResolution,
  affichageATraiter,
  deviseVisible,
  droitATraiter,
  preparerResolution,
} from './a-traiter-model';
import { COMMERCIAL, COMPTABLE, ID1, MAGASINIER, PROPRIETAIRE } from './fixtures.test-utils';

describe('droits', () => {
  it('Magasinier : rattacher et confirmer un retour, jamais saisir un coût', () => {
    expect(droitATraiter('unknown_item', MAGASINIER).actif).toBe(true);
    expect(droitATraiter('sale_return_proposed', MAGASINIER).actif).toBe(true);
    expect(droitATraiter('pending_cost', MAGASINIER)).toEqual({
      actif: false,
      raison: RAISON_COUT,
    });
    expect(droitATraiter('cost_differs', MAGASINIER).actif).toBe(false);
  });

  it('Comptable : les coûts, pas les mouvements ; Commercial : rien', () => {
    expect(droitATraiter('pending_cost', COMPTABLE).actif).toBe(true);
    expect(droitATraiter('unknown_unit', COMPTABLE).actif).toBe(false);
    expect(droitATraiter('unknown_item', COMMERCIAL).actif).toBe(false);
  });
});

describe('résolution', () => {
  it('chaque motif demande ses champs', () => {
    expect(champsResolution('unknown_item')).toMatchObject({ article: true, cout: false });
    expect(champsResolution('sale_return_proposed')).toMatchObject({
      quantite: true,
      emplacement: true,
    });
    expect(champsResolution('pending_cost').explication).toMatch(/aucun taux/);
  });

  it('corps : seuls les champs du motif, révision attendue', () => {
    expect(
      preparerResolution(
        { reason: 'unknown_item', revision: 4 },
        { ...SAISIE_VIDE, itemId: ID1, unitCost: '9' },
      ),
    ).toEqual({
      ok: true,
      corps: { expectedRevision: 4, itemId: ID1 },
    });
    expect(
      preparerResolution(
        { reason: 'sale_return_proposed', revision: 1 },
        { ...SAISIE_VIDE, quantity: '2', locationId: 'L' },
      ),
    ).toEqual({ ok: true, corps: { expectedRevision: 1, quantity: '2', locationId: 'L' } });
    const p = preparerResolution({ reason: 'pending_cost', revision: 1 }, SAISIE_VIDE);
    expect(p.ok).toBe(false);
    expect(
      preparerResolution({ reason: 'unknown_unit', revision: 1 }, { ...SAISIE_VIDE, factor: '0' })
        .ok,
    ).toBe(false);
  });

  it('la devise d’une ligne n’apparaît qu’à qui voit les valeurs', () => {
    expect(deviseVisible(LIGNE, PROPRIETAIRE)).toBe('CDF');
    expect(deviseVisible(LIGNE, MAGASINIER)).toBeNull();
  });

  it('la carte se lit dans la proposition servie par l’API (ADR-0046 S4)', () => {
    expect(affichageATraiter(LIGNE)).toEqual({
      libelle: 'Gobelets',
      quantite: '2',
      unite: 'carton',
      origine: 'Réception d’achat',
    });
    expect(
      affichageATraiter({ proposal: { ...LIGNE.proposal, label: null, itemRef: 'GOB', unit: '' } }),
    ).toMatchObject({ libelle: 'GOB', unite: null });
  });

  it('sortie de vente proposée : rien à saisir, on confirme ou on classe', () => {
    const c = champsResolution('sale_issue_proposed');
    expect([c.article, c.facteur, c.quantite, c.cout, c.emplacement]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(droitATraiter('sale_issue_proposed', MAGASINIER).actif).toBe(true);
    expect(preparerResolution({ reason: 'sale_issue_proposed', revision: 2 }, SAISIE_VIDE)).toEqual(
      { ok: true, corps: { expectedRevision: 2 } },
    );
  });
});

const LIGNE: StockPendingLineView = {
  id: 'p',
  reason: 'pending_cost',
  status: 'open',
  sourceKey: 'pending_cost:m1',
  proposal: {
    movementKind: 'purchase_receipt',
    movementSourceKey: 'reception:r1:l1:in',
    source: { kind: 'reception', receptionId: 'r1', orderLineId: 'l1' },
    itemId: null,
    itemRef: null,
    label: 'Gobelets',
    quantity: '2',
    unit: 'carton',
    occurredOn: '2026-10-31',
    locationId: null,
    unitPrice: null,
    discountPercent: null,
    currency: 'CDF',
    workProjectId: null,
    orderId: 'o1',
    movementId: 'm1',
    maxQuantity: null,
    invoicedUnitCost: null,
  },
  movementId: null,
  closure: null,
  valuesHidden: false,
  revision: 1,
  createdAt: '',
  updatedAt: '',
};
