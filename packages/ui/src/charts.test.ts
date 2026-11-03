// Graphiques maison (ADR-0056) : géométrie pure et rendu serveur, cas limites
// (0 point, 1 point, valeurs nulles ou négatives, valeurs illisibles).

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  areaPath,
  barWidths,
  donutSegments,
  linePath,
  niceScale,
  plotPoints,
  sparklinePoints,
  yOf,
} from './charts-geometry';
import { BarList, DonutChart, LineChart, Sparkline } from './components/charts';
import { StatusPill } from './components/status-pill';

const fmt = (v: number) => `${v} u`;

describe('niceScale', () => {
  it('aucune valeur ou toutes nulles : [0, 1], une graduation à 0', () => {
    expect(niceScale([])).toEqual({ min: 0, max: 1, ticks: [0] });
    expect(niceScale([0, 0, 0])).toEqual({ min: 0, max: 1, ticks: [0] });
  });

  it('valeurs positives : domaine rond depuis zéro', () => {
    const s = niceScale([7.8, 14.1]);
    expect(s.min).toBe(0);
    expect(s.max).toBeGreaterThanOrEqual(14.1);
    expect(s.ticks[0]).toBe(0);
    expect(s.ticks.at(-1)).toBe(s.max);
  });

  it('valeurs négatives : le domaine descend sous zéro et garde 0', () => {
    const s = niceScale([-300, 1000]);
    expect(s.min).toBeLessThan(0);
    expect(s.ticks).toContain(0);
  });

  it('valeur illisible comptée pour zéro', () => {
    expect(niceScale([Number.NaN, Number.POSITIVE_INFINITY])).toEqual({
      min: 0,
      max: 1,
      ticks: [0],
    });
  });
});

describe('tracés', () => {
  it('0 point : chemins vides', () => {
    expect(linePath([])).toBe('');
    expect(areaPath([], 100)).toBe('');
    expect(plotPoints([], niceScale([]))).toEqual([]);
  });

  it('1 point : centré, trait court, pas d’aire', () => {
    const pts = plotPoints([5], niceScale([5]));
    expect(pts).toHaveLength(1);
    expect(pts[0]!.x).toBe(50);
    expect(linePath(pts)).toMatch(/^M48 \d+(\.\d+)?L52 \d+(\.\d+)?$/);
    expect(areaPath(pts, 100)).toBe('');
  });

  it('plusieurs points : bandes centrées, aire fermée sur zéro', () => {
    const scale = niceScale([0, 10]);
    const pts = plotPoints([0, 10], scale);
    expect(pts.map((p) => p.x)).toEqual([25, 75]);
    expect(pts[0]!.y).toBe(100);
    const zero = yOf(0, scale);
    expect(areaPath(pts, zero)).toBe(`${linePath(pts)}L75 ${zero}L25 ${zero}Z`);
  });

  it('valeur négative : sous la ligne de zéro', () => {
    const scale = niceScale([-5, 10]);
    const [neg] = plotPoints([-5], scale);
    expect(neg!.y).toBeGreaterThan(yOf(0, scale));
  });
});

describe('sparklinePoints', () => {
  it('0 point, 1 point, valeurs égales', () => {
    expect(sparklinePoints([], 84, 32)).toEqual([]);
    expect(sparklinePoints([3], 84, 32)).toEqual([{ x: 42, y: 16 }]);
    expect(sparklinePoints([2, 2, 2], 84, 32).every((p) => p.y === 16)).toBe(true);
  });

  it('min en bas, max en haut, bornes dans le cadre', () => {
    const pts = sparklinePoints([1, 3, -2], 84, 32, 2);
    expect(pts[0]!.x).toBe(2);
    expect(pts[2]!.x).toBe(82);
    expect(pts[1]!.y).toBe(2);
    expect(pts[2]!.y).toBe(30);
  });
});

describe('donutSegments et barWidths', () => {
  it('total nul : aucun arc ; négatif compté pour zéro', () => {
    expect(donutSegments([0, 0])).toEqual([
      { length: 0, offset: 0 },
      { length: 0, offset: 0 },
    ]);
    expect(donutSegments([-3, 1, 3])).toEqual([
      { length: 0, offset: 0 },
      { length: 25, offset: 0 },
      { length: 75, offset: 25 },
    ]);
  });

  it('barres en % de la plus grande ; négatif ou nul à 0', () => {
    expect(barWidths([])).toEqual([]);
    expect(barWidths([0, 0])).toEqual([0, 0]);
    expect(barWidths([50, 100, -10])).toEqual([50, 100, 0]);
  });
});

describe('rendu', () => {
  const html = (el: React.ReactElement) => renderToStaticMarkup(el);

  it('Sparkline : décorative sans libellé, image nommée avec', () => {
    expect(html(createElement(Sparkline, { values: [] }))).toContain('aria-hidden="true"');
    expect(html(createElement(Sparkline, { values: [] }))).not.toContain('<polyline');
    const un = html(createElement(Sparkline, { values: [4] }));
    expect(un).toContain('<circle');
    expect(un).not.toContain('<polyline');
    const nomme = html(createElement(Sparkline, { values: [1, 2], label: 'Tendance' }));
    expect(nomme).toContain('role="img"');
    expect(nomme).toContain('aria-label="Tendance"');
    expect(nomme).toContain('var(--chart-1)');
  });

  it('LineChart : état vide, tableau accessible, légende de série, jetons seulement', () => {
    expect(
      html(createElement(LineChart, { title: 'T', labels: [], series: [], formatValue: fmt })),
    ).toContain('Aucune donnée');
    const out = html(
      createElement(LineChart, {
        title: 'Facturé et encaissé',
        labels: ['oct.', 'nov.'],
        fullLabels: ['octobre 2026', 'novembre 2026'],
        series: [
          { id: 'c', label: 'Encaissé', values: [0, -2], color: 1, variant: 'area' },
          { id: 'b', label: 'Facturé', values: [3, 4], color: 2, variant: 'dashed' },
        ],
        formatValue: fmt,
        endLabelSeriesId: 'c',
      }),
    );
    expect(out).toContain('<caption>Facturé et encaissé</caption>');
    expect(out).toContain('<th scope="row">novembre 2026</th>');
    expect(out).toContain('<td>-2 u</td>');
    expect(out).toContain('stroke-dasharray="5 4"');
    expect(out).toContain('chart-reveal');
    expect(out).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('DonutChart : total nul sans arc, légende et tableau', () => {
    const vide = html(
      createElement(DonutChart, {
        title: 'Par statut',
        slices: [{ id: 'a', label: 'Payées', value: 0, color: 1 }],
        total: '0',
        totalLabel: 'documents',
      }),
    );
    expect(vide).not.toContain('pathLength');
    expect(vide).toContain('<caption>Par statut : 0 documents</caption>');
    const plein = html(
      createElement(DonutChart, {
        title: 'Par statut',
        slices: [
          { id: 'a', label: 'Payées', value: 3, color: 1 },
          { id: 'b', label: 'En retard', value: 1, color: 4 },
          { id: 'c', label: 'Avoirs', value: 0, color: 6 },
        ],
        total: '4',
        totalLabel: 'documents',
        hideEmpty: true,
      }),
    );
    expect(plein).toContain('stroke-dasharray="75 25"');
    expect(plein).toContain('stroke-dashoffset="-75"');
    // Part nulle masquée de la légende visible, gardée dans le tableau.
    expect(plein.match(/Avoirs/g)).toHaveLength(1);
  });

  it('BarList : vide, puis largeurs relatives', () => {
    expect(html(createElement(BarList, { title: 'Top', items: [] }))).toContain('Aucune donnée');
    const out = html(
      createElement(BarList, {
        title: 'Top',
        items: [
          { id: 'a', label: 'A', value: 10, display: '10' },
          { id: 'b', label: 'B', value: 5, display: '5' },
        ],
      }),
    );
    expect(out).toContain('aria-label="Top"');
    expect(out).toContain('width:100%');
    expect(out).toContain('width:50%');
  });

  it('StatusPill : libellé écrit, point décoratif', () => {
    const out = html(createElement(StatusPill, { tone: 'late' }, 'En retard'));
    expect(out).toContain('En retard');
    expect(out).toContain('var(--label-red-bg)');
    expect(out).toContain('aria-hidden="true"');
  });
});
