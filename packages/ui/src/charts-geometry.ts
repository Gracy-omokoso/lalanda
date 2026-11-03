// Géométrie des graphiques maison (ADR-0055 § 5, ADR-0056) : fonctions pures,
// testées sans DOM. Aucune bibliothèque : les tracés sont des chemins SVG écrits ici.
//
// Les valeurs reçues sont des NOMBRES D'AFFICHAGE (déjà calculés par le serveur) :
// rien ici ne fait foi, on ne fait que placer des points.

/** Couleur de série : jeton `--chart-1` à `--chart-6`, jamais un code libre. */
export type ChartColor = 1 | 2 | 3 | 4 | 5 | 6;

export function chartColor(color: ChartColor): string {
  return `var(--chart-${color})`;
}

/** Nombre fini, sinon 0 (une valeur illisible ne casse pas un tracé). */
export function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export interface NiceScale {
  min: number;
  max: number;
  /** Graduations, de la plus basse à la plus haute, 0 compris dès que le domaine le contient. */
  ticks: number[];
}

function niceStep(rough: number): number {
  const exp = Math.floor(Math.log10(rough));
  const base = 10 ** exp;
  const f = rough / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * base;
}

/**
 * Échelle « ronde » couvrant toutes les valeurs et zéro, en `count` intervalles au
 * plus. Domaine vide ou nul : `[0, 1]` et une seule graduation, 0.
 */
export function niceScale(values: readonly number[], count = 3): NiceScale {
  const v = values.map(finite);
  const lo = Math.min(0, ...v);
  const hi = Math.max(0, ...v);
  if (lo === hi) return { min: 0, max: 1, ticks: [0] };
  const step = niceStep((hi - lo) / Math.max(1, count));
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 2; t += step) ticks.push(Math.round(t / step) * step);
  return { min, max, ticks };
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Points dans un repère 0–100 (x : centre de chaque bande, comme les libellés en
 * grille sous le graphique ; y : 0 en haut). Une seule valeur : au milieu.
 */
export function plotPoints(values: readonly number[], scale: NiceScale): Point[] {
  const n = values.length;
  const span = scale.max - scale.min || 1;
  return values.map((value, i) => ({
    x: ((i + 0.5) / n) * 100,
    y: 100 - ((finite(value) - scale.min) / span) * 100,
  }));
}

/** Ordonnée (0–100) d'une valeur sur l'échelle. */
export function yOf(value: number, scale: NiceScale): number {
  const span = scale.max - scale.min || 1;
  return 100 - ((finite(value) - scale.min) / span) * 100;
}

const r = (n: number) => Math.round(n * 100) / 100;

/** Chemin d'une ligne brisée ; vide sans point. Un point seul : un trait court. */
export function linePath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0]!;
    return `M${r(p.x - 2)} ${r(p.y)}L${r(p.x + 2)} ${r(p.y)}`;
  }
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${r(p.x)} ${r(p.y)}`).join('');
}

/** Aire sous la ligne, fermée sur l'ordonnée `baseline` (celle de zéro). */
export function areaPath(points: readonly Point[], baseline: number): string {
  if (points.length < 2) return '';
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return `${linePath(points)}L${r(last.x)} ${r(baseline)}L${r(first.x)} ${r(baseline)}Z`;
}

/**
 * Mini-courbe : points d'une `polyline` dans un cadre `width × height` avec une
 * marge `pad`. Toutes valeurs égales : ligne au milieu. Aucune valeur : aucun point.
 */
export function sparklinePoints(
  values: readonly number[],
  width: number,
  height: number,
  pad = 2,
): Point[] {
  const v = values.map(finite);
  if (v.length === 0) return [];
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  return v.map((value, i) => ({
    x: r(v.length === 1 ? width / 2 : pad + (i * innerW) / (v.length - 1)),
    y: r(hi === lo ? height / 2 : pad + innerH - ((value - lo) / (hi - lo)) * innerH),
  }));
}

export interface DonutSegment {
  /** Longueur de l'arc sur une circonférence normalisée à 100. */
  length: number;
  /** Décalage de départ (même unité). */
  offset: number;
}

/**
 * Arcs d'un anneau : valeurs négatives ou illisibles comptées pour zéro. Total nul :
 * aucun arc (l'anneau de fond seul est dessiné).
 */
export function donutSegments(values: readonly number[]): DonutSegment[] {
  const v = values.map((x) => Math.max(0, finite(x)));
  const total = v.reduce((a, b) => a + b, 0);
  let acc = 0;
  return v.map((value) => {
    const length = total === 0 ? 0 : (value / total) * 100;
    const seg = { length: r(length), offset: r(acc) };
    acc += length;
    return seg;
  });
}

/** Largeurs de barres en % de la plus grande valeur positive ; négatif ou nul : 0. */
export function barWidths(values: readonly number[]): number[] {
  const v = values.map((x) => Math.max(0, finite(x)));
  const max = Math.max(0, ...v);
  return v.map((value) => (max === 0 ? 0 : r((value / max) * 100)));
}
