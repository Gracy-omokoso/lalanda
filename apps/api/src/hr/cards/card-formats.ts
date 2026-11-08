// Formats des cartes — ADR-0069 § 1.
//
// Carte de service : CR80, ISO/IEC 7810 ID-1 (85,60 × 53,98 mm), sans fond perdu
// (imprimantes à cartes PVC bord à bord). Carte de visite : 85 × 55 mm, fond perdu
// 3 mm, zone de sécurité 4 mm. Fonctions PURES : mêmes entrées ⇒ mêmes dimensions.

import { CARD_DIMENSIONS, type CardKind, type CardOrientation } from '@lalanda/shared/hr';

/** Pixels CSS par millimètre (96 ppp). */
export const CSS_PX_PER_MM = 96 / 25.4;

/** Densité d'impression des PNG exportés. */
export const PRINT_DPI = 300;

/** Facteur d'échelle Chromium pour 300 dpi (300 / 96). */
export const PRINT_SCALE = PRINT_DPI / 96;

export interface CardFormat {
  kind: CardKind;
  orientation: CardOrientation;
  /** Coupe (mm). */
  width: number;
  height: number;
  /** Fond perdu par côté (mm). */
  bleed: number;
  /** Zone de sécurité, mesurée depuis la coupe (mm). */
  safe: number;
}

export function cardFormat(kind: CardKind, orientation: CardOrientation): CardFormat {
  const d = CARD_DIMENSIONS[kind];
  const landscape = orientation === 'horizontal';
  return {
    kind,
    orientation,
    width: landscape ? d.width : d.height,
    height: landscape ? d.height : d.width,
    bleed: d.bleed,
    safe: d.safe,
  };
}

/** Boîte complète d'une face (coupe + fond perdu), mm. */
export function bleedBox(f: CardFormat): { width: number; height: number } {
  return { width: f.width + 2 * f.bleed, height: f.height + 2 * f.bleed };
}

/** Millimètres → pixels à `dpi`, arrondi au pixel. */
export function mmToPx(mm: number, dpi = PRINT_DPI): number {
  return Math.round((mm * dpi) / 25.4);
}

/** Millimètres → pixels CSS (96 ppp), sans arrondi. */
export function mmToCssPx(mm: number): number {
  return mm * CSS_PX_PER_MM;
}

/** `85.6` → `"85.6mm"` (deux décimales au plus, sans zéros inutiles). */
export function mm(v: number): string {
  return `${Number(v.toFixed(2))}mm`;
}

/** Planche A4 : 2 colonnes × 5 lignes, cartes à la coupe, centrées (ADR-0069 § 1). */
export const SHEET = { width: 210, height: 297, cols: 2, rows: 5, gap: 0 } as const;

export function sheetLayout(f: CardFormat): {
  perPage: number;
  cols: number;
  rows: number;
  originX: number;
  originY: number;
} {
  // Une carte verticale tient en 3 × 3 sur A4 (54 × 85,6 mm).
  const cols = f.orientation === 'horizontal' ? SHEET.cols : 3;
  const rows = f.orientation === 'horizontal' ? SHEET.rows : 3;
  const originX = (SHEET.width - cols * f.width) / 2;
  const originY = (SHEET.height - rows * f.height) / 2;
  return { perPage: cols * rows, cols, rows, originX, originY };
}
