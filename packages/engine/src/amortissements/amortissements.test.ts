// Tests unitaires et d'intégration de la feuille amortissements SYSCOHADA (S14c).

import { describe, expect, it } from 'vitest';

import { parseTemplate } from '../dsl/parser.js';
import { evaluateTemplate } from '../evaluator/index.js';
import type { Immobilisation } from '../dsl/schema.js';
import { calculerAmortissements, DUREES_SYSCOHADA } from './index.js';

// ─── Cas unitaires ────────────────────────────────────────────

describe('calculerAmortissements — méthode linéaire SYSCOHADA', () => {
  it('linéaire année pleine : 12 000 sur 3 ans → 4 000/an', () => {
    const immo: Immobilisation = {
      label: 'Ordinateur portable',
      categorie: 'materiel_informatique',
      montant_ht: 12_000,
      date_acquisition: '2026-01-01',
    };
    const feuille = calculerAmortissements([immo], 3);
    expect(feuille.lignes[0]!.duree_annees).toBe(DUREES_SYSCOHADA.materiel_informatique);
    expect(feuille.lignes[0]!.dotations).toEqual([4000, 4000, 4000]);
    expect(feuille.lignes[0]!.vnc).toEqual([8000, 4000, 0]);
  });

  it('prorata temporis 1re année (acquisition 1er juillet → 6/12)', () => {
    const immo: Immobilisation = {
      label: 'Camionnette',
      categorie: 'materiel_transport',
      montant_ht: 60_000, // 60 000 / 5 = 12 000 année pleine
      date_acquisition: '2026-07-01',
    };
    const feuille = calculerAmortissements([immo], 6);
    // Année 1 : 12 000 × 6/12 = 6 000
    // Années 2..5 : 12 000
    // Année 6 : reliquat = 60 000 − (6000 + 4×12000) = 60000 − 54000 = 6000
    expect(feuille.lignes[0]!.prorata_premiere_annee).toBeCloseTo(6 / 12, 10);
    expect(feuille.lignes[0]!.dotations[0]).toBeCloseTo(6000, 6);
    expect(feuille.lignes[0]!.dotations[1]).toBeCloseTo(12000, 6);
    expect(feuille.lignes[0]!.dotations[4]).toBeCloseTo(12000, 6);
    expect(feuille.lignes[0]!.dotations[5]).toBeCloseTo(6000, 6);
    // Cumul = base amortie = 60 000.
    const cumul = feuille.lignes[0]!.dotations.reduce((a, b) => a + b, 0);
    expect(cumul).toBeCloseTo(60000, 6);
  });

  it('multi-immobilisations : totalisation correcte par année', () => {
    const feuille = calculerAmortissements(
      [
        {
          label: 'Camion',
          categorie: 'materiel_transport',
          montant_ht: 50_000, // 10 000/an
          date_acquisition: '2026-01-01',
        },
        {
          label: 'Ordinateur',
          categorie: 'materiel_informatique',
          montant_ht: 3_000, // 1000/an
          date_acquisition: '2026-01-01',
        },
      ],
      3,
    );
    expect(feuille.dap_par_annee[0]).toBeCloseTo(11_000, 6);
    expect(feuille.dap_par_annee[1]).toBeCloseTo(11_000, 6);
    expect(feuille.dap_par_annee[2]).toBeCloseTo(11_000, 6);
  });

  it('VNC en fin de vie = valeur résiduelle', () => {
    const feuille = calculerAmortissements(
      [
        {
          label: 'Voiture avec revente',
          categorie: 'materiel_transport',
          montant_ht: 20_000,
          valeur_residuelle: 5_000,
          date_acquisition: '2026-01-01',
        },
      ],
      5,
    );
    // Base amortissable = 15 000 / 5 ans = 3 000/an
    expect(feuille.lignes[0]!.dotations[0]).toBeCloseTo(3000, 6);
    // VNC après 5 ans = montant_ht − Σ dotations = 20 000 − 15 000 = 5 000 = résiduelle
    expect(feuille.lignes[0]!.vnc[4]).toBeCloseTo(5000, 6);
  });

  it('fin de vie : plus de dotation après période complète', () => {
    const feuille = calculerAmortissements(
      [
        {
          label: 'PC amorti',
          categorie: 'materiel_informatique',
          montant_ht: 3_000, // 3 ans → 1000/an
          date_acquisition: '2026-01-01',
        },
      ],
      6, // horizon > durée
    );
    // Années 4, 5, 6 : dotation = 0.
    expect(feuille.lignes[0]!.dotations[3]).toBe(0);
    expect(feuille.lignes[0]!.dotations[4]).toBe(0);
    expect(feuille.lignes[0]!.dotations[5]).toBe(0);
    // VNC reste à 0 pour les années au-delà de la durée.
    expect(feuille.lignes[0]!.vnc[5]).toBe(0);
  });

  it('surcharge explicite de duree_annees (plage SYSCOHADA)', () => {
    const feuille = calculerAmortissements(
      [
        {
          label: 'Outil léger',
          categorie: 'materiel_outillage',
          montant_ht: 5_000,
          date_acquisition: '2026-01-01',
          duree_annees: 5, // au lieu du défaut 10
        },
      ],
      5,
    );
    expect(feuille.lignes[0]!.duree_annees).toBe(5);
    expect(feuille.lignes[0]!.dotations[0]).toBeCloseTo(1000, 6);
    expect(feuille.lignes[0]!.vnc[4]).toBeCloseTo(0, 6);
  });

  it('durées standard SYSCOHADA conformes au brief S14c', () => {
    expect(DUREES_SYSCOHADA.constructions).toBe(20);
    expect(DUREES_SYSCOHADA.materiel_outillage).toBe(10);
    expect(DUREES_SYSCOHADA.materiel_transport).toBe(5);
    expect(DUREES_SYSCOHADA.materiel_informatique).toBe(3);
    expect(DUREES_SYSCOHADA.mobilier_bureau).toBe(10);
    expect(DUREES_SYSCOHADA.amenagements).toBe(10);
    expect(DUREES_SYSCOHADA.logiciels).toBe(3);
  });
});

// ─── Intégration avec le moteur ───────────────────────────────

describe('evaluateTemplate — intégration feuille amortissements', () => {
  const templateYaml = `
slug: template-amort
version: 1.0.0
horizon_projection_annees: 3
drivers:
  - { id: ca, type: money, defaut: 100000 }
  - { id: charges, type: money, defaut: 60000 }
immobilisations:
  - label: "Camion"
    categorie: materiel_transport
    montant_ht: 50000
    date_acquisition: "2026-01-01"
  - label: "Ordinateur"
    categorie: materiel_informatique
    montant_ht: 3000
    date_acquisition: "2026-01-01"
feuilles:
  - id: activite
    lignes:
      - { id: resultat_net, formule: "ca - charges", format: money }
  - id: projection
    lignes:
      - { id: resultat_annuel_1, formule: "resultat_net", format: money }
      - { id: resultat_annuel_2, formule: "resultat_net", format: money }
      - { id: resultat_annuel_3, formule: "resultat_net", format: money }
`;

  it("expose une feuille 'amortissements' + total DAP", () => {
    const template = parseTemplate(templateYaml);
    const { lines, amortissements } = evaluateTemplate(template, {});
    expect(amortissements).toBeDefined();
    expect(amortissements!.dap_par_annee[0]).toBeCloseTo(11_000, 6);
    // Vérifie que des lignes ont bien sheetId = 'amortissements'
    const amortLines = lines.filter((l) => l.sheetId === 'amortissements');
    expect(amortLines.length).toBeGreaterThan(0);
    // Une ligne total DAP année 1 doit exister avec la bonne valeur.
    const totalA1 = amortLines.find((l) => l.lineId === 'dap_total_a1');
    expect(totalA1?.value).toBeCloseTo(11_000, 6);
  });

  it("injecte des lignes 'resultat_annuel_N_apres_amort' dans la projection", () => {
    const template = parseTemplate(templateYaml);
    const { lines } = evaluateTemplate(template, {});
    const apres = lines.find((l) => l.lineId === 'resultat_annuel_1_apres_amort');
    expect(apres).toBeDefined();
    // resultat_net = 40 000 ; DAP = 11 000 → 29 000
    expect(apres!.value).toBeCloseTo(29_000, 6);
    expect(apres!.sheetId).toBe('projection');
  });

  it('surcharge une ligne dotations_amortissements saisie manuellement', () => {
    const templateWithManualDap = `
slug: t-manual
version: 1.0.0
horizon_projection_annees: 3
drivers:
  - { id: dap_manual, type: money, defaut: 999 }
immobilisations:
  - label: "Camion"
    categorie: materiel_transport
    montant_ht: 50000
    date_acquisition: "2026-01-01"
feuilles:
  - id: activite
    lignes:
      - { id: dotations_amortissements, formule: "dap_manual", format: money }
`;
    const template = parseTemplate(templateWithManualDap);
    const { lines } = evaluateTemplate(template, {});
    const dap = lines.find((l) => l.lineId === 'dotations_amortissements');
    // Doit être surchargée à 10 000 (50 000 / 5), pas 999.
    expect(dap!.value).toBeCloseTo(10_000, 6);
  });
});

// ─── Non-régression ───────────────────────────────────────────

describe("non-régression — template sans immobilisations", () => {
  it("ne produit ni feuille ni lignes 'amortissements'", () => {
    const template = parseTemplate(`
slug: no-immo
version: 1.0.0
drivers:
  - { id: x, type: number, defaut: 10 }
feuilles:
  - id: s
    lignes:
      - { id: y, formule: "x * 2" }
`);
    const { lines, amortissements } = evaluateTemplate(template, {});
    expect(amortissements).toBeUndefined();
    expect(lines.some((l) => l.sheetId === 'amortissements')).toBe(false);
  });
});
