import { PLAN_CATALOG, SUBSCRIPTION_TAX, priceCents } from '@lalanda/shared/pricing';
import { describe, expect, it } from 'vitest';

import { decimalToCents, subscriptionAmounts } from './index.js';

describe('ADR-0047 — montants des abonnements (HT + TVA 16 %)', () => {
  it('19,00 USD HT → 3,04 de TVA, 22,04 TTC, groupe B', () => {
    const a = subscriptionAmounts({ cents: 1900, mode: 'ht' });
    expect(a).toMatchObject({
      exclTaxCents: 1900,
      taxCents: 304,
      totalCents: 2204,
      taxGroup: SUBSCRIPTION_TAX.taxGroup,
      ratePercent: '16',
    });
  });

  it('la somme encaissée, relue en TTC, redonne la base HT de la grille (toutes offres)', () => {
    for (const plan of Object.keys(PLAN_CATALOG) as (keyof typeof PLAN_CATALOG)[]) {
      for (const interval of ['month', 'year'] as const) {
        const ht = priceCents(plan, interval);
        if (ht === null || ht === 0) continue;
        const paid = subscriptionAmounts({ cents: ht, mode: 'ht' });
        const back = subscriptionAmounts({ cents: paid.totalCents, mode: 'ttc' });
        expect(back.exclTaxCents, `${plan}/${interval}`).toBe(ht);
        expect(back.taxCents, `${plan}/${interval}`).toBe(paid.taxCents);
        expect(back.totalCents, `${plan}/${interval}`).toBe(paid.totalCents);
      }
    }
  });

  it('aller-retour HT → TTC → HT exact sur des montants de prorata', () => {
    for (let cents = 1; cents <= 5000; cents += 7) {
      const paid = subscriptionAmounts({ cents, mode: 'ht' });
      expect(paid.exclTaxCents + paid.taxCents).toBe(paid.totalCents);
      const back = subscriptionAmounts({ cents: paid.totalCents, mode: 'ttc' });
      expect(back.exclTaxCents, String(cents)).toBe(cents);
    }
  });

  it('zéro donne zéro, sans appel au calcul', () => {
    expect(subscriptionAmounts({ cents: 0, mode: 'ht' })).toMatchObject({
      exclTaxCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });

  it('decimalToCents : exact, refuse ce qui n’est pas un montant à deux décimales', () => {
    expect(decimalToCents('22.04')).toBe(2204);
    expect(decimalToCents('7')).toBe(700);
    expect(decimalToCents('0.5')).toBe(50);
    expect(decimalToCents('1.234')).toBeNull();
    expect(decimalToCents('-1.00')).toBeNull();
  });
});
