// Compilateur DSL → workbook HyperFormula.
//
// Modèle de mapping :
// - Une feuille masquée `__drivers` contient les valeurs des drivers : ligne i = driver i,
//   colonne A = id, colonne B = valeur.
// - Chaque feuille du template devient une feuille HyperFormula homonyme : ligne i = ligne i,
//   colonne A = id, colonne B = formule (préfixée `=`) où chaque identifiant DSL a été
//   remplacé par la référence de cellule correspondante.
//
// Ce mapping garantit :
// - une seule source de vérité (chaque driver n'a qu'une seule cellule d'origine) ;
// - la traduction directe vers Excel (feuille + coord = position dans le classeur exporté).

import { UnknownDriverError, UnknownLineError } from '../dsl/errors.js';
import { type Feuille, type Ligne, type Template, collectIds } from '../dsl/schema.js';
import { extractReferencedIds } from './formula-refs.js';
import { assertAcyclic } from './graph.js';

/** Nom de la feuille interne qui héberge les valeurs des drivers. */
export const DRIVERS_SHEET = '__drivers';

/** Localisation d'une cellule dans le workbook compilé. */
export interface CellLocation {
  /** Nom de la feuille HyperFormula. */
  readonly sheet: string;
  /** Indice de ligne (0-based) — colonne A = id, colonne B = valeur/formule. */
  readonly row: number;
}

/** Une ligne compilée : source DSL + formule Excel + coord. */
export interface CompiledLine {
  readonly sheetId: string;
  readonly lineId: string;
  readonly label: string;
  readonly formulaSource: string;
  readonly formulaExcel: string;
  readonly location: CellLocation;
  readonly format: Ligne['format'];
}

export interface CompiledTemplate {
  readonly template: Template;
  readonly driverIndex: ReadonlyMap<string, CellLocation>;
  readonly lineIndex: ReadonlyMap<string, CompiledLine>;
  /** Ordre stable des feuilles tel qu'écrit dans le template. */
  readonly sheetOrder: readonly string[];
}

// Convertit un indice 0-based en lettre de colonne Excel (A, B, C, …).
// Suffit largement pour S1 (on ne dépasse jamais la colonne B).
function colLetter(index: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + index);
}

/** Coord Excel `Sheet!Bxx` pour une ligne (colonne B = valeur/formule, 1-based). */
function coordFor(loc: CellLocation, col: number = 1): string {
  // Nom de feuille avec des underscores → pas d'apostrophes nécessaires ici (a-z, 0-9, _).
  return `${loc.sheet}!${colLetter(col)}${loc.row + 1}`;
}

export function compileTemplate(template: Template): CompiledTemplate {
  // 1) Unicité des ids et validation croisée (déjà validé par Zod pour la structure).
  const ids = collectIds(template);

  // 2) Index des drivers dans la feuille __drivers.
  const driverIndex = new Map<string, CellLocation>();
  template.drivers.forEach((d, i) => {
    driverIndex.set(d.id, { sheet: DRIVERS_SHEET, row: i });
  });

  // 3) Index des lignes + validation des références + réécriture des formules.
  const lineIndex = new Map<string, CompiledLine>();
  const dependencyEdges = new Map<string, Set<string>>();

  for (const feuille of template.feuilles) {
    feuille.lignes.forEach((ligne, i) => {
      const loc: CellLocation = { sheet: feuille.id, row: i };
      const refs = extractReferencedIds(ligne.formule);
      const edgesForLine = new Set<string>();

      // Réécrit la formule en substituant chaque identifiant par sa coord Excel.
      // On remplace du plus long au plus court pour éviter qu'un id soit préfixe d'un autre.
      const sortedRefs = [...refs].sort((a, b) => b.length - a.length);
      let excelFormula = ligne.formule;
      for (const ref of sortedRefs) {
        if (ids.drivers.has(ref)) {
          const cell = coordFor(driverIndex.get(ref)!);
          excelFormula = replaceIdentifier(excelFormula, ref, cell);
        } else if (ids.lignes.has(ref)) {
          // Réf à une autre ligne — on ne connaît pas encore sa loc si elle vient après,
          // mais l'id de feuille est stable → on peut résoudre plus tard OU accepter les fwd-refs.
          // On résout maintenant, car on connaît déjà (feuille.id, index) via lineIndex.
          const target = findLineLocation(template, ref);
          if (!target) throw new UnknownLineError(ref, ligne.id);
          excelFormula = replaceIdentifier(excelFormula, ref, coordFor(target));
          edgesForLine.add(ref);
        } else {
          // Ni driver ni ligne connue → erreur explicite.
          throw new UnknownDriverError(ref, ligne.id);
        }
      }

      lineIndex.set(ligne.id, {
        sheetId: feuille.id,
        lineId: ligne.id,
        label: ligne.label ?? ligne.id,
        formulaSource: ligne.formule,
        formulaExcel: `=${excelFormula}`,
        location: loc,
        format: ligne.format,
      });
      dependencyEdges.set(ligne.id, edgesForLine);
    });
  }

  // 4) Détection de cycle sur le graphe des lignes.
  assertAcyclic(dependencyEdges);

  return {
    template,
    driverIndex,
    lineIndex,
    sheetOrder: template.feuilles.map((f) => f.id),
  };
}

/** Trouve la localisation d'une ligne par son id (parcourt les feuilles dans l'ordre). */
function findLineLocation(template: Template, lineId: string): CellLocation | undefined {
  for (const f of template.feuilles) {
    const idx = f.lignes.findIndex((l) => l.id === lineId);
    if (idx >= 0) return { sheet: f.id, row: idx };
  }
  return undefined;
}

// Remplace toutes les occurrences d'un identifiant exact (bordé par des non-mots) par la coord Excel.
// On échappe l'id pour la regex (bien qu'un id snake_case ne contienne pas de méta-caractère).
function replaceIdentifier(formula: string, id: string, cell: string): string {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'g');
  return formula.replace(regex, cell);
}

/** Aide typée pour parcourir les feuilles compilées (utile aux exporters). */
export function feuillesCompilees(compiled: CompiledTemplate): readonly Feuille[] {
  return compiled.template.feuilles;
}
