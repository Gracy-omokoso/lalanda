// GROW (ADR-0032) — indicateurs, score de santé, parcours : cas chiffrés, cas
// limites et propriétés sur générateur déterministe.

import { describe, expect, it } from 'vitest';

import {
  computeHealthScore,
  computeInvestorIndicators,
  GROW_SCORING_V1,
  GROW_WEIGHTS_V1,
  interpolateScore,
  salesRevenue,
  suggestJourneyStage,
  type GrowActualPeriod,
  type GrowActualsSource,
  type GrowInputs,
  type GrowSalesDocument,
  type JourneyInputs,
} from '../index.js';

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AS_OF = '2026-10-21'; // dernier mois complet : 2026-09

let seq = 0;
function doc(p: Partial<GrowSalesDocument> & { month: string; ht?: string }): GrowSalesDocument {
  seq += 1;
  const currency = p.amounts?.[0]?.currency ?? 'USD';
  return {
    id: p.id ?? `d${seq}`,
    type: p.type ?? 'FV',
    status: p.status ?? 'issued',
    series: p.series === undefined ? 'real' : p.series,
    // Midi UTC le 15 : aucun doute sur le mois de Kinshasa.
    issuedAt: p.issuedAt === undefined ? `${p.month}-15T12:00:00.000Z` : p.issuedAt,
    customerKey: p.customerKey === undefined ? 'c1' : p.customerKey,
    customerName: p.customerName === undefined ? 'Client 1' : p.customerName,
    amounts: p.amounts ?? [{ currency, groups: [{ group: 'B', ht: p.ht ?? '100.00' }] }],
    lineCatalogItemIds: p.lineCatalogItemIds ?? [null],
  };
}

function period(
  year: number,
  month: number,
  values: Record<string, number>,
  status: 'open' | 'closed' = 'closed',
  closedAt: string | null = '2026-10-05T10:00:00.000Z',
): GrowActualPeriod {
  return { year, month, status, closedAt: status === 'closed' ? closedAt : null, values };
}

function project(periods: GrowActualPeriod[], currency = 'USD'): GrowActualsSource {
  return {
    kind: 'project',
    projectId: 'p1',
    projectName: 'Boulangerie',
    currency,
    selection: 'declared',
    periods,
  };
}

function inputs(p: Partial<GrowInputs> = {}): GrowInputs {
  return {
    asOf: AS_OF,
    actuals: p.actuals ?? { kind: 'none', reason: 'AUCUN_PROJET' },
    sales: p.sales ?? [],
    declaredCash: p.declaredCash ?? null,
    recurringCatalogItemIds: p.recurringCatalogItemIds ?? [],
  };
}

function journeyInputs(i: GrowInputs, p: Partial<Omit<JourneyInputs, 'indicators'>> = {}) {
  return {
    indicators: computeInvestorIndicators(i),
    projects: p.projects ?? 0,
    approvedPlans: p.approvedPlans ?? 0,
    activeCatalogItems: p.activeCatalogItems ?? 0,
    declaredStage: p.declaredStage ?? null,
    checklistDone: p.checklistDone ?? [],
  };
}

const MONTHS_12 = [
  '2025-10',
  '2025-11',
  '2025-12',
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
];

// ─── Aucune donnée ───────────────────────────────────────────────────────────

describe('GROW sans données — jamais un chiffre inventé', () => {
  const r = computeInvestorIndicators(inputs());

  it('chaque indicateur est indisponible, avec une raison et une phrase', () => {
    for (const ind of Object.values(r.indicateurs)) {
      expect(ind.disponible).toBe(false);
      if (!ind.disponible) {
        expect(ind.raison).toMatch(/^[A-Z_]+$/);
        expect(ind.message.length).toBeGreaterThan(10);
      }
    }
    expect(r.indicateurs.burn_rate).toMatchObject({ raison: 'AUCUN_PROJET' });
    expect(r.indicateurs.mrr).toMatchObject({ raison: 'REVENU_RECURRENT_NON_DECLARE' });
    expect(r.indicateurs.croissance_ventes).toMatchObject({ raison: 'AUCUNE_VENTE' });
  });

  it('le score est indisponible (DONNEES_INSUFFISANTES), les axes restent listés', () => {
    const h = computeHealthScore(r, 'IDEA');
    expect(h.score).toMatchObject({ disponible: false, raison: 'DONNEES_INSUFFISANTES' });
    expect(h.axes.every((a) => a.note === null)).toBe(true);
    expect(h.risques).toHaveLength(0);
    // Actions de complétion des données, sourcées.
    expect(h.actions.map((a) => a.code)).toContain('CREER_PROJET');
    expect(h.actions.every((a) => a.origine === 'donnees' && a.pourquoi.length > 0)).toBe(true);
    expect(h.axesNonCouverts.map((a) => a.axe)).toEqual(['marketing', 'operations', 'rh']);
  });

  it('le parcours suggère IDEA', () => {
    const j = suggestJourneyStage(journeyInputs(inputs()));
    expect(j.suggeree).toBe('IDEA');
    expect(j.retenue).toBe('IDEA');
  });
});

// ─── Chiffre d'affaires des ventes ───────────────────────────────────────────

describe('salesRevenue — règle d’ADR-0023 § S25e.13', () => {
  it('somme les bases HT hors groupes H, I, J, L, N ; avoirs négatifs', () => {
    const r = salesRevenue(
      [
        doc({
          month: '2026-09',
          amounts: [
            {
              currency: 'USD',
              groups: [
                { group: 'B', ht: '100.00' },
                { group: 'L', ht: '7.00' },
                { group: 'H', ht: '3.00' },
              ],
            },
          ],
        }),
        doc({ month: '2026-09', type: 'FA', ht: '40.00' }),
      ],
      null,
    );
    expect(r.currency).toBe('USD');
    expect(r.entries.map((e) => e.amount)).toEqual([10_000_000_000n, -4_000_000_000n]);
  });

  it('exclut et compte acomptes et série d’essai ; ignore brouillons et non finaux', () => {
    const r = salesRevenue(
      [
        doc({ month: '2026-09', type: 'FT' }),
        doc({ month: '2026-09', series: 'test' }),
        doc({ month: '2026-09', status: 'draft', issuedAt: null }),
        doc({ month: '2026-09', status: 'pending_normalization' }),
        doc({ month: '2026-09' }),
      ],
      null,
    );
    expect(r.entries).toHaveLength(1);
    expect(r.excluded).toEqual({ acomptes: 1, serieEssai: 1, autreDevise: 0 });
  });

  it('aucun taux : plusieurs devises sans devise de référence → indéterminée', () => {
    const r = salesRevenue(
      [
        doc({ month: '2026-09' }),
        doc({
          month: '2026-09',
          amounts: [{ currency: 'CDF', groups: [{ group: 'B', ht: '1.00' }] }],
        }),
      ],
      null,
    );
    expect(r.currency).toBeNull();
    expect(r.currencyIssue).toBe('DEVISE_DE_REFERENCE_INDETERMINEE');
    expect(r.entries).toHaveLength(0);
  });

  it('une facture normalisée en USD est lue en CDF par ses montants normalisés', () => {
    const r = salesRevenue(
      [
        doc({
          month: '2026-09',
          status: 'normalized',
          amounts: [
            { currency: 'USD', groups: [{ group: 'B', ht: '10.00' }] },
            { currency: 'CDF', groups: [{ group: 'B', ht: '28000.00' }] },
          ],
        }),
        doc({ month: '2026-09' }), // USD sans représentation CDF
      ],
      'CDF',
    );
    expect(r.entries.map((e) => e.amount)).toEqual([2_800_000_000_000n]);
    expect(r.excluded.autreDevise).toBe(1);
  });

  it('mois civil de Kinshasa (UTC+1) : 30 sept. 23:30 UTC compte en octobre', () => {
    const r = salesRevenue([doc({ month: 'x', issuedAt: '2026-09-30T23:30:00.000Z' })], null);
    expect(r.entries[0]!.month).toBe('2026-10');
  });
});

// ─── Réalisé : burn, runway, marges ──────────────────────────────────────────

describe('burn rate et runway', () => {
  const closed3 = [
    period(1, 1, { ca: 1000, resultat_net: -100 }),
    period(1, 2, { ca: 1000, resultat_net: -200 }),
    period(1, 3, { ca: 1000, resultat_net: -300 }),
  ];

  it('burn = −moyenne du résultat net des 3 derniers mois clôturés', () => {
    const r = computeInvestorIndicators(
      inputs({
        actuals: project([...closed3, period(1, 4, { ca: 1, resultat_net: -9999 }, 'open')]),
      }),
    );
    expect(r.indicateurs.burn_rate).toMatchObject({ disponible: true, valeur: 200, devise: 'USD' });
    expect(r.indicateurs.burn_rate.hypotheses.join(' ')).toMatch(/Approximation/);
  });

  it('moins de 3 mois clôturés → MOIS_CLOTURES_INSUFFISANTS (pas de moyenne sur 2 mois)', () => {
    const r = computeInvestorIndicators(inputs({ actuals: project(closed3.slice(0, 2)) }));
    expect(r.indicateurs.burn_rate).toMatchObject({
      disponible: false,
      raison: 'MOIS_CLOTURES_INSUFFISANTS',
    });
    expect(r.indicateurs.runway).toMatchObject({ raison: 'BURN_INDISPONIBLE' });
  });

  it('runway = solde déclaré ÷ burn ; solde absent, périmé, en autre devise', () => {
    const base = { actuals: project(closed3) };
    const ok = computeInvestorIndicators(
      inputs({ ...base, declaredCash: { amount: 1200, currency: 'USD', asOf: '2026-07-23' } }),
    );
    expect(ok.indicateurs.runway).toMatchObject({ disponible: true, valeur: 6, unite: 'mois' });

    expect(computeInvestorIndicators(inputs(base)).indicateurs.runway).toMatchObject({
      raison: 'TRESORERIE_NON_DECLAREE',
    });
    const stale = computeInvestorIndicators(
      inputs({ ...base, declaredCash: { amount: 1200, currency: 'USD', asOf: '2026-07-22' } }),
    );
    expect(stale.indicateurs.runway).toMatchObject({ raison: 'SOLDE_PERIME' });
    const cdf = computeInvestorIndicators(
      inputs({ ...base, declaredCash: { amount: 1200, currency: 'CDF', asOf: AS_OF } }),
    );
    expect(cdf.indicateurs.runway).toMatchObject({ raison: 'DEVISE_DIFFERENTE' });
  });

  it('résultat moyen positif : burn 0 et runway « pas de consommation » noté 100', () => {
    const profitable = [1, 2, 3].map((m) => period(1, m, { ca: 1000, resultat_net: 50 }));
    const r = computeInvestorIndicators(
      inputs({
        actuals: project(profitable),
        declaredCash: { amount: 10, currency: 'USD', asOf: AS_OF },
      }),
    );
    expect(r.indicateurs.burn_rate).toMatchObject({ disponible: true, valeur: 0 });
    expect(r.indicateurs.runway).toMatchObject({ raison: 'PAS_DE_CONSOMMATION' });
    const h = computeHealthScore(r, 'MVP');
    expect(h.axes.find((a) => a.axe === 'tresorerie')!.note).toBe(100);
  });

  it('marge brute : ligne `marge_matiere` reconnue ; prestation de services sans marge → indisponible', () => {
    const resto = [1, 2, 3].map((m) =>
      period(1, m, { ca: 1000, marge_matiere: 650, resultat_net: 10 }),
    );
    const r = computeInvestorIndicators(inputs({ actuals: project(resto) }));
    expect(r.indicateurs.marge_brute).toMatchObject({ disponible: true, valeur: 0.65 });

    const services = [1, 2, 3].map((m) => period(1, m, { ca: 1000, resultat_net: 10 }));
    const s = computeInvestorIndicators(inputs({ actuals: project(services) }));
    expect(s.indicateurs.marge_brute).toMatchObject({ raison: 'LIGNE_MARGE_ABSENTE' });
  });

  it('chiffre d’affaires nul → BASE_NULLE, jamais une marge de −100 %', () => {
    const zero = [1, 2, 3].map((m) => period(1, m, { ca: 0, resultat_net: -50 }));
    const r = computeInvestorIndicators(inputs({ actuals: project(zero) }));
    expect(r.indicateurs.marge_nette).toMatchObject({ raison: 'BASE_NULLE' });
  });

  it('croissance du CA réalisé : 3 derniers mois clôturés contre les 3 précédents', () => {
    const six = [1, 2, 3, 4, 5, 6].map((m) =>
      period(1, m, { ca: m <= 3 ? 1000 : 1200, resultat_net: 0 }),
    );
    const r = computeInvestorIndicators(inputs({ actuals: project(six) }));
    expect(r.indicateurs.croissance_ca_realise).toMatchObject({ disponible: true, valeur: 0.2 });
  });
});

// ─── Ventes : croissance, concentration, MRR, clients revenants ──────────────

describe('indicateurs de ventes', () => {
  it('croissance des ventes : 6 mois complets requis, puis (récent − précédent) ÷ précédent', () => {
    const sales = MONTHS_12.slice(6).map((m, i) =>
      doc({ month: m, ht: i < 3 ? '100.00' : '150.00' }),
    );
    const r = computeInvestorIndicators(inputs({ sales }));
    expect(r.indicateurs.croissance_ventes).toMatchObject({ disponible: true, valeur: 0.5 });

    const short = computeInvestorIndicators(inputs({ sales: sales.slice(1) }));
    expect(short.indicateurs.croissance_ventes).toMatchObject({ raison: 'HISTORIQUE_INSUFFISANT' });
  });

  it('le mois en cours (incomplet) n’est jamais compté', () => {
    const sales = [
      ...MONTHS_12.slice(6).map((m) => doc({ month: m })),
      doc({ month: '2026-10', ht: '99999.00' }),
    ];
    const r = computeInvestorIndicators(inputs({ sales }));
    expect(r.indicateurs.croissance_ventes).toMatchObject({ valeur: 0 });
  });

  it('concentration : part du 1er client, anonymes au dénominateur seulement', () => {
    const sales = [
      doc({ month: '2026-07', customerKey: 'a', customerName: 'Alpha', ht: '600.00' }),
      doc({ month: '2026-08', customerKey: 'b', customerName: 'Beta', ht: '200.00' }),
      doc({ month: '2026-09', customerKey: null, customerName: null, ht: '200.00' }),
    ];
    const r = computeInvestorIndicators(inputs({ sales }));
    const c = r.indicateurs.concentration_clients;
    expect(c).toMatchObject({ disponible: true, valeur: 0.6, partTroisPremiers: 0.8 });
    if (c.disponible) {
      expect(c.premiersClients!.map((x) => [x.cle, x.nom, x.part])).toEqual([
        ['a', 'Alpha', 0.6],
        ['b', 'Beta', 0.2],
      ]);
    }
  });

  it('MRR : non déclaré, factures mixtes, puis somme des factures récurrentes ; ARR = 12 × MRR', () => {
    const sales = [
      doc({ month: '2026-08', ht: '50.00', lineCatalogItemIds: ['abo'] }),
      doc({ month: '2026-09', ht: '50.00', lineCatalogItemIds: ['abo'] }),
      doc({ month: '2026-09', ht: '70.00', lineCatalogItemIds: ['abo'], customerKey: 'c2' }),
      doc({ month: '2026-09', ht: '999.00', lineCatalogItemIds: ['ponctuel'] }),
    ];
    expect(computeInvestorIndicators(inputs({ sales })).indicateurs.mrr).toMatchObject({
      raison: 'REVENU_RECURRENT_NON_DECLARE',
    });
    const r = computeInvestorIndicators(inputs({ sales, recurringCatalogItemIds: ['abo'] }));
    expect(r.indicateurs.mrr).toMatchObject({ disponible: true, valeur: 120, devise: 'USD' });
    expect(r.indicateurs.arr).toMatchObject({ disponible: true, valeur: 1440 });

    const mixed = computeInvestorIndicators(
      inputs({
        sales: [...sales, doc({ month: '2026-09', lineCatalogItemIds: ['abo', 'ponctuel'] })],
        recurringCatalogItemIds: ['abo'],
      }),
    );
    expect(mixed.indicateurs.mrr).toMatchObject({ raison: 'FACTURES_MIXTES' });
    expect(mixed.indicateurs.arr).toMatchObject({ disponible: false, raison: 'FACTURES_MIXTES' });
  });

  it('clients revenants : part des 6 derniers mois faite avec les clients des 6 précédents', () => {
    const sales = [
      doc({ month: '2025-10', customerKey: 'a' }),
      doc({ month: '2026-01', customerKey: 'b' }),
      doc({ month: '2026-05', customerKey: 'a', ht: '300.00' }),
      doc({ month: '2026-09', customerKey: 'z', ht: '100.00' }),
    ];
    const r = computeInvestorIndicators(inputs({ sales }));
    expect(r.indicateurs.clients_revenants).toMatchObject({ disponible: true, valeur: 0.75 });
    expect(r.faits.clientsDistincts12Mois).toBe(3);
  });
});

// ─── Score de santé ──────────────────────────────────────────────────────────

function healthyInputs(): GrowInputs {
  const periods = [1, 2, 3, 4, 5, 6].map((m) =>
    period(1, m, { ca: 1000, marge_brute: 400, resultat_net: -100 }),
  );
  const sales: GrowSalesDocument[] = [];
  for (const [i, m] of MONTHS_12.entries()) {
    for (const c of ['a', 'b', 'c', 'd']) {
      sales.push(
        doc({ month: m, customerKey: c, customerName: c, ht: i < 9 ? '100.00' : '110.00' }),
      );
    }
  }
  return inputs({
    actuals: project(periods),
    sales,
    declaredCash: { amount: 1200, currency: 'USD', asOf: AS_OF },
  });
}

describe('computeHealthScore', () => {
  it('cas chiffré complet : notes par axe et score pondéré', () => {
    const r = computeInvestorIndicators(healthyInputs());
    const h = computeHealthScore(r, 'FIRST_CUSTOMER');
    const notes = Object.fromEntries(h.axes.map((a) => [a.axe, a.note]));
    // marge nette −10 % → 25 ; runway 12 mois → 75 ; croissance 330/300−1 = 10 % → 66,67 ;
    // clients revenants 100 % → 100 et premier client 25 % → 90 → 95.
    expect(notes).toEqual({ finance: 25, tresorerie: 75, ventes: 67, fidelisation: 95 });
    // Traction : 20/35/25/20 → (20×25 + 35×75 + 25×67 + 20×95) / 100 = 67
    expect(h.groupe).toBe('traction');
    expect(h.score).toEqual({ disponible: true, valeur: 67, couverture: 1 });
    expect(h.risques.map((x) => x.code)).toEqual(['PERTES']);
    expect(h.actions[0]).toMatchObject({ code: 'ANALYSER_PERTES', origine: 'risque' });
    expect(h.actions[0]!.pourquoi).toMatch(/marge_nette = -10 %.*GROW_RISK_RULES_V1/);
  });

  it('les pondérations suivent le stade', () => {
    const r = computeInvestorIndicators(healthyInputs());
    const early = computeHealthScore(r, 'IDEA');
    const late = computeHealthScore(r, 'SCALE');
    expect(early.axes.find((a) => a.axe === 'tresorerie')!.poids).toBe(45);
    expect(late.axes.find((a) => a.axe === 'finance')!.poids).toBe(30);
    expect(early.score.disponible && late.score.disponible).toBe(true);
  });

  it('couverture sous 60 % du poids → score indisponible, axes manquants listés', () => {
    // Ventes seulement : ventes + fidélisation = 45 % du poids en traction.
    const { sales } = healthyInputs();
    const r = computeInvestorIndicators(inputs({ sales }));
    const h = computeHealthScore(r, 'PMF');
    expect(h.score).toMatchObject({ disponible: false, raison: 'DONNEES_INSUFFISANTES' });
    if (!h.score.disponible) expect(h.score.manquants).toEqual(['Finance', 'Trésorerie']);
  });

  it('trois risques au plus, triés par gravité ; chaque risque porte sa preuve', () => {
    const periods = [1, 2, 3, 4, 5, 6].map((m) =>
      period(
        1,
        m,
        { ca: m <= 3 ? 1000 : 500, resultat_net: -400 },
        'closed',
        '2026-06-01T00:00:00Z',
      ),
    );
    const sales = MONTHS_12.slice(6).map((m, i) =>
      doc({ month: m, customerKey: 'seul', ht: i < 3 ? '1000.00' : '100.00' }),
    );
    const r = computeInvestorIndicators(
      inputs({
        actuals: project(periods),
        sales,
        declaredCash: { amount: 500, currency: 'USD', asOf: AS_OF },
      }),
    );
    const h = computeHealthScore(r, 'GROWTH');
    expect(h.risques).toHaveLength(3);
    expect(h.risques.map((x) => x.gravite)).toEqual(['critique', 'critique', 'haute']);
    expect(h.risques.map((x) => x.code)).toEqual(['RUNWAY_CRITIQUE', 'PERTES', 'VENTES_EN_BAISSE']);
    for (const risk of h.risques) expect(risk.preuve.regle).toBe('GROW_RISK_RULES_V1');
    expect(h.actions).toHaveLength(3);
  });
});

// ─── Parcours ────────────────────────────────────────────────────────────────

describe('suggestJourneyStage', () => {
  it('plan validé → VALIDATION ; catalogue → MVP ; première vente → FIRST_CUSTOMER', () => {
    expect(suggestJourneyStage(journeyInputs(inputs(), { approvedPlans: 1 })).suggeree).toBe(
      'VALIDATION',
    );
    expect(
      suggestJourneyStage(journeyInputs(inputs(), { approvedPlans: 1, activeCatalogItems: 2 }))
        .suggeree,
    ).toBe('MVP');
    const j = suggestJourneyStage(journeyInputs(inputs({ sales: [doc({ month: '2026-09' })] })));
    expect(j.suggeree).toBe('FIRST_CUSTOMER');
  });

  it('PMF puis GROWTH selon clients, clients revenants et croissance', () => {
    const sales: GrowSalesDocument[] = [];
    for (const [i, m] of MONTHS_12.entries()) {
      for (let c = 0; c < 10; c += 1) {
        sales.push(doc({ month: m, customerKey: `k${c}`, ht: i < 9 ? '100.00' : '100.00' }));
      }
    }
    expect(suggestJourneyStage(journeyInputs(inputs({ sales }))).suggeree).toBe('PMF');
    const growing = sales.map((d) =>
      d.issuedAt!.startsWith('2026-07') ||
      d.issuedAt!.startsWith('2026-08') ||
      d.issuedAt!.startsWith('2026-09')
        ? { ...d, amounts: [{ currency: 'USD', groups: [{ group: 'B', ht: '130.00' }] }] }
        : d,
    );
    const j = suggestJourneyStage(journeyInputs(inputs({ sales: growing })));
    expect(j.suggeree).toBe('GROWTH');
    // SCALE : marge nette inconnue (aucun réalisé) → condition « inconnue », pas remplie.
    const scale = j.etapes.find((e) => e.etape === 'SCALE')!;
    expect(scale.conditions.find((c) => c.code === 'MARGE_NETTE_POSITIVE')!.etat).toBe('inconnue');
  });

  it('FUNDRAISING n’est jamais suggérée ; la déclaration l’emporte et l’écart est montré', () => {
    const j = suggestJourneyStage(journeyInputs(inputs(), { declaredStage: 'FUNDRAISING' }));
    expect(j.suggeree).toBe('IDEA');
    expect(j.retenue).toBe('FUNDRAISING');
    expect(j.ecart).toBe(true);
    expect(j.etapes.find((e) => e.etape === 'FUNDRAISING')!.suggerable).toBe(false);
  });

  it('checklist : points automatiques depuis les données, points manuels cochés', () => {
    const j = suggestJourneyStage(
      journeyInputs(inputs(), { projects: 1, checklistDone: ['idea.canvas'] }),
    );
    const idea = j.etapes[0]!.checklist;
    expect(idea).toEqual([
      { id: 'idea.projet', libelle: 'Créer un premier projet', mode: 'auto', fait: true },
      {
        id: 'idea.canvas',
        libelle: 'Décrire votre modèle économique (Canvas)',
        mode: 'manuel',
        fait: true,
      },
      {
        id: 'idea.probleme',
        libelle: 'Formuler le problème client que vous résolvez',
        mode: 'manuel',
        fait: false,
      },
    ]);
  });
});

// ─── Propriétés ──────────────────────────────────────────────────────────────

describe('propriétés', { timeout: 120_000 }, () => {
  it('chaque barème est borné à [0, 100] et monotone', () => {
    const rand = generator(7);
    for (const [name, anchors] of Object.entries(GROW_SCORING_V1)) {
      if (name === 'version') continue;
      const a = anchors as readonly (readonly [number, number])[];
      const increasing = a[a.length - 1]![1] >= a[0]![1];
      const lo = a[0]![0] - 1;
      const hi = a[a.length - 1]![0] + 1;
      const xs = Array.from({ length: 300 }, () => lo + rand() * (hi - lo)).sort((x, y) => x - y);
      let prev = interpolateScore(a, xs[0]!);
      for (const x of xs) {
        const s = interpolateScore(a, x);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
        if (increasing) expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
        else expect(s).toBeLessThanOrEqual(prev + 1e-9);
        prev = s;
      }
    }
  });

  it('les pondérations de chaque groupe somment à 100', () => {
    for (const w of Object.values(GROW_WEIGHTS_V1.groupes)) {
      expect(Object.values(w).reduce((s, v) => s + v, 0)).toBe(100);
    }
  });

  function randomInputs(seed: number): GrowInputs {
    const rand = generator(seed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    const sales: GrowSalesDocument[] = [];
    const nDocs = Math.floor(rand() * 60);
    for (let i = 0; i < nDocs; i += 1) {
      sales.push(
        doc({
          month: pick(MONTHS_12),
          type: pick(['FV', 'FV', 'FV', 'FA', 'FT'] as const),
          customerKey: pick(['a', 'b', 'c', 'd', null]),
          ht: `${Math.floor(rand() * 100000)}.${String(Math.floor(rand() * 100)).padStart(2, '0')}`,
          lineCatalogItemIds: [pick(['abo', 'x', null])],
        }),
      );
    }
    const nPeriods = Math.floor(rand() * 9);
    const periods = Array.from({ length: nPeriods }, (_, i) =>
      period(
        1,
        i + 1,
        {
          ca: Math.round(rand() * 5000),
          resultat_net: Math.round((rand() - 0.6) * 2000),
          marge_brute: Math.round(rand() * 2000),
        },
        rand() < 0.8 ? 'closed' : 'open',
      ),
    );
    return inputs({
      actuals:
        rand() < 0.2 ? { kind: 'none', reason: 'PROJET_DE_REFERENCE_A_CHOISIR' } : project(periods),
      sales,
      declaredCash:
        rand() < 0.7
          ? { amount: Math.round(rand() * 20000), currency: 'USD', asOf: '2026-10-01' }
          : null,
      recurringCatalogItemIds: rand() < 0.5 ? ['abo'] : [],
    });
  }

  it('score : entier dans [0, 100] si publié ; publié ⇔ ≥ 2 axes et ≥ 60 % du poids', () => {
    for (let seed = 1; seed <= 250; seed += 1) {
      const r = computeInvestorIndicators(randomInputs(seed));
      const stage = suggestJourneyStage({
        indicators: r,
        projects: 1,
        approvedPlans: 1,
        activeCatalogItems: 1,
        declaredStage: null,
        checklistDone: [],
      }).retenue;
      const h = computeHealthScore(r, stage);
      const avail = h.axes.filter((a) => a.disponible);
      const weight = avail.reduce((s, a) => s + a.poids, 0);
      const published = avail.length >= 2 && weight >= 60;
      expect(h.score.disponible).toBe(published);
      if (h.score.disponible) {
        expect(Number.isInteger(h.score.valeur)).toBe(true);
        expect(h.score.valeur).toBeGreaterThanOrEqual(0);
        expect(h.score.valeur).toBeLessThanOrEqual(100);
      }
      expect(h.risques.length).toBeLessThanOrEqual(3);
      expect(h.actions.length).toBeLessThanOrEqual(3);
      for (const a of h.actions) expect(a.pourquoi.length).toBeGreaterThan(0);
      // Aucun indicateur disponible n'a de valeur non finie.
      for (const ind of Object.values(r.indicateurs)) {
        if (ind.disponible) expect(Number.isFinite(ind.valeur)).toBe(true);
      }
    }
  });

  it('invariance par permutation des documents de vente', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const i = randomInputs(seed);
      const rand = generator(seed * 31);
      const shuffled = [...i.sales].sort(() => rand() - 0.5);
      expect(computeInvestorIndicators({ ...i, sales: shuffled })).toEqual(
        computeInvestorIndicators(i),
      );
    }
  });

  it('un avoir total du même mois annule sa facture', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const i = randomInputs(seed);
      const rand = generator(seed * 17);
      const month = MONTHS_12[Math.floor(rand() * 12)]!;
      const ht = `${Math.floor(rand() * 5000)}.00`;
      const pair = [
        doc({ month, customerKey: 'zz', ht, id: 'pair-fv' }),
        doc({ month, customerKey: 'zz', ht, type: 'FA', id: 'pair-fa' }),
      ];
      const a = computeInvestorIndicators(i);
      const b = computeInvestorIndicators({ ...i, sales: [...i.sales, ...pair] });
      for (const code of ['croissance_ventes', 'mrr'] as const) {
        const x = a.indicateurs[code];
        const y = b.indicateurs[code];
        if (x.disponible && y.disponible) expect(y.valeur).toBe(x.valeur);
      }
    }
  });
});
