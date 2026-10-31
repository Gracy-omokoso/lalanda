// « À traiter » (ADR-0046 § 2.6) : droit par motif, saisie exigée, corps.

import { describe, expect, it } from 'vitest';

import {
  RAISON_COUT,
  SAISIE_VIDE,
  champsResolution,
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
    const l = {
      id: 'p',
      reason: 'pending_cost' as const,
      status: 'open' as const,
      label: 'x',
      itemRef: null,
      itemId: null,
      quantity: '1',
      unit: 'u',
      currency: 'CDF' as const,
      createdAt: '',
      revision: 1,
    };
    expect(deviseVisible(l, PROPRIETAIRE)).toBe('CDF');
    expect(deviseVisible(l, MAGASINIER)).toBeNull();
  });
});
