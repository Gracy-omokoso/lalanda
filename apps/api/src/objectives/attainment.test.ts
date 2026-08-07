// S18d — taux d'atteinte : unités pures, sans base de données.
//
// Exigence structurante testée (ADR-0011, risque n°4) : une ligne absente du
// snapshot ne produit JAMAIS 0 ni une valeur inventée, mais `atteinte: null`
// + `raison: 'LIGNE_INDISPONIBLE'`.

import { describe, expect, it } from 'vitest';

import type { EvaluationView } from '../evaluate/evaluation-view.js';
import { computeAttainment, computeTauxPct, statutFromTaux } from './attainment.js';

function view(lines: Record<string, number>): EvaluationView {
  return {
    lines: Object.entries(lines).map(([lineId, value]) => ({
      sheetId: 'projection',
      lineId,
      label: lineId,
      formulaSource: '=…',
      value,
      format: 'money' as const,
    })),
  };
}

describe('computeTauxPct', () => {
  it('exprime le ratio observé/cible en %, arrondi à 0,1', () => {
    expect(computeTauxPct(100_000, 75_000)).toBe(75);
    expect(computeTauxPct(3, 1)).toBe(33.3);
    expect(computeTauxPct(120_000, 150_000)).toBe(125);
  });

  it('cible nulle : atteinte si la valeur observée est ≥ 0', () => {
    expect(computeTauxPct(0, 0)).toBe(100);
    expect(computeTauxPct(0, 42)).toBe(100);
    expect(computeTauxPct(0, -1)).toBe(0);
  });

  it('valeur négative contre cible positive → taux négatif, pas de plancher', () => {
    expect(computeTauxPct(1000, -500)).toBe(-50);
  });
});

describe('statutFromTaux', () => {
  it('applique les bornes 100 % / 80 %', () => {
    expect(statutFromTaux(140)).toBe('atteint');
    expect(statutFromTaux(100)).toBe('atteint');
    expect(statutFromTaux(99.9)).toBe('partiel');
    expect(statutFromTaux(80)).toBe('partiel');
    expect(statutFromTaux(79.9)).toBe('non_atteint');
  });
});

describe('computeAttainment', () => {
  it('mappe chaque objectif par id de ligne du snapshot', () => {
    const res = computeAttainment(
      { ca_cible_an1: 100_000, resultat_net_cible_an1: 20_000 },
      view({ ca_annuel_1: 90_000, resultat_annuel_1: 25_000 }),
    );

    const ca = res.find((o) => o.objectif === 'ca_cible_an1');
    expect(ca).toMatchObject({
      lineId: 'ca_annuel_1',
      cible: 100_000,
      valeur: 90_000,
      atteinte: 90,
      statut: 'partiel',
      raison: null,
    });

    const rn = res.find((o) => o.objectif === 'resultat_net_cible_an1');
    expect(rn).toMatchObject({ atteinte: 125, statut: 'atteint', raison: null });
  });

  it('ligne absente du snapshot → atteinte null + LIGNE_INDISPONIBLE (jamais 0)', () => {
    // Snapshot d'horizon 3 ans : `ca_annuel_5` n'existe pas avant FIN-001.
    const res = computeAttainment(
      { ca_cible_an1: 100_000, ca_cible_an5: 900_000 },
      view({ ca_annuel_1: 100_000, ca_annuel_2: 200_000, ca_annuel_3: 300_000 }),
    );

    const an5 = res.find((o) => o.objectif === 'ca_cible_an5');
    expect(an5).toMatchObject({
      cible: 900_000,
      lineId: null,
      valeur: null,
      atteinte: null,
      statut: 'indisponible',
      raison: 'LIGNE_INDISPONIBLE',
    });
    expect(an5?.atteinte).not.toBe(0);

    // L'objectif mesurable du même appel reste évalué normalement.
    expect(res.find((o) => o.objectif === 'ca_cible_an1')?.atteinte).toBe(100);
  });

  it('ignore les objectifs non renseignés', () => {
    const res = computeAttainment({ ca_cible_an1: 50_000 }, view({ ca_annuel_1: 50_000 }));
    expect(res).toHaveLength(1);
    expect(res[0]?.objectif).toBe('ca_cible_an1');
  });

  it('cible à 0 explicite est évaluée (0 ≠ non renseigné)', () => {
    const res = computeAttainment({ resultat_net_cible_an1: 0 }, view({ resultat_annuel_1: 10 }));
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ cible: 0, atteinte: 100, statut: 'atteint' });
  });
});
