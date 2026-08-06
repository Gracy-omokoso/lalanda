// Tests de l'export Excel (S14b).
//
// Deux niveaux :
//   1. Unitaire — le mapper DSL → formule Excel (MAX, IF, IFERROR, PMT, fallback).
//   2. Intégration légère — on évalue un template moteur réel (hello-world) puis on
//      vérifie que le classeur contient les feuilles attendues, avec les bonnes formules
//      et valeurs. Aucun réseau, aucun Mongo — juste le moteur + ExcelJS.
//
// Contraintes CLAUDE.md :
//   - Le moteur reste la source de vérité — on ne recalcule rien dans le test, on lit
//     les valeurs telles que le moteur les a produites.

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { evaluateTemplate, parseTemplate } from '@lalanda/engine';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { mapDslToExcelFormula, renderReportXlsx } from './report-xlsx.js';
import type { ReportData } from './report-html.js';

// ─── 1. Mapper DSL → Excel ───────────────────────────────────

describe('mapDslToExcelFormula', () => {
  const resolver = (id: string): { sheet: string; address: string } | undefined => {
    const table: Record<string, { sheet: string; address: string }> = {
      prix_unitaire: { sheet: 'Hypothèses', address: 'B2' },
      quantite_mois: { sheet: 'Hypothèses', address: 'B3' },
      cout_variable_pct: { sheet: 'Hypothèses', address: 'B4' },
      taux_annuel: { sheet: 'Hypothèses', address: 'B5' },
      duree_mois: { sheet: 'Hypothèses', address: 'B6' },
      capital: { sheet: 'Hypothèses', address: 'B7' },
      ca: { sheet: "Compte d'exploitation", address: 'B2' },
      cout: { sheet: "Compte d'exploitation", address: 'B3' },
      profit: { sheet: "Compte d'exploitation", address: 'B4' },
    };
    return table[id];
  };

  it('remplace un identifiant simple par sa référence Excel qualifiée', () => {
    const { formula, allResolved } = mapDslToExcelFormula(
      'prix_unitaire * quantite_mois',
      resolver,
    );
    expect(formula).toBe("'Hypothèses'!B2 * 'Hypothèses'!B3");
    expect(allResolved).toBe(true);
  });

  it('cite les feuilles dont le nom contient des espaces ou accents', () => {
    const { formula } = mapDslToExcelFormula('ca - cout', resolver);
    // ExcelJS attend le nom d'onglet cité avec des apostrophes.
    expect(formula).toContain("'Compte d''exploitation'!B2");
    expect(formula).toContain("'Compte d''exploitation'!B3");
  });

  it('préserve MAX en fonction Excel native', () => {
    const { formula, allResolved } = mapDslToExcelFormula('MAX(0, profit)', resolver);
    expect(formula).toBe("MAX(0, 'Compte d''exploitation'!B4)");
    expect(allResolved).toBe(true);
  });

  it('préserve IF et normalise la casse en majuscules', () => {
    const { formula } = mapDslToExcelFormula('if(profit > 0, profit, 0)', resolver);
    expect(formula.startsWith('IF(')).toBe(true);
    expect(formula).toContain("'Compte d''exploitation'!B4");
  });

  it('préserve IFERROR', () => {
    const { formula, allResolved } = mapDslToExcelFormula('IFERROR(ca / cout, 0)', resolver);
    expect(formula).toBe("IFERROR('Compte d''exploitation'!B2 / 'Compte d''exploitation'!B3, 0)");
    expect(allResolved).toBe(true);
  });

  it('préserve PMT avec signature Excel identique', () => {
    const { formula, allResolved } = mapDslToExcelFormula(
      'PMT(taux_annuel / 12, duree_mois, -capital)',
      resolver,
    );
    expect(formula).toBe(
      "PMT('Hypothèses'!B5 / 12, 'Hypothèses'!B6, -'Hypothèses'!B7)",
    );
    expect(allResolved).toBe(true);
  });

  it('marque allResolved=false quand un identifiant est inconnu (fallback)', () => {
    const { formula, allResolved } = mapDslToExcelFormula('inconnu * 2', resolver);
    expect(formula).toBe('inconnu * 2');
    expect(allResolved).toBe(false);
  });

  it('gère les combinaisons imbriquées MAX + IFERROR + IF', () => {
    const { formula, allResolved } = mapDslToExcelFormula(
      'MAX(0, IFERROR(IF(ca > 0, ca - cout, 0), 0))',
      resolver,
    );
    expect(allResolved).toBe(true);
    expect(formula).toContain('MAX(');
    expect(formula).toContain('IFERROR(');
    expect(formula).toContain('IF(');
  });
});

// ─── 2. Rendu complet du classeur ─────────────────────────────

describe('renderReportXlsx', () => {
  // Charge le template moteur "hello-world" (identique à celui utilisé par la CI moteur).
  const templatePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../packages/engine/src/toy-template.yaml',
  );
  const template = parseTemplate(readFileSync(templatePath, 'utf-8'));

  function buildData(): ReportData {
    const evaluation = evaluateTemplate(template, {});
    return {
      organization: { name: 'Org test', pays: 'CD' },
      project: {
        name: 'Projet démo',
        templateSlug: template.slug,
        pays: 'CD',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
      template,
      driverValues: Object.fromEntries(evaluation.drivers),
      lines: evaluation.lines.map((l) => ({
        sheetId: l.sheetId,
        lineId: l.lineId,
        label: l.label,
        value: l.value,
        format: l.format,
        seuil: l.seuil,
      })),
      generatedAt: '2025-01-01T12:00:00.000Z',
      currency: 'USD',
    };
  }

  it("produit un Buffer .xlsx non vide", async () => {
    const buf = await renderReportXlsx(buildData());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.byteLength).toBeGreaterThan(0);
    // Signature ZIP (les .xlsx sont des ZIP).
    expect(buf.slice(0, 2).toString('binary')).toBe('PK');
  });

  it('contient les feuilles Hypothèses, Métadonnées et une feuille par feuille moteur', async () => {
    const buf = await renderReportXlsx(buildData());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toContain('Hypothèses');
    expect(names).toContain('Métadonnées');
    // Le template hello-world n'a qu'une seule feuille : `activite` (label "Compte d'exploitation").
    expect(names).toContain("Compte d'exploitation");
  });

  it('remplit la feuille Hypothèses avec un driver par ligne + valeur numérique', async () => {
    const buf = await renderReportXlsx(buildData());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Hypothèses');
    expect(ws).toBeDefined();
    // Ligne 1 = header, ligne 2 = premier driver (prix_unitaire = 10 dans hello-world).
    expect(ws!.getCell('A2').value).toBe('Prix unitaire');
    expect(ws!.getCell('B2').value).toBe(10);
  });

  it('écrit des formules Excel natives (pas de simple valeur) pour les lignes calculées', async () => {
    const buf = await renderReportXlsx(buildData());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet("Compte d'exploitation");
    expect(ws).toBeDefined();
    // Ligne 2 = première ligne moteur (ca = prix_unitaire * quantite_mois).
    const cell = ws!.getCell('B2');
    // ExcelJS représente une cellule à formule comme { formula, result, ... }.
    const val = cell.value as { formula?: string; result?: number };
    expect(val).toBeTypeOf('object');
    expect(val.formula).toBeDefined();
    expect(val.formula).toContain("'Hypothèses'!B"); // Réfère aux drivers Hypothèses (nom cité car accent)
    expect(val.result).toBe(1000); // 10 * 100
  });
});
