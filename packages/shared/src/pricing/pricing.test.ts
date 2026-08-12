// Tests du catalogue des offres.
//
// Ce ne sont pas des tests de forme : chaque cas ci-dessous protège une PROMESSE
// COMMERCIALE ou une règle de sécurité de vente. Un catalogue est une donnée, et
// une donnée fausse se déploie aussi vite qu'un bon code.

import { describe, expect, it } from 'vitest';

import {
  annualFreeMonths,
  annualSavingPercent,
  BILLING_CURRENCY,
  formatQuota,
  GRACE_DAYS,
  hasAnnualOffer,
  intervalDays,
  isPlan,
  isSellable,
  isSelfServePlan,
  monthWindowReset,
  monthWindowStart,
  PLAN_CATALOG,
  PLAN_ENTITLEMENTS,
  PLAN_PRICES,
  PLANS,
  planRank,
  priceCents,
  SELF_SERVE_PLANS,
  TRIAL_DAYS,
  TRIAL_PLAN,
  usdFromCents,
  type Plan,
} from './index.js';

describe('grille tarifaire', () => {
  it('porte exactement les cinq offres arbitrées', () => {
    expect(PLANS).toEqual(['free', 'pro', 'cabinet', 'business', 'expert']);
  });

  it('publie les montants mensuels de la grille', () => {
    expect(PLAN_PRICES.free.monthCents).toBe(0);
    expect(PLAN_PRICES.pro.monthCents).toBe(1900);
    expect(PLAN_PRICES.cabinet.monthCents).toBe(3900);
    expect(PLAN_PRICES.business.monthCents).toBe(7900);
    // Sur devis : aucun montant, et surtout pas 0 — qui serait « gratuit ».
    expect(PLAN_PRICES.expert.monthCents).toBeNull();
  });

  it('publie les montants annuels de la grille', () => {
    expect(PLAN_PRICES.pro.yearCents).toBe(19000);
    expect(PLAN_PRICES.cabinet.yearCents).toBe(39000);
    // C'est la nouveauté : Business a désormais un tarif annuel publié.
    expect(PLAN_PRICES.business.yearCents).toBe(79000);
    expect(PLAN_PRICES.expert.yearCents).toBeNull();
  });

  it('facture en USD, en centimes entiers', () => {
    expect(BILLING_CURRENCY).toBe('USD');
    for (const plan of PLANS) {
      for (const cents of [PLAN_PRICES[plan].monthCents, PLAN_PRICES[plan].yearCents]) {
        if (cents !== null) expect(Number.isInteger(cents)).toBe(true);
      }
    }
  });
});

describe('limites appliquées', () => {
  it('reprend la grille projet par projet', () => {
    expect(PLAN_ENTITLEMENTS.free.maxProjects).toBe(1);
    expect(PLAN_ENTITLEMENTS.pro.maxProjects).toBe(5);
    expect(PLAN_ENTITLEMENTS.cabinet.maxProjects).toBe(20);
    expect(PLAN_ENTITLEMENTS.business.maxProjects).toBeNull();
    expect(PLAN_ENTITLEMENTS.expert.maxProjects).toBeNull();
  });

  it('reprend la grille des exports PDF', () => {
    expect(PLAN_ENTITLEMENTS.free.pdfExportsPerMonth).toBe(3);
    expect(PLAN_ENTITLEMENTS.free.pdfWatermark).toBe(true);
    expect(PLAN_ENTITLEMENTS.pro.pdfExportsPerMonth).toBe(30);
    expect(PLAN_ENTITLEMENTS.cabinet.pdfExportsPerMonth).toBe(100);
    expect(PLAN_ENTITLEMENTS.business.pdfExportsPerMonth).toBeNull();
    expect(PLAN_ENTITLEMENTS.expert.pdfExportsPerMonth).toBeNull();
  });

  it('reprend la grille des messages IA', () => {
    expect(PLAN_ENTITLEMENTS.free.aiMessagesPerMonth).toBe(20);
    expect(PLAN_ENTITLEMENTS.pro.aiMessagesPerMonth).toBe(500);
    expect(PLAN_ENTITLEMENTS.cabinet.aiMessagesPerMonth).toBe(1500);
    expect(PLAN_ENTITLEMENTS.business.aiMessagesPerMonth).toBe(2000);
    expect(PLAN_ENTITLEMENTS.expert.aiMessagesPerMonth).toBeNull();
  });

  it('reprend la grille des sièges', () => {
    expect(PLAN_ENTITLEMENTS.free.seats).toBe(1);
    expect(PLAN_ENTITLEMENTS.pro.seats).toBe(1);
    expect(PLAN_ENTITLEMENTS.cabinet.seats).toBe(3);
    expect(PLAN_ENTITLEMENTS.business.seats).toBe(20);
    // Négocié au contrat : `null`, jamais un nombre inventé.
    expect(PLAN_ENTITLEMENTS.expert.seats).toBeNull();
  });

  it("n'ouvre le suivi du réalisé qu'à partir de Pro", () => {
    expect(PLAN_ENTITLEMENTS.free.actualsEnabled).toBe(false);
    for (const plan of ['pro', 'cabinet', 'business', 'expert'] as Plan[]) {
      expect(PLAN_ENTITLEMENTS[plan].actualsEnabled).toBe(true);
    }
  });

  it("aucune offre ne promet moins que l'offre inférieure", () => {
    // Régression classique d'une grille écrite à la main : une ligne recopiée de
    // travers rend une offre plus chère strictement moins généreuse.
    const echelle = [...PLANS];
    for (let i = 1; i < echelle.length; i += 1) {
      const bas = PLAN_ENTITLEMENTS[echelle[i - 1]!]!;
      const haut = PLAN_ENTITLEMENTS[echelle[i]!]!;
      for (const cle of ['maxProjects', 'pdfExportsPerMonth', 'aiMessagesPerMonth'] as const) {
        // `null` = illimité : il domine toujours.
        if (haut[cle] === null) continue;
        expect(bas[cle], `${echelle[i]} régresse sur ${cle}`).not.toBeNull();
        expect(haut[cle]!).toBeGreaterThanOrEqual(bas[cle]!);
      }
      if (!bas.pdfWatermark) expect(haut.pdfWatermark).toBe(false);
      if (bas.actualsEnabled) expect(haut.actualsEnabled).toBe(true);
    }
  });
});

describe('ce qui se vend en un clic, et ce qui ne se vend pas', () => {
  it('ne met en libre-service que les trois offres payantes livrables sans négociation', () => {
    expect(SELF_SERVE_PLANS).toEqual(['pro', 'cabinet', 'business']);
  });

  it("Expert n'est pas souscriptible, quelle que soit la périodicité", () => {
    // Le cœur de la règle : le pack inclut du temps d'expert humain. Un bouton
    // de paiement engagerait une livraison qu'aucun accord commercial ne couvre.
    expect(isSelfServePlan('expert')).toBe(false);
    expect(isSellable('expert', 'month')).toBe(false);
    expect(isSellable('expert', 'year')).toBe(false);
    expect(hasAnnualOffer('expert')).toBe(false);
    expect(priceCents('expert', 'month')).toBeNull();
    expect(priceCents('expert', 'year')).toBeNull();
  });

  it("Free n'est pas un achat", () => {
    expect(isSellable('free', 'month')).toBe(false);
    expect(isSellable('free', 'year')).toBe(false);
  });

  it('ouvre les deux périodicités sur les trois offres payantes', () => {
    for (const plan of SELF_SERVE_PLANS) {
      expect(isSellable(plan, 'month')).toBe(true);
      expect(isSellable(plan, 'year'), `${plan} sans annuel`).toBe(true);
      expect(hasAnnualOffer(plan)).toBe(true);
    }
  });
});

describe('rang commercial', () => {
  it("classe les offres du gratuit à l'expert", () => {
    expect(planRank('free')).toBeLessThan(planRank('pro'));
    expect(planRank('pro')).toBeLessThan(planRank('cabinet'));
    expect(planRank('cabinet')).toBeLessThan(planRank('business'));
    expect(planRank('business')).toBeLessThan(planRank('expert'));
  });

  it('reste cohérent avec les tarifs publiés', () => {
    // Le rang ne dérive plus du prix (Expert n'en a pas) : ce test vérifie que
    // les deux ne divergent pas pour autant sur les offres qui ont un tarif.
    const tarifes = PLANS.filter((p) => PLAN_PRICES[p].monthCents !== null);
    for (let i = 1; i < tarifes.length; i += 1) {
      expect(PLAN_PRICES[tarifes[i]!]!.monthCents!).toBeGreaterThan(
        PLAN_PRICES[tarifes[i - 1]!]!.monthCents!,
      );
    }
  });
});

describe('économie annuelle', () => {
  it('annonce deux mois offerts sur les trois offres payantes', () => {
    // 19 × 12 = 228, payé 190 → 38 économisés = exactement 2 mois.
    for (const plan of SELF_SERVE_PLANS) {
      expect(annualFreeMonths(plan), `${plan}`).toBe(2);
    }
  });

  it("n'arrondit jamais l'économie vers le haut", () => {
    // 38/228 = 16,66 % → 16 %, jamais 17 %.
    expect(annualSavingPercent('pro')).toBe(16);
    expect(annualSavingPercent('cabinet')).toBe(16);
    expect(annualSavingPercent('business')).toBe(16);
  });

  it("n'annonce aucune économie là où aucun tarif n'est publié", () => {
    expect(annualSavingPercent('expert')).toBeNull();
    expect(annualFreeMonths('expert')).toBeNull();
    expect(annualSavingPercent('free')).toBeNull();
  });
});

describe('essai et grâce', () => {
  it("accorde Pro pendant l'essai, pas Business", () => {
    expect(TRIAL_PLAN).toBe('pro');
    expect(TRIAL_DAYS).toBe(14);
    expect(GRACE_DAYS).toBe(7);
  });
});

describe('utilitaires', () => {
  it('reconnaît les identifiants d’offre valides', () => {
    expect(isPlan('cabinet')).toBe(true);
    expect(isPlan('enterprise')).toBe(false);
    expect(isPlan(null)).toBe(false);
  });

  it('convertit les centimes en montant affichable', () => {
    expect(usdFromCents(1900)).toBe(19);
    expect(usdFromCents(0)).toBe(0);
    expect(usdFromCents(null)).toBeNull();
  });

  it('nomme une absence de limite « Illimité »', () => {
    expect(formatQuota(null, 'messages')).toBe('Illimité');
    expect(formatQuota(500, 'messages')).toBe('500 messages');
  });

  it('compte 30 jours pour un mois et 365 pour un an', () => {
    expect(intervalDays('month')).toBe(30);
    expect(intervalDays('year')).toBe(365);
  });

  it('catalogue et raccourcis restent cohérents', () => {
    for (const plan of PLANS) {
      expect(PLAN_ENTITLEMENTS[plan]).toBe(PLAN_CATALOG[plan].entitlements);
      expect(PLAN_PRICES[plan]).toBe(PLAN_CATALOG[plan].price);
      expect(PLAN_CATALOG[plan].slug).toBe(plan);
      expect(PLAN_CATALOG[plan].name.length).toBeGreaterThan(0);
      expect(PLAN_CATALOG[plan].tagline.length).toBeGreaterThan(10);
    }
  });
});

describe('fenêtre mensuelle des quotas', () => {
  it('démarre le 1er du mois à 00:00 UTC', () => {
    const debut = monthWindowStart(new Date('2026-08-12T14:31:00.000Z'));
    expect(debut.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('se réinitialise le 1er du mois suivant', () => {
    expect(monthWindowReset(new Date('2026-08-12T14:31:00.000Z')).toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
    // Passage d'année : décembre → janvier suivant.
    expect(monthWindowReset(new Date('2026-12-31T23:59:59.000Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  it('ignore le fuseau du serveur', () => {
    // Le même instant, exprimé deux fois, doit produire la même fenêtre : sinon
    // deux instances déployées dans deux fuseaux réinitialiseraient le quota à
    // des moments différents pour le même utilisateur.
    const instant = new Date('2026-08-01T00:30:00.000Z');
    expect(monthWindowStart(instant).getTime()).toBe(
      monthWindowStart(new Date(instant.getTime())).getTime(),
    );
    expect(monthWindowStart(instant).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('la borne de début est incluse dans son propre mois', () => {
    const debut = monthWindowStart(new Date('2026-08-12T00:00:00.000Z'));
    expect(monthWindowStart(debut).getTime()).toBe(debut.getTime());
  });
});
