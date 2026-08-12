// Contenu de la page tarifs.
//
// Ces tests ne vérifient pas « la page s'affiche » — ils vérifient que la
// PROMESSE COMMERCIALE tient. Une page qui annonce des projets illimités en Pro
// alors que l'API en autorise cinq est un litige, pas un bug d'affichage.
//
// ── Ce qui a changé, et pourquoi c'est le cœur du sujet ──────────────────────
//
// La version précédente recopiait les valeurs de l'API dans ce fichier
// (`API_PRICES`, `API_ENTITLEMENTS`) « puisque le web ne peut pas importer
// apps/api ». Le raisonnement était juste, la conclusion fausse : le test
// devenait une TROISIÈME copie, qui certifiait la cohérence de deux autres
// copies tant que quelqu'un pensait à la mettre à jour — et personne ne l'a
// fait quand l'annuel Business a divergé.
//
// Les deux côtés importent désormais `@lalanda/shared/pricing`. Ces tests
// vérifient donc autre chose : que la page DÉRIVE bien du catalogue et n'a pas
// réintroduit une valeur en dur, et que les invariants de présentation tiennent
// (« illimité » n'est pas « null », Expert n'a pas de tunnel de paiement).

import { PLAN_CATALOG, PLANS, SELF_SERVE_PLANS } from '@lalanda/shared/pricing';
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

describe('grille tarifaire affichée', () => {
  it('affiche exactement les cinq offres du catalogue, dans l’ordre', () => {
    expect(TIERS.map((t) => t.slug)).toEqual([...PLANS]);
  });

  it('annonce exactement les montants que l’API facture', () => {
    for (const tier of TIERS) {
      const price = PLAN_CATALOG[tier.slug].price;
      // Le test ne connaît aucun montant : il compare l'affiché au catalogue.
      // Un prix tapé en dur dans la page ferait échouer cette boucle.
      expect(tier.priceMonthUsd === null ? null : tier.priceMonthUsd * 100).toBe(price.monthCents);
      expect(tier.priceYearUsd === null ? null : tier.priceYearUsd * 100).toBe(price.yearCents);
    }
  });

  it('ne publie aucun montant pour l’offre Expert', () => {
    const expert = TIERS.find((t) => t.slug === 'expert')!;
    expect(expert.priceMonthUsd).toBeNull();
    expect(expert.priceYearUsd).toBeNull();
    // « 0 USD » présenterait un pack sur devis comme gratuit.
    expect(formatPrice(expert.priceMonthUsd)).toBe('Sur devis');
  });

  it('n’ouvre aucun tunnel de paiement sur l’offre Expert', () => {
    const expert = TIERS.find((t) => t.slug === 'expert')!;
    expect(expert.selfServe).toBe(false);
    expect(expert.cta).toBe('Nous contacter');
    // Le bouton ne mène pas à l'inscription : celle-ci ouvrirait un compte
    // gratuit sans un mot du devis, ce qui n'est pas ce que le bouton promet.
    expect(expert.ctaHref).toBeNull();
    expect(expert.cta).not.toContain(String(TRIAL_DAYS));
  });

  it('n’expose Expert dans AUCUN tunnel de souscription', () => {
    // `SELF_SERVE_PLANS` est la liste que consomme `subscription-funnel.tsx`
    // (`OFFRES_PAYANTES`). L'assertion porte donc sur la valeur réelle qui
    // alimente le tunnel, pas sur une liste réécrite pour le test.
    expect(SELF_SERVE_PLANS).toEqual(['pro', 'cabinet', 'business']);
    expect(SELF_SERVE_PLANS).not.toContain('expert');
    // `free` non plus : il n'y a rien à acheter.
    expect(SELF_SERVE_PLANS).not.toContain('free');
  });

  it('ne pointe aucune offre vers une destination qui n’existe pas', () => {
    // `/contact` n'existe pas et aucune adresse de contact n'est publiée
    // (`PUBLISHER_UNKNOWNS`). Un bouton vers un 404 sur la seule voie d'accès à
    // une offre payante est pire que pas de bouton du tout.
    const routesConnues = ['/register'];
    for (const tier of TIERS) {
      if (tier.ctaHref === null) continue;
      expect(routesConnues, `${tier.slug} → ${tier.ctaHref}`).toContain(tier.ctaHref);
    }
  });

  it('ne répète pas la tagline dans les arguments de la carte', () => {
    // Une puce qui redit le sous-titre affiché juste au-dessus fait perdre une
    // ligne d'argument sur une carte qui n'en a que six.
    for (const tier of TIERS) {
      expect(tier.features, tier.slug).not.toContain(tier.tagline);
    }
  });

  it('ne propose la bascule annuelle que là où un tarif annuel est vendable', () => {
    expect(hasAnnualOffer('pro')).toBe(true);
    // L'annuel Business existe désormais (790 USD) — son absence était la
    // divergence signalée dans docs/13.
    expect(hasAnnualOffer('business')).toBe(true);
    expect(hasAnnualOffer('cabinet')).toBe(true);
    // Expert : aucun tarif, donc aucune bascule. Sans ce refus, un client
    // choisirait « Expert annuel » et se heurterait à un `PLAN_NOT_SELLABLE`
    // au bout du tunnel.
    expect(hasAnnualOffer('expert')).toBe(false);
    // Free non plus : il n'y a rien à facturer annuellement.
    expect(hasAnnualOffer('free')).toBe(false);
  });

  it("l'économie annoncée pour l'annuel n'est jamais surestimée", () => {
    for (const tier of TIERS) {
      const saving = annualSavingPercent(tier);
      if (saving === null) continue;
      const { monthCents, yearCents } = PLAN_CATALOG[tier.slug].price;
      const exact = ((monthCents! * 12 - yearCents!) / (monthCents! * 12)) * 100;
      // Arrondi vers le BAS : annoncer 17 % pour 16,6 % est une surpromesse,
      // fût-elle minuscule.
      expect(saving).toBeLessThanOrEqual(exact);
      expect(saving).toBe(Math.floor(exact));
    }
  });

  it('les trois offres en libre-service offrent deux mois (≈ 16 %)', () => {
    // 10 mois payés pour 12 : c'est le standard du secteur, et docs/13 § 4
    // reprochait justement à l'ancienne grille de sous-exploiter l'annuel.
    for (const slug of ['pro', 'cabinet', 'business'] as const) {
      expect(annualSavingPercent(TIERS.find((t) => t.slug === slug)!)).toBe(16);
    }
  });

  it('formate les montants avec la devise, y compris le gratuit', () => {
    expect(formatPrice(19)).toBe('19 USD');
    // Le gratuit est un prix (0), pas une absence de prix (null).
    expect(formatPrice(0)).toBe('0 USD');
    expect(formatPrice(null)).toBe('Sur devis');
  });

  it("met l'essai en avant sur les seules offres qui se souscrivent en ligne", () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(TRIAL_PLAN).toBe('pro');
    for (const tier of TIERS) {
      if (tier.selfServe) {
        expect(tier.cta).toContain(String(TRIAL_DAYS));
      } else {
        // Free EST la gratuité ; Expert passe par un devis. Ni l'un ni l'autre
        // n'a d'essai à proposer.
        expect(tier.cta).not.toContain(String(TRIAL_DAYS));
      }
    }
  });

  it('une seule offre est mise en avant', () => {
    expect(TIERS.filter((t) => t.highlighted).length).toBe(1);
  });

  it('les arguments de chaque carte reprennent ses vraies limites', () => {
    for (const tier of TIERS) {
      const e = PLAN_CATALOG[tier.slug].entitlements;
      const texte = tier.features.join(' | ').toLowerCase();

      if (e.maxProjects === null) {
        expect(texte).toContain('projets illimités');
      } else {
        expect(texte).toContain(String(e.maxProjects));
      }
      // Le filigrane est une limite appliquée par l'API : la carte doit le dire
      // là où il s'applique, et ne pas le suggérer là où il ne s'applique pas.
      expect(texte.includes('avec filigrane')).toBe(e.pdfWatermark);
      expect(tier.features.length).toBeGreaterThan(3);
    }
  });
});

describe('comparatif', () => {
  const rows = COMPARISON.flatMap((s) => s.rows);
  const rowNamed = (label: string) => rows.find((r) => r.label === label)!;

  it('reflète la limite de projets réellement appliquée', () => {
    const row = rowNamed('Projets');
    for (const plan of PLANS) {
      const limite = PLAN_CATALOG[plan].entitlements.maxProjects;
      if (limite === null) {
        // `null` côté API = illimité : la page doit dire « illimité », pas « null ».
        expect(String(row.values[plan]).toLowerCase()).toContain('illimit');
      } else {
        expect(row.values[plan]).toBe(String(limite));
      }
    }
  });

  it('reflète le filigrane et le quota d’export réellement appliqués', () => {
    const row = rowNamed('Exports PDF');
    for (const plan of PLANS) {
      const e = PLAN_CATALOG[plan].entitlements;
      const cell = String(row.values[plan]).toLowerCase();
      expect(cell).toContain(e.pdfWatermark ? 'avec filigrane' : 'sans filigrane');
      if (e.pdfExportsPerMonth === null) {
        expect(cell).toContain('illimit');
      } else {
        expect(cell).toContain(String(e.pdfExportsPerMonth));
      }
    }
  });

  it('reflète le quota IA réellement appliqué', () => {
    const row = rowNamed('Messages par mois');
    for (const plan of PLANS) {
      const quota = PLAN_CATALOG[plan].entitlements.aiMessagesPerMonth;
      const cell = String(row.values[plan]).toLowerCase();
      if (quota === null) {
        expect(cell).toContain('illimit');
      } else {
        // Le séparateur de milliers français est un espace insécable : on
        // compare sur les chiffres seuls plutôt que sur la mise en forme.
        expect(cell.replace(/\D/g, '')).toBe(String(quota));
      }
    }
  });

  it('dit quand le quota IA se réinitialise', () => {
    // Un quota dont on ignore la date de remise à zéro n'est pas vendable :
    // l'utilisateur ne sait pas s'il doit attendre une heure ou trois semaines.
    const row = rowNamed('Messages par mois');
    expect(row.note?.toLowerCase()).toContain('1er');
  });

  it('annonce qu’une réponse sans appel au modèle n’est pas décomptée', () => {
    const row = rowNamed('Messages par mois');
    expect(row.note?.toLowerCase()).toContain('pas décomptée');
  });

  it('reflète les sièges réellement inclus', () => {
    const row = rowNamed('Sièges inclus');
    for (const plan of PLANS) {
      const seats = PLAN_CATALOG[plan].entitlements.seats;
      if (seats === null) {
        // Expert : négociés au contrat. Surtout pas « 0 ».
        expect(row.values[plan]).toBe('Négociés');
      } else {
        expect(row.values[plan]).toBe(String(seats));
      }
    }
  });

  it('reflète le suivi du réalisé réellement ouvert', () => {
    const row = rowNamed('Suivi du réalisé');
    for (const plan of PLANS) {
      expect(row.values[plan]).toBe(PLAN_CATALOG[plan].entitlements.actualsEnabled);
    }
  });

  it('chaque ligne renseigne les cinq colonnes', () => {
    // Une cellule oubliée s'afficherait vide, ce qu'un lecteur interprète comme
    // « non inclus » — une promesse retirée par distraction.
    for (const section of COMPARISON) {
      expect(section.rows.length).toBeGreaterThan(0);
      for (const r of section.rows) {
        expect(r.label.length).toBeGreaterThan(0);
        for (const plan of PLANS) {
          expect(r.values[plan] === undefined || r.values[plan] === null).toBe(false);
        }
      }
    }
  });

  it('aucune ligne ne promet moins sur une offre supérieure', () => {
    // Régression classique d'une table écrite à la main : une ligne recopiée de
    // travers fait passer Business pour inférieur à Pro. Le balayage couvre
    // toutes les paires ordonnées, pas seulement Pro/Business.
    for (const r of rows) {
      for (let i = 0; i < PLANS.length - 1; i += 1) {
        const bas = r.values[PLANS[i]!];
        const haut = r.values[PLANS[i + 1]!];
        if (typeof bas === 'boolean' && typeof haut === 'boolean') {
          expect(bas && !haut).toBe(false);
        }
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
    // Pourquoi Expert n'a pas de prix : sans cette réponse, l'absence de montant
    // se lit comme un oubli.
    expect(all).toContain('devis');
    // Comment se compte le quota IA, y compris ce qui NE compte pas.
    expect(all).toContain('décompté');
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
