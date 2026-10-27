// Idea Lab (ADR-0036) — score de validation, expériences, comparaison, faits du
// parcours : cas chiffrés, seuils exacts, cas limites et propriétés sur
// générateur déterministe.

import { describe, expect, it } from 'vitest';

import {
  compareIdeas,
  computeValidationScore,
  experimentChecklist,
  IDEA_CRITERION_IDS,
  IDEA_VALIDATION_GRID_V1,
  ideaLabJourneyFacts,
  summarizeExperiment,
  type IdeaCriterionId,
  type IdeaExperimentInput,
  type IdeaRatingInput,
  type IdeaValidationResult,
} from '../index.js';

const V1 = IDEA_VALIDATION_GRID_V1.version;
const SOURCE = { source: 'Institut national de la statistique, 2024' };

function rate(
  criterionId: IdeaCriterionId,
  note: number,
  preuve = 'preuve saisie',
): IdeaRatingInput {
  return { criterionId, note, preuve };
}

function score(ratings: IdeaRatingInput[], marketSize: { source: string } | null = SOURCE) {
  return computeValidationScore({ gridVersion: V1, ratings, marketSize });
}

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

describe('grille IDEA_VALIDATION_GRID_V1', () => {
  it('sept critères, poids entiers de somme 100, identifiants stables', () => {
    expect(IDEA_VALIDATION_GRID_V1.criteres.map((c) => c.id)).toEqual([...IDEA_CRITERION_IDS]);
    expect(IDEA_VALIDATION_GRID_V1.criteres.reduce((s, c) => s + c.poids, 0)).toBe(100);
    for (const c of IDEA_VALIDATION_GRID_V1.criteres) {
      expect(Number.isInteger(c.poids)).toBe(true);
      expect(c.preuveAttendue.length).toBeGreaterThan(10);
    }
  });

  it('une version de grille inconnue est une erreur, jamais un défaut', () => {
    expect(() =>
      computeValidationScore({ gridVersion: 'X', ratings: [], marketSize: null }),
    ).toThrow(/inconnue/);
  });
});

describe('computeValidationScore', () => {
  it('sans note : indisponible, critères manquants par poids décroissant, jamais 0', () => {
    const r = score([]);
    expect(r.score).toMatchObject({ disponible: false, raison: 'CRITERES_INSUFFISANTS' });
    if (r.score.disponible) throw new Error('inattendu');
    expect(r.score.manquants.slice(0, 2)).toEqual(['probleme', 'disposition_payer']);
    expect(r.score.manquants.at(-1)).toBe('modele_revenus');
    expect(r.couverture).toMatchObject({
      criteresRenseignes: 0,
      poidsRenseigne: 0,
      poidsTotal: 100,
    });
  });

  it('cas chiffré : 100 × (25×4 + 25×2 + 15×3 + 10×1) ÷ (4 × 75) = 68,3 → 68, à consolider', () => {
    const r = score([
      rate('probleme', 4),
      rate('disposition_payer', 2),
      rate('alternatives', 3),
      rate('cible', 1),
    ]);
    expect(r.score).toEqual({
      disponible: true,
      valeur: 68,
      niveau: 'a_consolider',
      libelleNiveau: 'Preuves à consolider',
    });
    expect(r.couverture.poidsRenseigne).toBe(75);
    expect(r.grilleVersion).toBe('IDEA_VALIDATION_GRID_V1');
  });

  it('seuil exact : 4 critères à 60 % → disponible ; 3 critères à 65 % → indisponible', () => {
    const quatre = score([
      rate('probleme', 2),
      rate('alternatives', 2),
      rate('cible', 2),
      rate('faisabilite', 2),
    ]);
    expect(quatre.couverture.poidsRenseigne).toBe(60);
    expect(quatre.score).toMatchObject({ disponible: true, valeur: 50 });
    const trois = score([
      rate('probleme', 4),
      rate('disposition_payer', 4),
      rate('alternatives', 4),
    ]);
    expect(trois.score.disponible).toBe(false);
  });

  it('4 critères couvrant 50 % du poids : indisponible', () => {
    const r = score([
      rate('disposition_payer', 4),
      rate('cible', 4),
      rate('faisabilite', 4),
      rate('modele_revenus', 4),
    ]);
    expect(r.couverture.poidsRenseigne).toBe(50);
    expect(r.score.disponible).toBe(false);
  });

  it('une note sans preuve ne compte pas (preuve_manquante)', () => {
    const r = score([rate('probleme', 4, '  '), rate('alternatives', 3)]);
    const p = r.criteres.find((c) => c.id === 'probleme')!;
    expect(p).toMatchObject({ etat: 'preuve_manquante', note: null });
    expect(r.couverture.criteresRenseignes).toBe(1);
  });

  it('« marché » sans taille de marché sourcée : source_manquante, non compté', () => {
    const sans = score([rate('marche', 4)], null);
    expect(sans.criteres.find((c) => c.id === 'marche')!.etat).toBe('source_manquante');
    expect(sans.couverture.poidsRenseigne).toBe(0);
    const vide = score([rate('marche', 4)], { source: ' ' });
    expect(vide.criteres.find((c) => c.id === 'marche')!.etat).toBe('source_manquante');
    const avec = score([rate('marche', 4)]);
    expect(avec.criteres.find((c) => c.id === 'marche')!).toMatchObject({
      etat: 'renseigne',
      note: 4,
    });
  });

  it('note hors échelle ou non entière : non renseignée', () => {
    const r = score([rate('probleme', 5), rate('alternatives', 2.5), rate('cible', -1)]);
    expect(r.couverture.criteresRenseignes).toBe(0);
  });

  it('un critère noté 0 produit un signal CRITERE_CONTREDIT ; niveaux fragile et prometteuse', () => {
    const fragile = score([
      rate('probleme', 0),
      rate('disposition_payer', 1),
      rate('alternatives', 1),
      rate('cible', 2),
    ]);
    expect(fragile.signaux).toEqual([
      expect.objectContaining({ code: 'CRITERE_CONTREDIT', critere: 'probleme' }),
    ]);
    expect(fragile.score).toMatchObject({ disponible: true, niveau: 'fragile' });
    const fort = score(IDEA_CRITERION_IDS.map((id) => rate(id, 4)));
    expect(fort.score).toMatchObject({ disponible: true, valeur: 100, niveau: 'prometteuse' });
  });

  it('doublon : la dernière note saisie l’emporte ; expériences dédoublonnées', () => {
    const r = score([
      rate('probleme', 1),
      {
        criterionId: 'probleme',
        note: 3,
        preuve: 'dix entretiens',
        experimentIds: ['a', 'a', 'b'],
      },
    ]);
    expect(r.criteres[0]).toMatchObject({ note: 3, experiences: ['a', 'b'] });
  });
});

describe('expériences', () => {
  const exp = (p: Partial<IdeaExperimentInput>): IdeaExperimentInput => ({
    id: 'e1',
    type: 'entretiens',
    status: 'terminee',
    targetPct: null,
    conclusion: 'confirmee',
    results: {},
    ...p,
  });

  it('taux exact et arrondi à 4 décimales', () => {
    const s = summarizeExperiment(exp({ results: { realises: 12, confirmant: 7 } }));
    expect(s.taux).toEqual({
      numerateur: 7,
      denominateur: 12,
      valeur: 0.5833,
      libelle: 'Entretiens confirmant le problème',
    });
    expect(s.termineeAvecResultat).toBe(true);
  });

  it('dénominateur nul, résultats incohérents, non saisis, type « autre »', () => {
    expect(
      summarizeExperiment(exp({ type: 'page_attente', results: { visiteurs: 0, inscrits: 0 } }))
        .tauxIndisponible?.raison,
    ).toBe('DENOMINATEUR_NUL');
    expect(
      summarizeExperiment(
        exp({ type: 'pre_commande', results: { sollicites: 3, precommandes: 4 } }),
      ).tauxIndisponible?.raison,
    ).toBe('RESULTATS_INCOHERENTS');
    const vide = summarizeExperiment(exp({ results: {} }));
    expect(vide.tauxIndisponible?.raison).toBe('RESULTATS_NON_SAISIS');
    expect(vide.termineeAvecResultat).toBe(false);
    const autre = summarizeExperiment(exp({ type: 'autre' }));
    expect(autre.tauxIndisponible?.raison).toBe('NON_APPLICABLE');
    expect(autre.termineeAvecResultat).toBe(true);
  });

  it('seuil atteint au point exact (30 sur 100 pour 30 %), écart avec la conclusion montré', () => {
    const pile = summarizeExperiment(
      exp({
        type: 'page_attente',
        targetPct: 30,
        conclusion: 'infirmee',
        results: { visiteurs: 100, inscrits: 30 },
      }),
    );
    expect(pile.atteint).toBe(true);
    expect(pile.ecartConclusion).toBe(true);
    const sous = summarizeExperiment(
      exp({
        type: 'page_attente',
        targetPct: 30,
        conclusion: 'infirmee',
        results: { visiteurs: 100, inscrits: 29 },
      }),
    );
    expect(sous.atteint).toBe(false);
    expect(sous.ecartConclusion).toBe(false);
    expect(
      summarizeExperiment(exp({ results: { realises: 2, confirmant: 1 } })).atteint,
    ).toBeNull();
  });

  it('une expérience en cours n’est pas « terminée avec résultat »', () => {
    const s = summarizeExperiment(
      exp({ status: 'en_cours', conclusion: null, results: { realises: 4, confirmant: 4 } }),
    );
    expect(s.termineeAvecResultat).toBe(false);
  });

  it('checklist : à prévoir, prévue, terminée', () => {
    const summaries = [
      summarizeExperiment(exp({ results: { realises: 10, confirmant: 8 } })),
      summarizeExperiment(
        exp({ id: 'e2', type: 'page_attente', status: 'a_faire', conclusion: null }),
      ),
    ];
    expect(experimentChecklist(summaries).points.map((p) => [p.type, p.etat])).toEqual([
      ['entretiens', 'terminee'],
      ['page_attente', 'prevue'],
      ['pre_commande', 'a_prevoir'],
    ]);
  });
});

describe('compareIdeas et faits du parcours', () => {
  const noted = score(IDEA_CRITERION_IDS.map((id) => rate(id, 2)));
  const strong = score(IDEA_CRITERION_IDS.map((id) => rate(id, 3)));
  const none = score([]);

  it('une idée non notée n’est jamais devant une idée notée, et n’a pas de rang', () => {
    const rows = compareIdeas([
      { id: 'a', titre: 'Aaa', validation: none },
      { id: 'b', titre: 'Bbb', validation: noted },
      { id: 'c', titre: 'Ccc', validation: strong },
    ]);
    expect(rows.map((r) => [r.id, r.rang, r.score])).toEqual([
      ['c', 1, 75],
      ['b', 2, 50],
      ['a', null, null],
    ]);
    expect(rows[0]!.notes.probleme).toBe(3);
    expect(rows[2]!.notes.probleme).toBeNull();
  });

  it('faits du parcours : idées archivées exclues, meilleur score, expériences terminées', () => {
    const done = summarizeExperiment({
      id: 'x',
      type: 'autre',
      status: 'terminee',
      targetPct: null,
      conclusion: 'confirmee',
      results: {},
    });
    const base = { problem: 'p', target: 't', solution: 's', experiments: [done] };
    const f = ideaLabJourneyFacts([
      { ...base, archived: false, validation: noted },
      { ...base, archived: false, solution: ' ', validation: none },
      { ...base, archived: true, validation: strong },
    ]);
    expect(f).toEqual({
      ideas: 2,
      ideasDescribed: 1,
      scoredIdeas: 1,
      bestScore: 50,
      completedExperiments: 2,
    });
    expect(ideaLabJourneyFacts([])).toEqual({
      ideas: 0,
      ideasDescribed: 0,
      scoredIdeas: 0,
      bestScore: null,
      completedExperiments: 0,
    });
  });
});

describe('propriétés', () => {
  function randomRatings(seed: number): IdeaRatingInput[] {
    const rand = generator(seed);
    return IDEA_CRITERION_IDS.flatMap((id) =>
      rand() < 0.75 ? [rate(id, Math.floor(rand() * 5), rand() < 0.9 ? 'preuve' : '')] : [],
    );
  }
  const exact = (r: IdeaValidationResult): number => {
    const ok = r.criteres.filter((c) => c.etat === 'renseigne');
    const s = ok.reduce((a, c) => a + c.poids * c.note!, 0);
    const w = ok.reduce((a, c) => a + c.poids, 0);
    return (100 * s) / (4 * w);
  };

  it('score borné 0–100, à moins d’un demi-point de la valeur exacte, disponible selon la règle', () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const r = score(randomRatings(seed));
      const ok = r.criteres.filter((c) => c.etat === 'renseigne');
      const w = ok.reduce((a, c) => a + c.poids, 0);
      expect(r.score.disponible).toBe(ok.length >= 4 && w >= 60);
      if (r.score.disponible) {
        expect(r.score.valeur).toBeGreaterThanOrEqual(0);
        expect(r.score.valeur).toBeLessThanOrEqual(100);
        expect(Number.isInteger(r.score.valeur)).toBe(true);
        expect(Math.abs(r.score.valeur - exact(r))).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('invariance par permutation des notes', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const ratings = randomRatings(seed);
      const rand = generator(seed * 7);
      const shuffled = [...ratings].sort(() => rand() - 0.5);
      expect(score(shuffled)).toEqual(score(ratings));
    }
  });

  it('monotonie : relever une note renseignée ne baisse jamais le score', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const ratings = randomRatings(seed);
      const before = score(ratings);
      if (!before.score.disponible) continue;
      for (const [i, r] of ratings.entries()) {
        if (r.note >= 4) continue;
        const raised = ratings.map((x, j) => (j === i ? { ...x, note: x.note + 1 } : x));
        const after = score(raised);
        if (after.score.disponible) {
          expect(after.score.valeur).toBeGreaterThanOrEqual(before.score.valeur);
        }
      }
    }
  });
});
