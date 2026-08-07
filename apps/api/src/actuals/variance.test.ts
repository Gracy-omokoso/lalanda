// Écarts prévisionnel vs réalisé — tests unitaires purs (S18b, docs/08 § Écarts).
//
// Ces tests tournent sans MongoDB : ils gardent la logique de comparaison sous
// contrôle même quand la suite e2e est skippée (CI sans MONGODB_URI).

import { describe, expect, it } from 'vitest';

import {
  computeUpdatedProjection,
  computeVariances,
  inferSens,
  referenceLines,
  type PeriodInput,
  type PlanLineInput,
} from './variance.js';

/** Plan de référence : CA 10 000/mois, achats 4 000/mois, salaires 3 000/mois. */
const PLAN: PlanLineInput[] = [
  {
    sheetId: 'activite',
    lineId: 'ca_mensuel',
    label: "Chiffre d'affaires",
    value: 10_000,
    format: 'money',
  },
  {
    sheetId: 'activite',
    lineId: 'achats_marchandises',
    label: 'Achats',
    value: 4_000,
    format: 'money',
  },
  { sheetId: 'activite', lineId: 'salaires', label: 'Salaires', value: 3_000, format: 'money' },
  // Ligne non monétaire de la même feuille : hors périmètre du suivi réalisé.
  {
    sheetId: 'activite',
    lineId: 'taux_marge',
    label: 'Taux de marge',
    value: 0.6,
    format: 'percent',
  },
  // Autre feuille : hors compte d'exploitation.
  {
    sheetId: 'tresorerie',
    lineId: 'solde_final',
    label: 'Solde final',
    value: 12_000,
    format: 'money',
  },
];

function period(
  month: number,
  values: Record<string, number>,
  status: 'open' | 'closed' = 'open',
): PeriodInput {
  return { month, status, values };
}

describe('referenceLines', () => {
  it('ne retient que les lignes monétaires du compte d’exploitation', () => {
    expect(referenceLines(PLAN).map((l) => l.lineId)).toEqual([
      'ca_mensuel',
      'achats_marchandises',
      'salaires',
    ]);
  });

  it('renvoie une liste vide pour un plan sans feuille activite', () => {
    expect(referenceLines([PLAN[4]!])).toEqual([]);
  });
});

describe('inferSens', () => {
  it('classe en charge les identifiants de coûts', () => {
    for (const id of [
      'achats_marchandises',
      'salaires',
      'charges_locatives',
      'impot_bic',
      'frais_bancaires',
    ]) {
      expect(inferSens(id)).toBe('charge');
    }
  });

  it('classe en produit le chiffre d’affaires et les soldes de gestion', () => {
    for (const id of ['ca', 'ca_mensuel', 'marge_brute', 'resultat_net', 'excedent_brut']) {
      expect(inferSens(id)).toBe('produit');
    }
  });

  it('un solde de gestion prime sur un mot de charge en fin d’identifiant', () => {
    // Piège du template hello-world : `resultat_avant_impot` est un solde, pas un impôt.
    expect(inferSens('resultat_avant_impot')).toBe('produit');
    expect(inferSens('marge_apres_charges')).toBe('produit');
    // Le mot-clé garde la main quand il n'y a pas de préfixe de solde.
    expect(inferSens('impot_bic')).toBe('charge');
  });
});

describe('computeVariances — cas chiffré', () => {
  // 2 mois saisis. Prévu cumulé : CA 20 000, achats 8 000, salaires 6 000.
  const periods = [
    period(1, { ca_mensuel: 9_000, achats_marchandises: 3_500, salaires: 3_000 }),
    period(2, { ca_mensuel: 12_000, achats_marchandises: 5_000, salaires: 3_000 }),
  ];
  const lines = computeVariances(PLAN, periods);
  const byId = Object.fromEntries(lines.map((l) => [l.lineId, l]));

  it('cumule le prévu au prorata annuel/12 sur les mois saisis', () => {
    expect(byId['ca_mensuel']!.prevuMensuel).toBe(10_000);
    expect(byId['ca_mensuel']!.prevuCumule).toBe(20_000);
    expect(byId['salaires']!.prevuCumule).toBe(6_000);
  });

  it('calcule écart absolu et relatif', () => {
    // CA : 21 000 réalisé vs 20 000 prévu → +1 000, soit +5 %.
    expect(byId['ca_mensuel']!.realiseCumule).toBe(21_000);
    expect(byId['ca_mensuel']!.ecart).toBe(1_000);
    expect(byId['ca_mensuel']!.ecartPct).toBe(0.05);
  });

  it('produit au-dessus du plan = favorable, en dessous = défavorable', () => {
    expect(byId['ca_mensuel']!.sens).toBe('produit');
    expect(byId['ca_mensuel']!.statut).toBe('favorable');

    const sousPerforme = computeVariances(PLAN, [period(1, { ca_mensuel: 6_000 })]);
    expect(sousPerforme.find((l) => l.lineId === 'ca_mensuel')!.statut).toBe('defavorable');
  });

  it('charge sous le plan = favorable, au-dessus = défavorable', () => {
    // Achats : 8 500 réalisé vs 8 000 prévu → dépassement → défavorable.
    expect(byId['achats_marchandises']!.sens).toBe('charge');
    expect(byId['achats_marchandises']!.ecart).toBe(500);
    expect(byId['achats_marchandises']!.statut).toBe('defavorable');

    // Salaires : exactement conformes → écart nul → favorable (aucune dérive).
    expect(byId['salaires']!.ecart).toBe(0);
    expect(byId['salaires']!.statut).toBe('favorable');
  });

  it('écart relatif null quand la base prévue est nulle', () => {
    const gratuit: PlanLineInput[] = [
      { sheetId: 'activite', lineId: 'ca_mensuel', label: 'CA', value: 0, format: 'money' },
    ];
    const [ligne] = computeVariances(gratuit, [period(1, { ca_mensuel: 500 })]);
    expect(ligne!.prevuCumule).toBe(0);
    expect(ligne!.ecart).toBe(500);
    expect(ligne!.ecartPct).toBeNull();
  });

  it('une ligne du plan jamais saisie compte pour 0 de réalisé', () => {
    const [ligne] = computeVariances(PLAN, [period(1, {})]);
    expect(ligne!.realiseCumule).toBe(0);
    expect(ligne!.ecart).toBe(-10_000);
    expect(ligne!.statut).toBe('defavorable');
  });

  it('sans période saisie, tout est à zéro (aucune division par zéro)', () => {
    const lignes = computeVariances(PLAN, []);
    expect(lignes).toHaveLength(3);
    expect(lignes.every((l) => l.prevuCumule === 0 && l.realiseCumule === 0)).toBe(true);
    expect(lignes.every((l) => l.ecartPct === null)).toBe(true);
  });
});

// ─── ADR-0011 friction n°3 : lignes non comparables ────────────
describe('computeVariances — lignes absentes du plan comparé', () => {
  const periods = [period(1, { ca_mensuel: 10_000, caf_totale: 2_500, solde_final: 11_000 })];
  const lines = computeVariances(PLAN, periods);
  const byId = Object.fromEntries(lines.map((l) => [l.lineId, l]));

  it('ne fabrique JAMAIS un écart de 100 % pour une ligne absente du plan', () => {
    const caf = byId['caf_totale']!;
    expect(caf.comparable).toBe(false);
    expect(caf.raison).toBe('LIGNE_ABSENTE_DU_PLAN');
    expect(caf.prevuMensuel).toBeNull();
    expect(caf.prevuCumule).toBeNull();
    expect(caf.ecart).toBeNull();
    expect(caf.ecartPct).toBeNull();
    expect(caf.statut).toBeNull();
  });

  it('conserve et affiche le réalisé saisi de la ligne non comparable', () => {
    expect(byId['caf_totale']!.realiseCumule).toBe(2_500);
    expect(byId['caf_totale']!.label).toBe('caf_totale');
  });

  it('distingue une ligne du plan hors compte d’exploitation', () => {
    const solde = byId['solde_final']!;
    expect(solde.comparable).toBe(false);
    expect(solde.raison).toBe('LIGNE_HORS_COMPTE_EXPLOITATION');
    expect(solde.label).toBe('Solde final');
    expect(solde.realiseCumule).toBe(11_000);
  });

  it('les lignes comparables restent intactes et en tête de liste', () => {
    expect(lines.slice(0, 3).every((l) => l.comparable)).toBe(true);
    expect(byId['ca_mensuel']!.ecart).toBe(0);
    expect(byId['ca_mensuel']!.statut).toBe('favorable');
  });

  it('est reproductible : deux appels donnent le même ordre', () => {
    const a = computeVariances(PLAN, periods).map((l) => l.lineId);
    const b = computeVariances(PLAN, periods).map((l) => l.lineId);
    expect(a).toEqual(b);
  });

  it('un plan pré-FIN-001 sans feuille activite ne renvoie que du non comparable', () => {
    const planAncien: PlanLineInput[] = [PLAN[4]!];
    const lignes = computeVariances(planAncien, [period(1, { ca_mensuel: 9_000 })]);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]!.comparable).toBe(false);
    expect(lignes[0]!.raison).toBe('LIGNE_ABSENTE_DU_PLAN');
    expect(lignes[0]!.realiseCumule).toBe(9_000);
  });
});

describe('computeUpdatedProjection', () => {
  it('combine réalisé clôturé et prévisionnel des mois restants', () => {
    const periods = [
      period(1, { ca_mensuel: 12_000 }, 'closed'),
      period(2, { ca_mensuel: 13_000 }, 'closed'),
      // Mois ouvert : compte comme « restant », pas comme observation ferme.
      period(3, { ca_mensuel: 50_000 }, 'open'),
    ];
    const [ca] = computeUpdatedProjection(PLAN, periods);
    expect(ca!.planAnnuel).toBe(120_000);
    expect(ca!.realiseClos).toBe(25_000);
    // 10 mois restants × 10 000.
    expect(ca!.previsionnelRestant).toBe(100_000);
    expect(ca!.totalProjete).toBe(125_000);
    expect(ca!.ecartVsPlan).toBe(5_000);
  });

  it('sans clôture, la projection égale le plan annuel', () => {
    const lignes = computeUpdatedProjection(PLAN, [period(1, { ca_mensuel: 99_000 })]);
    expect(lignes[0]!.realiseClos).toBe(0);
    expect(lignes[0]!.totalProjete).toBe(120_000);
    expect(lignes[0]!.ecartVsPlan).toBe(0);
  });

  it('ne projette pas une ligne non comparable', () => {
    const lignes = computeUpdatedProjection(PLAN, [period(1, { caf_totale: 2_000 }, 'closed')]);
    const caf = lignes.find((l) => l.lineId === 'caf_totale')!;
    expect(caf.comparable).toBe(false);
    expect(caf.raison).toBe('LIGNE_ABSENTE_DU_PLAN');
    expect(caf.planAnnuel).toBeNull();
    expect(caf.previsionnelRestant).toBeNull();
    expect(caf.totalProjete).toBeNull();
    expect(caf.ecartVsPlan).toBeNull();
    expect(caf.realiseClos).toBe(2_000);
  });
});
