// Génération d'un export Excel (.xlsx) d'un rapport de plan financier (S14b).
//
// Principe (aligné brief §3-1 et CLAUDE.md) :
//   - le moteur reste la SEULE source de vérité des calculs ;
//   - l'export matérialise le résultat déjà calculé + reproduit les formules DSL
//     sous forme de formules Excel natives, pour que l'utilisateur voie et modifie
//     ses hypothèses dans Excel sans avoir à ré-implémenter la logique.
//
// Structure du classeur :
//   - Feuille "Hypothèses" : liste des drivers (label + valeur brute).
//   - Une feuille par feuille moteur (activite, plan_financement, tresorerie, projection,
//     financement, ratios) : label + formule Excel (ou valeur brute si mapping impossible).
//   - Feuille "ratios" : coloration verte/orange/rouge selon feu tricolore.
//
// Mapping DSL → Excel :
//   - Les fonctions Excel natives (MAX, MIN, IF, IFERROR, ABS, ROUND, SUM, AND, OR, NOT,
//     PMT, PV, FV, NPV, IRR) sont préservées tel quel — signatures identiques Excel.
//   - Les identifiants (driver.id, ligne.id) sont substitués par la référence de cellule
//     de destination (ex : `prix_unitaire` → `Hypothèses!B2`).
//   - Si un identifiant ne peut pas être résolu (cas défensif — ne devrait pas arriver
//     puisque le compilateur moteur a déjà validé), on écrit la valeur brute calculée
//     et on laisse une note.
//
// Aucune donnée sensible n'est injectée en tant que formule : les labels et valeurs
// numériques sont écrits via `cell.value = ...`, jamais concaténés dans une formule
// (protection contre l'injection de formule côté client).

import ExcelJS from 'exceljs';
import type { Template } from '@lalanda/engine';

import type { ReportData, ReportLine } from './report-html.js';

// Identifiants du DSL considérés comme des fonctions Excel natives — à ne pas
// substituer par une référence de cellule. Doit rester aligné avec `RESERVED`
// du moteur (packages/engine/src/compiler/formula-refs.ts).
const EXCEL_NATIVE_FUNCTIONS = new Set([
  'true',
  'false',
  'null',
  // Math + logique
  'max',
  'min',
  'if',
  'abs',
  'round',
  'sum',
  'iferror',
  'and',
  'or',
  'not',
  // Financières
  'pmt',
  'pv',
  'fv',
  'npv',
  'irr',
]);

// Regex identifiants DSL (a-z, snake_case) — même règle que
// packages/engine/src/compiler/formula-refs.ts. Insensible à la casse.
const ID_REGEX = /\b([a-zA-Z][a-zA-Z0-9_]*)\b/g;

// Labels FR lisibles pour les onglets Excel — même vocabulaire que le PDF (report-html.ts).
const SHEET_TAB_LABELS: Record<string, string> = {
  activite: "Compte d'exploitation",
  plan_financement: 'Plan de financement',
  tresorerie: 'Trésorerie',
  projection: 'Projection 3 ans',
  financement: 'Financement',
  ratios: 'Ratios bancaires',
  compte_resultat: 'Compte de résultat',
};

const HYPOTHESES_SHEET = 'Hypothèses';

// Excel interdit ces caractères dans un nom d'onglet : \ / ? * [ ] :
// Longueur max = 31. On tronque et on nettoie.
function safeSheetName(input: string): string {
  const cleaned = input.replace(/[\\/?*\[\]:]/g, ' ').trim();
  return cleaned.slice(0, 31) || 'Feuille';
}

/**
 * Localisation d'une valeur/formule dans le classeur Excel exporté.
 * Utilisée pour construire les références inter-feuilles.
 */
interface CellRef {
  /** Nom exact de la feuille dans le classeur Excel. */
  sheet: string;
  /** Adresse Excel de la cellule (ex : "B2"). */
  address: string;
}

/**
 * Construit la référence Excel qualifiée par la feuille.
 * Les noms de feuilles contenant un espace/accent doivent être entourés d'apostrophes.
 */
function qualifiedRef(ref: CellRef): string {
  const needsQuoting = /[^A-Za-z0-9_]/.test(ref.sheet);
  const sheetPart = needsQuoting ? `'${ref.sheet.replace(/'/g, "''")}'` : ref.sheet;
  return `${sheetPart}!${ref.address}`;
}

/**
 * Réécrit une formule DSL en substituant chaque identifiant par sa cellule Excel de destination.
 * Les fonctions natives (MAX, IF, IFERROR, PMT, …) et les littéraux passent tels quels.
 *
 * @param dslFormula  Ex : `MAX(0, prix_unitaire - cout)`.
 * @param resolver    Rend une CellRef pour l'identifiant demandé, ou undefined s'il est inconnu.
 * @returns           Formule Excel (SANS le `=` initial) et un flag `allResolved`.
 */
export function mapDslToExcelFormula(
  dslFormula: string,
  resolver: (id: string) => CellRef | undefined,
): { formula: string; allResolved: boolean } {
  let allResolved = true;
  const formula = dslFormula.replace(ID_REGEX, (match) => {
    const lower = match.toLowerCase();
    if (EXCEL_NATIVE_FUNCTIONS.has(lower)) {
      // Fonction native — on la remonte en majuscules par convention Excel.
      return lower.toUpperCase();
    }
    const target = resolver(match);
    if (!target) {
      allResolved = false;
      return match;
    }
    return qualifiedRef(target);
  });
  return { formula, allResolved };
}

/**
 * Format de nombre Excel selon le type de valeur.
 * On garde volontairement simple — les devises multiples nécessiteraient un mapping
 * complet des locales et n'apportent rien à la lecture bancaire.
 */
function numberFormatFor(format: ReportLine['format'], currency: string): string {
  if (format === 'percent') return '0.00%';
  if (format === 'money') return `#,##0.00 "${currency}"`;
  return '#,##0.00';
}

/** Couleurs ARGB (Excel) pour les feux tricolores — mêmes teintes que le PDF. */
const STATUT_FILL: Record<'vert' | 'orange' | 'rouge', string> = {
  vert: 'FFDCFCE7', // vert clair (Tailwind emerald-100)
  orange: 'FFFED7AA', // orange clair (Tailwind orange-200)
  rouge: 'FFFECACA', // rouge clair (Tailwind red-200)
};

/**
 * Génère le fichier Excel binaire. Retourne un Buffer prêt à être envoyé par la réponse HTTP.
 */
export async function renderReportXlsx(data: ReportData): Promise<Buffer> {
  const { template, driverValues, lines, currency, project, organization, parameterPack } = data;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Lalanda';
  workbook.company = organization.name;
  workbook.created = new Date(data.generatedAt);
  workbook.title = `${project.name} — Plan financier`;

  // ─── 1. Feuille Hypothèses (drivers) ────────────────────────
  // Colonne A = label, Colonne B = valeur.
  // Chaque driver est mémorisé dans `driverRefs` pour la réécriture des formules.
  const hypSheet = workbook.addWorksheet(HYPOTHESES_SHEET, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  hypSheet.columns = [
    { header: 'Hypothèse', key: 'label', width: 40 },
    { header: 'Valeur', key: 'value', width: 20 },
    { header: 'Unité', key: 'unit', width: 12 },
  ];
  hypSheet.getRow(1).font = { bold: true };
  hypSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  };

  const driverRefs = new Map<string, CellRef>();
  template.drivers.forEach((d, i) => {
    const rowIdx = i + 2; // ligne 1 = header
    const value = driverValues[d.id] ?? d.defaut ?? 0;
    const row = hypSheet.getRow(rowIdx);
    row.getCell(1).value = d.label ?? d.id;
    row.getCell(2).value = value;
    row.getCell(2).numFmt = numberFormatFor(driverFormat(d.type), d.devise ?? currency);
    row.getCell(3).value = driverUnitLabel(d, currency);
    driverRefs.set(d.id, { sheet: HYPOTHESES_SHEET, address: `B${rowIdx}` });
  });

  // ─── 2. Une feuille par feuille moteur ───────────────────────
  // Index préalable de la position de chaque ligne dans son onglet cible —
  // nécessaire pour résoudre les références croisées avant d'écrire les formules.
  const lineRefs = new Map<string, CellRef>();
  // Groupement des lignes par feuille (préserve l'ordre du template).
  const linesBySheet = groupLinesBySheet(template, lines);

  for (const [sheetId, sheetLines] of linesBySheet) {
    const tabName = safeSheetName(SHEET_TAB_LABELS[sheetId] ?? sheetId);
    sheetLines.forEach((l, i) => {
      const rowIdx = i + 2;
      lineRefs.set(l.lineId, { sheet: tabName, address: `B${rowIdx}` });
    });
  }

  // Résolveur commun : cherche d'abord dans les drivers, puis dans les lignes.
  const resolver = (id: string): CellRef | undefined => driverRefs.get(id) ?? lineRefs.get(id);

  // Écriture effective.
  for (const [sheetId, sheetLines] of linesBySheet) {
    const tabName = safeSheetName(SHEET_TAB_LABELS[sheetId] ?? sheetId);
    const ws = workbook.addWorksheet(tabName, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Poste', key: 'label', width: 45 },
      { header: 'Valeur', key: 'value', width: 22 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' },
    };

    // Récupération de la source DSL depuis le template pour reconstituer les formules.
    const feuille = template.feuilles.find((f) => f.id === sheetId);
    const dslByLineId = new Map<string, string>(
      feuille ? feuille.lignes.map((l) => [l.id, l.formule]) : [],
    );

    sheetLines.forEach((l, i) => {
      const rowIdx = i + 2;
      const row = ws.getRow(rowIdx);
      row.getCell(1).value = l.label;

      const dsl = dslByLineId.get(l.lineId);
      const valueCell = row.getCell(2);
      valueCell.numFmt = numberFormatFor(l.format, currency);

      if (dsl) {
        const { formula, allResolved } = mapDslToExcelFormula(dsl, resolver);
        if (allResolved) {
          // On fournit aussi le résultat calculé pour que le fichier ait des valeurs
          // même avant qu'Excel ne recalcule (utile aux visionneuses qui n'évaluent pas).
          valueCell.value = {
            formula,
            result: Number.isFinite(l.value) ? l.value : undefined,
          };
        } else {
          // Fallback : mapping incomplet — on met la valeur brute.
          valueCell.value = Number.isFinite(l.value) ? l.value : null;
        }
      } else {
        // Pas de formule connue — valeur brute.
        valueCell.value = Number.isFinite(l.value) ? l.value : null;
      }

      // Coloration feu tricolore pour la feuille ratios.
      if (sheetId === 'ratios' && l.seuil) {
        const fill = STATUT_FILL[l.seuil.statut];
        const patternFill: ExcelJS.FillPattern = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: fill },
        };
        row.getCell(1).fill = patternFill;
        row.getCell(2).fill = patternFill;
      }
    });
  }

  // ─── 3. Métadonnées (page de garde légère) ───────────────────
  const metaSheet = workbook.addWorksheet('Métadonnées');
  metaSheet.columns = [
    { header: 'Champ', key: 'field', width: 30 },
    { header: 'Valeur', key: 'value', width: 60 },
  ];
  metaSheet.getRow(1).font = { bold: true };
  metaSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  };
  const metaRows: Array<[string, string]> = [
    ['Organisation', organization.name],
    ['Pays', project.pays],
    ['Projet', project.name],
    ['Template', `${template.slug} v${template.version}`],
    ['Devise', currency],
    ['Généré le', data.generatedAt],
  ];
  if (parameterPack) {
    metaRows.push(['Cadre fiscal', parameterPack.label]);
    metaRows.push(['Système comptable', parameterPack.systeme_comptable]);
    if (parameterPack.avertissement) {
      metaRows.push(['Avertissement', parameterPack.avertissement]);
    }
  }
  metaRows.forEach(([field, value], i) => {
    const row = metaSheet.getRow(i + 2);
    row.getCell(1).value = field;
    row.getCell(2).value = value;
  });

  // ExcelJS retourne un Buffer Node (ArrayBuffer typé). On force le type Node Buffer.
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

/** Regroupe les lignes par feuille, en préservant l'ordre du template. */
function groupLinesBySheet(
  template: Template,
  lines: readonly ReportLine[],
): Map<string, ReportLine[]> {
  const byId = new Map<string, ReportLine[]>();
  for (const l of lines) {
    const arr = byId.get(l.sheetId) ?? [];
    arr.push(l);
    byId.set(l.sheetId, arr);
  }
  // Réordonne selon l'ordre déclaré dans le template.
  const ordered = new Map<string, ReportLine[]>();
  for (const feuille of template.feuilles) {
    const arr = byId.get(feuille.id);
    if (arr && arr.length > 0) ordered.set(feuille.id, arr);
  }
  return ordered;
}

function driverFormat(t: 'number' | 'percent' | 'money'): ReportLine['format'] {
  return t;
}

function driverUnitLabel(
  d: { type: 'number' | 'percent' | 'money'; devise?: string; unite?: string },
  fallbackCurrency: string,
): string {
  if (d.type === 'percent') return '%';
  if (d.type === 'money') return d.devise ?? fallbackCurrency;
  return d.unite ?? '';
}
