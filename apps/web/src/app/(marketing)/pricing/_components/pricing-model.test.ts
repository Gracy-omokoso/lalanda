// Contenu de la page tarifs (S22b).
//
// Ces tests ne vérifient pas « la page s'affiche » — ils vérifient que la
// PROMESSE COMMERCIALE tient. Une page qui annonce des projets illimités en Pro
// alors que l'API en autorise un est un litige, pas un bug d'affichage.
//
// Le catalogue de l'API ne peut pas être importé (le web ne dépend pas de
// `apps/api`) : les valeurs attendues sont donc recopiées ici, avec la référence
// du fichier qui fait foi. C'est la même discipline que `ORG_ROLES` dans
// `src/lib/api.ts`.

import { describe, expect, it } from 'vitest';

import {
  annualSavingPercent,
  COMPARISON,
  FAQ,
  formatPrice,
  hasAnnualOffer,
  PAYMENT_METHOD_LABELS,
  TIERS,
  TRIAL_DAYS,
  TRIAL_PLAN,
} from './pricing-model';

/** Miroir de `apps/api/src/billing/pricing-catalog.ts` — SOURCE DE VÉRITÉ. */
const API_PRICES = {
  free: { monthCents: 0, yearCents: 0 },
  pro: { monthCents: 900, yearCents: 9000 },
  business: { monthCents: 4900, yearCents: null },
} as const;

/** Miroir de `apps/api/src/billing/entitlements.ts`. */
const API_ENTITLEMENTS = {
  free: { maxProjects: 1, pdfWatermark: true },
  pro: { maxProjects: null, pdfWatermark: false },
  business: { maxProjects: null, pdfWatermark: false, seats: 20 },
} as const;

describe('grille tarifaire affichée', () => {
  it('annonce exactement les prix que l’API facture', () => {
    for (const tier of TIERS) {
      const expected = API_PRICES[tier.slug];
      expect((tier.priceMonthUsd ?? 0) * 100).toBe(expected.monthCents);
      if (expected.yearCents === null) {
        // Business : aucun tarif annuel publié. La page ne doit pas en inventer.
        expect(tier.priceYearUsd).toBeNull();
      } else if (expected.yearCents > 0) {
        expect((tier.priceYearUsd ?? 0) * 100).toBe(expected.yearCents);
      }
    }
  });

  it('ne propose la bascule annuelle que là où un tarif annuel existe', () => {
    expect(hasAnnualOffer('pro')).toBe(true);
    // Sans ce refus, un client choisirait « Business annuel » et se heurterait à
    // un `PLAN_NOT_SELLABLE` au bout du tunnel de paiement.
    expect(hasAnnualOffer('business')).toBe(false);
  });

  it("l'économie annoncée pour l'annuel n'est jamais surestimée", () => {
    // Pro : 9 × 12 = 108, payé 90 → 16,66 % d'économie. Arrondi bas ⇒ 16 %.
    expect(annualSavingPercent(TIERS.find((t) => t.slug === 'pro')!)).toBe(16);
    // Aucun tarif annuel publié ⇒ aucune économie affichée.
    expect(annualSavingPercent(TIERS.find((t) => t.slug === 'business')!)).toBeNull();
    expect(annualSavingPercent(TIERS.find((t) => t.slug === 'free')!)).toBeNull();
  });

  it('formate les montants avec la devise, y compris le gratuit', () => {
    expect(formatPrice(9)).toBe('9 USD');
    expect(formatPrice(null)).toBe('0 USD');
  });

  it("met l'essai en avant sur les offres payantes uniquement", () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(TRIAL_PLAN).toBe('pro');
    const free = TIERS.find((t) => t.slug === 'free')!;
    // L'offre gratuite n'a pas d'essai à proposer : elle EST la gratuité.
    expect(free.cta).not.toContain(String(TRIAL_DAYS));
    for (const paid of TIERS.filter((t) => t.slug !== 'free')) {
      expect(paid.cta).toContain(String(TRIAL_DAYS));
    }
  });

  it('une seule offre est mise en avant', () => {
    expect(TIERS.filter((t) => t.highlighted).length).toBe(1);
  });
});

describe('comparatif', () => {
  it('reflète la limite de projets réellement appliquée', () => {
    const row = COMPARISON.flatMap((s) => s.rows).find((r) => r.label === 'Projets')!;
    expect(row.free).toBe(String(API_ENTITLEMENTS.free.maxProjects));
    // `null` côté API = illimité : la page doit dire « illimité », pas « null ».
    expect(API_ENTITLEMENTS.pro.maxProjects).toBeNull();
    expect(String(row.pro).toLowerCase()).toContain('illimit');
    expect(API_ENTITLEMENTS.business.maxProjects).toBeNull();
    expect(String(row.business).toLowerCase()).toContain('illimit');
  });

  it('reflète le filigrane réellement appliqué', () => {
    const row = COMPARISON.flatMap((s) => s.rows).find((r) => r.label === 'Export PDF')!;
    expect(API_ENTITLEMENTS.free.pdfWatermark).toBe(true);
    expect(String(row.free).toLowerCase()).toContain('filigrane');
    expect(API_ENTITLEMENTS.pro.pdfWatermark).toBe(false);
    expect(String(row.pro).toLowerCase()).toContain('sans filigrane');
    expect(String(row.business).toLowerCase()).toContain('sans filigrane');
  });

  it('reflète les sièges réellement inclus', () => {
    const row = COMPARISON.flatMap((s) => s.rows).find((r) => r.label === 'Sièges inclus')!;
    expect(row.business).toBe(String(API_ENTITLEMENTS.business.seats));
  });

  it('chaque ligne renseigne les trois colonnes', () => {
    // Une cellule oubliée s'afficherait vide, ce qu'un lecteur interprète comme
    // « non inclus » — une promesse retirée par distraction.
    for (const section of COMPARISON) {
      expect(section.rows.length).toBeGreaterThan(0);
      for (const row of section.rows) {
        expect(row.label.length).toBeGreaterThan(0);
        for (const cell of [row.free, row.pro, row.business]) {
          expect(cell === undefined || cell === null).toBe(false);
        }
      }
    }
  });

  it("aucune ligne ne promet moins en Business qu'en Pro", () => {
    // Régression classique d'une table écrite à la main : une ligne recopiée de
    // travers fait passer Business pour inférieur à Pro.
    for (const row of COMPARISON.flatMap((s) => s.rows)) {
      if (typeof row.pro === 'boolean' && typeof row.business === 'boolean') {
        expect(row.pro && !row.business).toBe(false);
      }
    }
  });
});

describe('foire aux questions', () => {
  it('répond aux objections qui bloquent une souscription', () => {
    const all = FAQ.map((e) => `${e.question} ${e.answer}`.toLowerCase()).join(' | ');
    // Sans carte : c'est LA question de l'essai.
    expect(all).toContain('carte');
    // Survie des données à l'expiration — docs/13 l'exige explicitement.
    expect(all).toContain('supprim');
    // Prorata d'un changement d'offre.
    expect(all).toContain('échéance');
    // Fiscalité non arbitrée : la taire sur une page de prix serait malhonnête.
    expect(all).toContain('hors taxes');
  });

  it('chaque entrée a une question et une réponse substantielles', () => {
    for (const entry of FAQ) {
      expect(entry.question.trim().length).toBeGreaterThan(10);
      expect(entry.answer.trim().length).toBeGreaterThan(40);
    }
  });
});

describe('moyens de paiement', () => {
  it('libelle tous les moyens que l’API peut renvoyer', () => {
    // Miroir de `METHOD_PROVIDER` (`apps/api/src/payments/payment-provider.ts`).
    for (const method of ['card', 'paypal', 'mobile_money', 'bank_transfer']) {
      expect(PAYMENT_METHOD_LABELS[method]).toBeTruthy();
    }
  });
});
