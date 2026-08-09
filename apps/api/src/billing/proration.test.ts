// Prorata de changement de plan (S22b) — docs/13 § Changements de plan.
//
// Fonction pure : aucun mock, aucune base, aucune horloge réelle. Toutes les
// dates sont fixes, ce qui rend chaque cas reproductible et lisible.

import { describe, expect, it } from 'vitest';

import { PLAN_PRICES } from './pricing-catalog.js';
import { addDays, computeProration, directionOf, nextPeriodEnd } from './proration.js';

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

  it('refuse de deviner un tarif non publié (Business annuel)', () => {
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

  // ── Invariant de non-remboursement ────────────────────────────────────────
  //
  // Balayage exhaustif de tous les changements calculables : 3 plans × 2
  // périodicités en source, autant en cible, sur 0 → 365 jours restants. Le but
  // n'est pas d'ajouter des cas, c'est d'interdire une régression silencieuse :
  // un `amountDueCents` négatif serait un VIREMENT vers le client déclenché par
  // un changement de plan.
  const ALL_PLANS = ['free', 'pro', 'business'] as const;
  const ALL_INTERVALS = ['month', 'year'] as const;

  function sweep(visit: (r: ReturnType<typeof computeProration>) => void): number {
    let visited = 0;
    for (const currentPlan of ALL_PLANS) {
      for (const targetPlan of ALL_PLANS) {
        for (const currentInterval of ALL_INTERVALS) {
          for (const targetInterval of ALL_INTERVALS) {
            for (const remaining of [0, 1, 7, 15, 29, 30, 180, 364, 365]) {
              let result;
              try {
                result = computeProration({
                  currentPlan,
                  targetPlan,
                  currentInterval,
                  targetInterval,
                  currentPeriodEnd: addDays(NOW, remaining),
                  now: NOW,
                });
              } catch (error) {
                // Seul refus toléré : un couple (plan, périodicité) non publié.
                expect((error as Error).message).toMatch(/Aucun tarif publié/);
                continue;
              }
              visited += 1;
              visit(result);
            }
          }
        }
      }
    }
    return visited;
  }

  it('aucun changement de plan ne produit jamais de remboursement', () => {
    const visited = sweep((r) => {
      expect(r.amountDueCents).toBeGreaterThanOrEqual(0);
      expect(r.carriedCreditCents).toBeGreaterThanOrEqual(0);
      // Décomposition exacte : ce qui n'est pas encaissé est reporté, rien ne
      // disparaît et rien n'est rendu.
      expect(r.amountDueCents - r.carriedCreditCents).toBe(r.chargeCents - r.creditCents);
      // Un crédit et un encaissement simultanés seraient une double écriture.
      expect(r.amountDueCents === 0 || r.carriedCreditCents === 0).toBe(true);
    });
    expect(visited).toBeGreaterThan(200);
  });

  it('le crédit excédentaire est reporté, jamais remboursé (annuel Pro → mensuel Business)', () => {
    // Ce cas est le seul de la grille publiée où le crédit dépasse le coût, et
    // il est bien atteignable : un annuel Pro presque neuf (9000 c) qui passe à
    // Business mensuel n'est facturé qu'un mois (4900 c).
    const r = computeProration({
      currentPlan: 'pro',
      targetPlan: 'business',
      currentInterval: 'year',
      targetInterval: 'month',
      currentPeriodEnd: addDays(NOW, 364),
      now: NOW,
    });
    expect(r.direction).toBe('upgrade');
    expect(r.effect).toBe('immediate');
    // Crédit : 9000 × 364 / 365 = 8975 (arrondi bas).
    expect(r.creditCents).toBe(8975);
    // Coût : changement de périodicité ⇒ une période mensuelle entière.
    expect(r.chargeCents).toBe(4900);
    // Rien à percevoir, et surtout AUCUN remboursement des 4075 c restants :
    // ils sont reportés et affichés au client.
    expect(r.amountDueCents).toBe(0);
    expect(r.carriedCreditCents).toBe(4075);
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
