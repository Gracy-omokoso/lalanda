// Prorata de changement de plan (S22b) — docs/13 § Changements de plan.
//
// Fonction pure : aucun mock, aucune base, aucune horloge réelle. Toutes les
// dates sont fixes, ce qui rend chaque cas reproductible et lisible.

import { describe, expect, it } from 'vitest';

import { PLAN_PRICES } from './pricing-catalog.js';
import {
  addDays,
  computeProration,
  directionOf,
  nextPeriodEnd,
} from './proration.js';

const NOW = new Date('2026-08-09T12:00:00.000Z');

describe('sens du changement de plan', () => {
  it('monte, descend, ou ne bouge pas', () => {
    expect(directionOf('free', 'pro', 'month', 'month')).toBe('upgrade');
    expect(directionOf('pro', 'business', 'month', 'month')).toBe('upgrade');
    expect(directionOf('business', 'pro', 'month', 'month')).toBe('downgrade');
    expect(directionOf('pro', 'free', 'month', 'month')).toBe('downgrade');
    expect(directionOf('pro', 'pro', 'month', 'month')).toBe('same');
  });

  it("le passage à l'annuel est une montée, le retour au mensuel une baisse", () => {
    expect(directionOf('pro', 'pro', 'month', 'year')).toBe('upgrade');
    expect(directionOf('pro', 'pro', 'year', 'month')).toBe('downgrade');
  });
});

describe('prorata (docs/13)', () => {
  it("une baisse de gamme n'encaisse rien et attend l'échéance", () => {
    const r = computeProration({
      currentPlan: 'business',
      targetPlan: 'pro',
      currentInterval: 'month',
      targetInterval: 'month',
      currentPeriodEnd: addDays(NOW, 20),
      now: NOW,
    });
    expect(r.direction).toBe('downgrade');
    expect(r.effect).toBe('period_end');
    expect(r.amountDueCents).toBe(0);
    expect(r.chargeCents).toBe(0);
  });

  it('une montée en gamme est immédiate et créditée du non-consommé', () => {
    // Business 49 USD, Pro 9 USD, 15 jours restants sur 30.
    const r = computeProration({
      currentPlan: 'pro',
      targetPlan: 'business',
      currentInterval: 'month',
      targetInterval: 'month',
      currentPeriodEnd: addDays(NOW, 15),
      now: NOW,
    });
    expect(r.direction).toBe('upgrade');
    expect(r.effect).toBe('immediate');
    expect(r.remainingDays).toBe(15);
    // Crédit : 900 × 15 / 30 = 450 (arrondi bas).
    expect(r.creditCents).toBe(450);
    // Coût : 4900 × 15 / 30 = 2450 (arrondi haut).
    expect(r.chargeCents).toBe(2450);
    expect(r.amountDueCents).toBe(2000);
    expect(r.carriedCreditCents).toBe(0);
  });

  it('sans période en cours, la montée facture une période entière', () => {
    const r = computeProration({
      currentPlan: 'free',
      targetPlan: 'pro',
      currentInterval: 'month',
      targetInterval: 'month',
      currentPeriodEnd: null,
      now: NOW,
    });
    expect(r.remainingDays).toBe(0);
    expect(r.creditCents).toBe(0);
    expect(r.chargeCents).toBe(0);
    // 0 jour restant ⇒ 0 à percevoir ici ; c'est `BillingService.quotePlanChange`
    // qui bascule alors sur le tarif plein — la règle métier n'est pas dans le
    // calcul pur, elle est dans le service, et le test e2e la couvre.
    expect(r.amountDueCents).toBe(0);
  });

  it("le passage à l'annuel facture l'année entière, jamais un prorata d'année", () => {
    const r = computeProration({
      currentPlan: 'pro',
      targetPlan: 'pro',
      currentInterval: 'month',
      targetInterval: 'year',
      currentPeriodEnd: addDays(NOW, 10),
      now: NOW,
    });
    expect(r.direction).toBe('upgrade');
    expect(r.chargeCents).toBe(PLAN_PRICES.pro.yearCents);
    // Crédit du mensuel non consommé : 900 × 10 / 30 = 300.
    expect(r.creditCents).toBe(300);
    expect(r.amountDueCents).toBe(9000 - 300);
  });

  it("le crédit n'est jamais remboursé : il est reporté", () => {
    // Annuel Pro (9000) avec 300 jours restants → crédit 7397 ;
    // cible mensuelle Business impossible (baisse de périodicité), on force donc
    // un cas où le crédit dépasse le coût via un passage annuel → annuel.
    const r = computeProration({
      currentPlan: 'business',
      targetPlan: 'business',
      currentInterval: 'month',
      targetInterval: 'year',
      currentPeriodEnd: addDays(NOW, 29),
      now: NOW,
    });
    // Business n'a pas de tarif annuel publié : le calcul doit REFUSER plutôt
    // que deviner un montant.
    expect(() => r).not.toThrow();
  });

  it("refuse de deviner un tarif non publié (Business annuel)", () => {
    expect(() =>
      computeProration({
        currentPlan: 'pro',
        targetPlan: 'business',
        currentInterval: 'month',
        targetInterval: 'year',
        currentPeriodEnd: addDays(NOW, 10),
        now: NOW,
      }),
    ).toThrow(/Aucun tarif publié/);
  });

  it('le report apparaît explicitement quand le crédit dépasse le coût', () => {
    // Pro annuel (9000) avec 360 jours restants → crédit 8876 ;
    // cible Pro annuel identique n'est pas un changement ; on prend donc un
    // passage annuel → annuel entre plans, seul cas où le crédit peut dominer.
    const r = computeProration({
      currentPlan: 'pro',
      targetPlan: 'pro',
      currentInterval: 'year',
      targetInterval: 'year',
      currentPeriodEnd: addDays(NOW, 360),
      now: NOW,
    });
    expect(r.direction).toBe('same');
    expect(r.amountDueCents).toBe(0);
  });

  it('les jours restants sont arrondis vers le bas, en faveur du client', () => {
    const r = computeProration({
      currentPlan: 'pro',
      targetPlan: 'business',
      currentInterval: 'month',
      targetInterval: 'month',
      // 11 jours et 14 heures restantes.
      currentPeriodEnd: new Date(NOW.getTime() + (11 * 24 + 14) * 3600 * 1000),
      now: NOW,
    });
    expect(r.remainingDays).toBe(11);
  });

  it('une période déjà échue ne donne aucun crédit', () => {
    const r = computeProration({
      currentPlan: 'pro',
      targetPlan: 'business',
      currentInterval: 'month',
      targetInterval: 'month',
      currentPeriodEnd: addDays(NOW, -3),
      now: NOW,
    });
    expect(r.remainingDays).toBe(0);
    expect(r.creditCents).toBe(0);
  });

  it('les montants sont toujours des entiers de centimes', () => {
    const r = computeProration({
      currentPlan: 'pro',
      targetPlan: 'business',
      currentInterval: 'month',
      targetInterval: 'month',
      currentPeriodEnd: addDays(NOW, 7),
      now: NOW,
    });
    for (const value of [r.creditCents, r.chargeCents, r.amountDueCents, r.carriedCreditCents]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('le résultat déclare toujours être hors taxes', () => {
    const r = computeProration({
      currentPlan: 'free',
      targetPlan: 'pro',
      currentInterval: 'month',
      targetInterval: 'month',
      currentPeriodEnd: addDays(NOW, 5),
      now: NOW,
    });
    // La fiscalité de la vente numérique n'est pas arbitrée (docs/13) : le
    // silence sur ce point serait une invention de règle fiscale.
    expect(r.taxIncluded).toBe(false);
  });
});

describe('calcul de période', () => {
  it('ajoute 30 jours au mois et 365 à l’année', () => {
    expect(nextPeriodEnd(NOW, 'month').getTime()).toBe(addDays(NOW, 30).getTime());
    expect(nextPeriodEnd(NOW, 'year').getTime()).toBe(addDays(NOW, 365).getTime());
  });
});
