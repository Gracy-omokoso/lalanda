// Écarts prévisionnel vs réalisé — tests unitaires purs (S18b, docs/08 § Écarts).
//
// Ces tests tournent sans MongoDB : ils gardent la logique de comparaison sous
// contrôle même quand la suite e2e est skippée (CI sans MONGODB_URI).
//
// Doctrine vérifiée de bout en bout : on ne fabrique jamais un chiffre. Ni écart
// de ±100 % sur une ligne absente du plan ou jamais saisie, ni extrapolation de
// l'exercice 1 sur un exercice que le plan comparé ne publie pas.

import { describe, expect, it } from 'vitest';

import {
  computeUpdatedProjection,
  computeVariances,
  inferSens,
  parseSoldeFormula,
  referenceLines,
  resolveAnnualBase,
  type PeriodInput,
  type PlanLineInput,
} from './variance.js';

/**
 * Plan calqué sur le template restaurant : compte d'exploitation mensuel
 * (exercice 1) + série annuelle `projection` publiée pour le CA seulement.
 * CA 10 000/mois, coût matière 4 000, charges opérationnelles 3 000, EBE 3 000.
 */
const PLAN: PlanLineInput[] = [
  {
    sheetId: 'activite',
    lineId: 'ca',
    label: "Chiffre d'affaires",
    value: 10_000,
    format: 'money',
    formulaSource: 'couverts_jour * ticket_moyen',
  },
  {
    sheetId: 'activite',
    lineId: 'cout_matiere',
    label: 'Coût matière',
    value: 4_000,
    format: 'money',
    formulaSource: 'ca * food_cost_pct',
  },
  {
    sheetId: 'activite',
    lineId: 'marge_matiere',
    label: 'Marge sur matière',
    value: 6_000,
    format: 'money',
    formulaSource: 'ca - cout_matiere',
  },
  {
    sheetId: 'activite',
    lineId: 'charges_operationnelles',
    label: 'Charges opérationnelles',
    value: 3_000,
    format: 'money',
    formulaSource: 'personnel_mois + loyer_mois',
  },
  {
    sheetId: 'activite',
    lineId: 'excedent_brut',
    label: "Excédent brut d'exploitation",
    value: 3_000,
    format: 'money',
    formulaSource: 'marge_matiere - charges_operationnelles',
  },
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
  // Série annuelle publiée par le plan — seulement pour le CA, et seulement 2 ans.
  {
    sheetId: 'projection',
    lineId: 'ca_annuel_1',
    label: 'CA année 1',
    value: 120_000,
    format: 'money',
  },
  {
    sheetId: 'projection',
    lineId: 'ca_annuel_2',
    label: 'CA année 2',
    value: 144_000,
    format: 'money',
  },
];

const REF_IDS = ['ca', 'cout_matiere', 'marge_matiere', 'charges_operationnelles', 'excedent_brut'];

function period(
  month: number,
  values: Record<string, number>,
  status: 'open' | 'closed' = 'open',
): PeriodInput {
  return { month, status, values };
}

describe('referenceLines', () => {
  it('ne retient que les lignes monétaires du compte d’exploitation', () => {
    expect(referenceLines(PLAN).map((l) => l.lineId)).toEqual(REF_IDS);
  });

  it('renvoie une liste vide pour un plan sans feuille activite', () => {
    expect(referenceLines(PLAN.filter((l) => l.sheetId !== 'activite'))).toEqual([]);
  });
});

describe('inferSens', () => {
  it('classe en charge les identifiants de coûts', () => {
    for (const id of [
      'cout_matiere',
      'achats_marchandises',
      'salaires',
      'charges_operationnelles',
      'impot_bic',
      'frais_bancaires',
    ]) {
      expect(inferSens(id)).toBe('charge');
    }
  });

  it('classe en produit le chiffre d’affaires et les soldes de gestion', () => {
    for (const id of ['ca', 'ca_mensuel', 'marge_matiere', 'resultat_net', 'excedent_brut']) {
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

// ─── B1 : base annuelle par exercice ───────────────────────────
describe('resolveAnnualBase', () => {
  it('exercice 1 : la série annuelle du plan fait foi quand elle existe', () => {
    expect(resolveAnnualBase(PLAN, 'ca', 1)).toEqual({ planAnnuel: 120_000, source: 'projection' });
  });

  it('exercice 1 : repli sur activite × 12 pour les lignes sans série annuelle', () => {
    expect(resolveAnnualBase(PLAN, 'cout_matiere', 1)).toEqual({
      planAnnuel: 48_000,
      source: 'activite_x12',
    });
  });

  it('exercice 2 : la base vient de la série annuelle, jamais d’une extrapolation', () => {
    // 144 000 = croissance publiée par le plan, PAS 120 000 recopiés de l'année 1.
    expect(resolveAnnualBase(PLAN, 'ca', 2)).toEqual({
      planAnnuel: 144_000,
      source: 'projection',
    });
  });

  it('exercice 2 : aucune base pour une ligne sans série annuelle', () => {
    expect(resolveAnnualBase(PLAN, 'cout_matiere', 2)).toBeNull();
    // Le repli activite × 12 est réservé à l'exercice 1.
    expect(resolveAnnualBase(PLAN, 'ca', 3)).toBeNull();
  });
});

describe('computeVariances — exercice 1, cas chiffré', () => {
  // 2 mois saisis. Prévu cumulé : CA 20 000, coût matière 8 000.
  const periods = [
    period(1, { ca: 9_000, cout_matiere: 3_500 }),
    period(2, { ca: 12_000, cout_matiere: 5_000 }),
  ];
  const lines = computeVariances(PLAN, periods, 1);
  const byId = Object.fromEntries(lines.map((l) => [l.lineId, l]));

  it('cumule le prévu au prorata annuel ÷ 12 sur les mois saisis', () => {
    expect(byId['ca']!.base).toBe('projection');
    expect(byId['ca']!.prevuMensuel).toBe(10_000);
    expect(byId['ca']!.prevuCumule).toBe(20_000);
    expect(byId['cout_matiere']!.base).toBe('activite_x12');
    expect(byId['cout_matiere']!.prevuCumule).toBe(8_000);
  });

  it('calcule écart absolu et relatif', () => {
    // CA : 21 000 réalisé vs 20 000 prévu → +1 000, soit +5 %.
    expect(byId['ca']!.realiseCumule).toBe(21_000);
    expect(byId['ca']!.ecart).toBe(1_000);
    expect(byId['ca']!.ecartPct).toBe(0.05);
  });

  it('produit au-dessus du plan = favorable, en dessous = défavorable', () => {
    expect(byId['ca']!.sens).toBe('produit');
    expect(byId['ca']!.statut).toBe('favorable');

    const sousPerforme = computeVariances(PLAN, [period(1, { ca: 6_000 })], 1);
    expect(sousPerforme.find((l) => l.lineId === 'ca')!.statut).toBe('defavorable');
  });

  it('charge sous le plan = favorable, au-dessus = défavorable', () => {
    // Coût matière : 8 500 réalisé vs 8 000 prévu → dépassement → défavorable.
    expect(byId['cout_matiere']!.sens).toBe('charge');
    expect(byId['cout_matiere']!.ecart).toBe(500);
    expect(byId['cout_matiere']!.statut).toBe('defavorable');
  });

  it('écart nul = conforme, ni favorable ni défavorable', () => {
    const pile = computeVariances(PLAN, [period(1, { ca: 10_000 })], 1);
    expect(pile.find((l) => l.lineId === 'ca')!.ecart).toBe(0);
    expect(pile.find((l) => l.lineId === 'ca')!.statut).toBe('conforme');
  });

  it('écart relatif null quand la base prévue est nulle', () => {
    const gratuit: PlanLineInput[] = [
      { sheetId: 'activite', lineId: 'ca', label: 'CA', value: 0, format: 'money' },
    ];
    const [ligne] = computeVariances(gratuit, [period(1, { ca: 500 })], 1);
    expect(ligne!.prevuCumule).toBe(0);
    expect(ligne!.ecart).toBe(500);
    expect(ligne!.ecartPct).toBeNull();
  });
});

// ─── I1 : ligne du plan jamais saisie ──────────────────────────
describe('computeVariances — ligne jamais saisie', () => {
  it('ne fabrique PAS un écart de −100 % défavorable', () => {
    const lines = computeVariances(PLAN, [period(1, { ca: 9_000 })], 1);
    const cout = lines.find((l) => l.lineId === 'cout_matiere')!;
    expect(cout.comparable).toBe(true);
    expect(cout.saisi).toBe(false);
    expect(cout.realiseCumule).toBeNull();
    expect(cout.ecart).toBeNull();
    expect(cout.ecartPct).toBeNull();
    expect(cout.statut).toBeNull();
    // Le prévu mensuel reste affiché : c'est une donnée du plan, pas une invention.
    expect(cout.prevuMensuel).toBe(4_000);
    expect(cout.prevuCumule).toBeNull();
  });

  it('un montant 0 explicitement saisi reste une observation réelle', () => {
    const lines = computeVariances(PLAN, [period(1, { cout_matiere: 0 })], 1);
    const cout = lines.find((l) => l.lineId === 'cout_matiere')!;
    expect(cout.saisi).toBe(true);
    expect(cout.realiseCumule).toBe(0);
    expect(cout.ecart).toBe(-4_000);
    expect(cout.statut).toBe('favorable'); // charge sous le plan
  });

  it('le périmètre du cumul suit les mois où la ligne est saisie', () => {
    // CA saisi sur 2 mois, coût matière sur 1 seul → prévus cumulés différents.
    const lines = computeVariances(
      PLAN,
      [period(1, { ca: 10_000, cout_matiere: 4_000 }), period(2, { ca: 10_000 })],
      1,
    );
    const byId = Object.fromEntries(lines.map((l) => [l.lineId, l]));
    expect(byId['ca']!.prevuCumule).toBe(20_000);
    expect(byId['cout_matiere']!.prevuCumule).toBe(4_000);
    expect(byId['cout_matiere']!.ecart).toBe(0);
  });

  it('sans aucune période, rien n’est ni saisi ni comparé', () => {
    const lines = computeVariances(PLAN, [], 1);
    expect(lines).toHaveLength(5);
    expect(lines.every((l) => l.saisi === false)).toBe(true);
    expect(lines.every((l) => l.realiseCumule === null && l.ecart === null)).toBe(true);
    expect(lines.every((l) => l.statut === null)).toBe(true);
  });
});

// ─── B1 : exercices non publiés par le plan comparé ────────────
describe('computeVariances — exercice au-delà de ce que publie le plan', () => {
  const periods = [period(1, { ca: 11_000, cout_matiere: 4_500 })];

  it('exercice 2 : le CA se compare à la série annuelle publiée', () => {
    const ca = computeVariances(PLAN, periods, 2).find((l) => l.lineId === 'ca')!;
    expect(ca.comparable).toBe(true);
    expect(ca.base).toBe('projection');
    // 144 000 ÷ 12 = 12 000, et non 10 000 (l'exercice 1 recopié).
    expect(ca.prevuMensuel).toBe(12_000);
    expect(ca.prevuCumule).toBe(12_000);
    expect(ca.ecart).toBe(-1_000);
    expect(ca.statut).toBe('defavorable');
  });

  it('exercice 2 : une ligne sans série annuelle devient non comparable', () => {
    const cout = computeVariances(PLAN, periods, 2).find((l) => l.lineId === 'cout_matiere')!;
    expect(cout.comparable).toBe(false);
    expect(cout.raison).toBe('EXERCICE_ABSENT_DU_PLAN');
    expect(cout.prevuMensuel).toBeNull();
    expect(cout.ecart).toBeNull();
    expect(cout.statut).toBeNull();
    // Le réalisé saisi reste visible.
    expect(cout.saisi).toBe(true);
    expect(cout.realiseCumule).toBe(4_500);
  });

  it('exercice 3 : plan 2 ans → tout est non comparable, aucun écart inventé', () => {
    const lines = computeVariances(PLAN, periods, 3);
    const comparables = lines.filter((l) => l.comparable);
    expect(comparables).toHaveLength(0);
    expect(lines.every((l) => l.raison === 'EXERCICE_ABSENT_DU_PLAN')).toBe(true);
    expect(lines.every((l) => l.ecart === null && l.ecartPct === null)).toBe(true);
  });
});

// ─── ADR-0011 friction n°3 : lignes hors du plan comparé ───────
describe('computeVariances — lignes absentes du plan comparé', () => {
  const periods = [period(1, { ca: 10_000, caf_totale: 2_500, solde_final: 11_000 })];
  const lines = computeVariances(PLAN, periods, 1);
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

  it('les lignes du plan restent en tête de liste', () => {
    expect(lines.slice(0, 5).map((l) => l.lineId)).toEqual(REF_IDS);
  });

  it('est reproductible : deux appels donnent le même ordre', () => {
    const a = computeVariances(PLAN, periods, 1).map((l) => l.lineId);
    const b = computeVariances(PLAN, periods, 1).map((l) => l.lineId);
    expect(a).toEqual(b);
  });

  it('un plan sans feuille activite ne renvoie que du non comparable', () => {
    const planAncien = PLAN.filter((l) => l.sheetId === 'tresorerie');
    const lignes = computeVariances(planAncien, [period(1, { ca: 9_000 })], 1);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]!.comparable).toBe(false);
    expect(lignes[0]!.raison).toBe('LIGNE_ABSENTE_DU_PLAN');
    expect(lignes[0]!.realiseCumule).toBe(9_000);
  });
});

// ─── I2 : cohérence des soldes saisis ──────────────────────────
describe('parseSoldeFormula', () => {
  const refIds = new Set(REF_IDS);

  it('décompose une pure combinaison ± de lignes de référence', () => {
    expect(
      parseSoldeFormula('marge_matiere - charges_operationnelles', 'excedent_brut', refIds),
    ).toEqual([
      { lineId: 'marge_matiere', signe: 1 },
      { lineId: 'charges_operationnelles', signe: -1 },
    ]);
  });

  it('renonce dès qu’une multiplication, une division ou une fonction apparaît', () => {
    // Réimplémenter ces formules créerait une seconde source de vérité de calcul.
    expect(parseSoldeFormula('ca * food_cost_pct', 'cout_matiere', refIds)).toBeNull();
    expect(
      parseSoldeFormula('IF(excedent_brut > 0, excedent_brut * t, 0)', 'ibp', refIds),
    ).toBeNull();
    expect(parseSoldeFormula('ca / 12', 'x', refIds)).toBeNull();
  });

  it('renonce si un terme n’est pas une ligne de référence (driver, autre feuille)', () => {
    expect(parseSoldeFormula('marge_brute - charges_fixes_mois', 'resultat', refIds)).toBeNull();
  });

  it('renonce sur une auto-référence ou un terme unique', () => {
    expect(parseSoldeFormula('ca', 'marge_matiere', refIds)).toBeNull();
    expect(parseSoldeFormula('ca - excedent_brut', 'excedent_brut', refIds)).toBeNull();
  });

  it('renonce en l’absence de formule (snapshot ancien)', () => {
    expect(parseSoldeFormula(undefined, 'excedent_brut', refIds)).toBeNull();
  });
});

describe('computeVariances — diagnostic INCOHERENCE_SOLDE', () => {
  it('signale un solde saisi qui ne découle pas de ses composants', () => {
    // EBE déclaré 5 000 alors que marge 6 000 − charges 3 000 = 3 000.
    const lines = computeVariances(
      PLAN,
      [period(1, { marge_matiere: 6_000, charges_operationnelles: 3_000, excedent_brut: 5_000 })],
      1,
    );
    const ebe = lines.find((l) => l.lineId === 'excedent_brut')!;
    expect(ebe.diagnostics).toHaveLength(1);
    expect(ebe.diagnostics[0]!.code).toBe('INCOHERENCE_SOLDE');
    expect(ebe.diagnostics[0]!.months).toEqual([1]);
    // La saisie de l'utilisateur n'est PAS corrigée d'office.
    expect(ebe.realiseCumule).toBe(5_000);
  });

  it('reste muet quand le solde est cohérent (tolérance d’arrondi incluse)', () => {
    const lines = computeVariances(
      PLAN,
      [
        period(1, {
          marge_matiere: 6_000,
          charges_operationnelles: 3_000,
          excedent_brut: 3_000.004,
        }),
      ],
      1,
    );
    expect(lines.find((l) => l.lineId === 'excedent_brut')!.diagnostics).toEqual([]);
  });

  it('reste muet si un composant n’est pas saisi — un manque ne vaut pas 0', () => {
    const lines = computeVariances(PLAN, [period(1, { excedent_brut: 5_000 })], 1);
    expect(lines.find((l) => l.lineId === 'excedent_brut')!.diagnostics).toEqual([]);
  });

  it('agrège les mois incohérents d’une même ligne', () => {
    const lines = computeVariances(
      PLAN,
      [
        period(1, { ca: 10_000, cout_matiere: 4_000, marge_matiere: 9_999 }),
        period(2, { ca: 10_000, cout_matiere: 4_000, marge_matiere: 6_000 }),
        period(3, { ca: 10_000, cout_matiere: 4_000, marge_matiere: 1 }),
      ],
      1,
    );
    expect(lines.find((l) => l.lineId === 'marge_matiere')!.diagnostics[0]!.months).toEqual([1, 3]);
  });

  it('ne diagnostique rien sur les lignes de base sans formule combinatoire', () => {
    const lines = computeVariances(PLAN, [period(1, { ca: 1, cout_matiere: 2 })], 1);
    expect(lines.find((l) => l.lineId === 'ca')!.diagnostics).toEqual([]);
    expect(lines.find((l) => l.lineId === 'cout_matiere')!.diagnostics).toEqual([]);
  });
});

describe('computeUpdatedProjection', () => {
  it('combine réalisé clôturé et prévisionnel des mois restants', () => {
    const periods = [
      period(1, { ca: 12_000 }, 'closed'),
      period(2, { ca: 13_000 }, 'closed'),
      // Mois ouvert : compte comme « restant », pas comme observation ferme.
      period(3, { ca: 50_000 }, 'open'),
    ];
    const ca = computeUpdatedProjection(PLAN, periods, 1).find((l) => l.lineId === 'ca')!;
    expect(ca.planAnnuel).toBe(120_000);
    expect(ca.realiseClos).toBe(25_000);
    // 10 mois restants × 10 000.
    expect(ca.previsionnelRestant).toBe(100_000);
    expect(ca.totalProjete).toBe(125_000);
    expect(ca.ecartVsPlan).toBe(5_000);
  });

  it('sans aucune clôture, la projection égale le plan annuel', () => {
    const lignes = computeUpdatedProjection(PLAN, [period(1, { ca: 99_000 })], 1);
    const ca = lignes.find((l) => l.lineId === 'ca')!;
    expect(ca.realiseClos).toBe(0);
    expect(ca.totalProjete).toBe(120_000);
    expect(ca.ecartVsPlan).toBe(0);
  });

  it('mois clôturés mais ligne absente : observation manquante, pas un zéro', () => {
    const lignes = computeUpdatedProjection(PLAN, [period(1, { ca: 10_000 }, 'closed')], 1);
    const cout = lignes.find((l) => l.lineId === 'cout_matiere')!;
    expect(cout.realiseClos).toBeNull();
    expect(cout.totalProjete).toBeNull();
    expect(cout.ecartVsPlan).toBeNull();
    // La part connue du plan reste affichée.
    expect(cout.planAnnuel).toBe(48_000);
    expect(cout.previsionnelRestant).toBe(44_000);
  });

  it('utilise la base annuelle de l’exercice demandé', () => {
    const ca = computeUpdatedProjection(PLAN, [period(1, { ca: 12_000 }, 'closed')], 2).find(
      (l) => l.lineId === 'ca',
    )!;
    expect(ca.planAnnuel).toBe(144_000);
    expect(ca.previsionnelRestant).toBe(132_000); // 11 × 12 000
    expect(ca.totalProjete).toBe(144_000);
  });

  it('ne projette pas un exercice que le plan ne publie pas', () => {
    const cout = computeUpdatedProjection(PLAN, [period(1, { cout_matiere: 1 })], 2).find(
      (l) => l.lineId === 'cout_matiere',
    )!;
    expect(cout.comparable).toBe(false);
    expect(cout.raison).toBe('EXERCICE_ABSENT_DU_PLAN');
    expect(cout.planAnnuel).toBeNull();
    expect(cout.totalProjete).toBeNull();
  });

  it('ne projette pas une ligne absente du plan', () => {
    const lignes = computeUpdatedProjection(PLAN, [period(1, { caf_totale: 2_000 }, 'closed')], 1);
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
